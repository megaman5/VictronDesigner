import type {
  ChatCompletion, ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { clientForModel, hasKeyForModel } from "./model-client";
import { inferProvider } from "./providers";
import { describeAIError } from "./errors";
import { redactSecrets } from "./key-vault";

export const OPENROUTER_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const AI_REQUEST_TIMEOUT_MS = 90_000;

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface FallbackEvent {
  primaryModel: string;
  model: string;
  provider: "openrouter";
  reason: string;
}

export function canUseOpenRouterFallback(): boolean {
  return process.env.AI_FALLBACK_ENABLED !== "false" && hasKeyForModel(OPENROUTER_FALLBACK_MODEL);
}

export function shouldFallback(error: any): boolean {
  return [401, 402, 404, 408, 429].includes(error?.status)
    || (typeof error?.status === "number" && error.status >= 500)
    || ["APIConnectionError", "APIConnectionTimeoutError", "APIUserAbortError", "TimeoutError", "AbortError"].includes(error?.name);
}

function providerError(value: any): Error & { status?: number } {
  return Object.assign(new Error(value?.message || "AI provider returned an invalid response"), {
    status: typeof value?.code === "number" ? value.code : 502,
  });
}

/** One routing decision per user request, shared by all refinement passes. */
export class AISession {
  model: string;
  readonly primaryModel: string;
  usedFallback = false;
  private primaryFailure?: string;
  private usage: ModelUsage[] = [];

  constructor(model: string, private onFallback?: (event: FallbackEvent) => void) {
    this.model = this.primaryModel = model;
  }

  get metadata() {
    return {
      model: this.model,
      provider: inferProvider(this.model),
      modelUsage: this.usage.map(row => ({ ...row })),
      aiRouting: { primaryModel: this.primaryModel, usedFallback: this.usedFallback, primaryFailure: this.primaryFailure },
    };
  }

  get responseMetadata() {
    return { aiModel: this.model, aiProvider: inferProvider(this.model), usedFallback: this.usedFallback };
  }

  assertValidFallback(validation: { score: number; issues: { severity: string; message: string }[] } | null | undefined, minScore: number) {
    if (!this.usedFallback) return;
    const errors = validation?.issues.filter(issue => issue.severity === "error") ?? [];
    if (!validation || validation.score < minScore || errors.length) {
      throw Object.assign(new Error(
        `The backup AI could not produce a design that passes validation. ${errors.slice(0, 3).map(issue => issue.message).join("; ") || `Required score: ${minScore}; received: ${validation?.score ?? 0}.`} Try simplifying the request or correcting the component settings.`
      ), { status: 422 });
    }
  }

  private recordUsage(model: string, inputTokens: number, outputTokens: number) {
    let row = this.usage.find(entry => entry.model === model);
    if (!row) { row = { model, inputTokens: 0, outputTokens: 0 }; this.usage.push(row); }
    row.inputTokens += inputTokens;
    row.outputTokens += outputTokens;
  }

  private switchToFallback(error: any): boolean {
    if (this.usedFallback || this.model === OPENROUTER_FALLBACK_MODEL || !canUseOpenRouterFallback() || !shouldFallback(error)) return false;
    this.primaryFailure = redactSecrets(describeAIError(error));
    this.model = OPENROUTER_FALLBACK_MODEL;
    this.usedFallback = true;
    const event: FallbackEvent = { primaryModel: this.primaryModel, model: this.model, provider: "openrouter", reason: this.primaryFailure };
    console.warn(`[ai-fallback] ${event.primaryModel} failed: ${event.reason}; switching to ${event.model}`);
    this.onFallback?.(event);
    return true;
  }

  private failure(error: any) {
    if (!this.usedFallback) return error;
    return Object.assign(new Error(`Primary AI failed: ${this.primaryFailure}. OpenRouter backup also failed: ${describeAIError(error)}`), {
      status: error?.status, fallbackExhausted: true,
    });
  }

  private body(body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming) {
    if (!this.usedFallback) return { ...body, model: this.model };
    // Nemotron is text-only. Keep the textual design context if the primary
    // request also included a picture, and use the settings we benchmarked.
    return {
      ...body, model: this.model,
      messages: body.messages.map(message => ({
        ...message,
        content: Array.isArray(message.content)
          ? message.content.filter(part => part.type === "text")
          : message.content,
      })),
      response_format: { type: "json_object" },
      max_completion_tokens: Math.min(body.max_completion_tokens ?? 32_000, 32_000),
      reasoning: { enabled: false },
      provider: { max_price: { prompt: 0, completion: 0 } },
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    };
  }

  private async request(body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming): Promise<any> {
    if (!hasKeyForModel(this.model)) throw Object.assign(new Error(`No API key configured for ${this.model}`), { status: 401 });
    return clientForModel(this.model).chat.completions.create(this.body(body) as any, {
      maxRetries: 0,
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
  }

  create(body: ChatCompletionCreateParamsStreaming): Promise<AsyncIterable<ChatCompletionChunk>>;
  create(body: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
  async create(body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    if (body.stream) return this.stream(body);
    for (;;) {
      const model = this.model;
      try {
        const result = await this.request(body);
        if (result.error) throw providerError(result.error);
        if (!result.choices?.[0]?.message?.content) throw providerError({ message: "AI provider returned an empty response", code: 502 });
        this.recordUsage(model, result.usage?.prompt_tokens ?? 0, result.usage?.completion_tokens ?? 0);
        return result;
      } catch (error) {
        if (this.switchToFallback(error)) continue;
        throw this.failure(error);
      }
    }
  }

  private async *stream(body: ChatCompletionCreateParamsStreaming): AsyncGenerator<ChatCompletionChunk> {
    for (;;) {
      const model = this.model;
      let publishedContent = false;
      let promptTokens = 0;
      let completionTokens = 0;
      try {
        const stream = await this.request(body);
        for await (const chunk of stream) {
          if (chunk.error || chunk.choices?.some((choice: any) => choice.finish_reason === "error")) throw providerError(chunk.error);
          if (chunk.usage) {
            const input = chunk.usage.prompt_tokens ?? promptTokens;
            const output = chunk.usage.completion_tokens ?? completionTokens;
            this.recordUsage(model, Math.max(0, input - promptTokens), Math.max(0, output - completionTokens));
            promptTokens = input; completionTokens = output;
          }
          if (chunk.choices?.some((choice: any) => choice.delta?.content)) publishedContent = true;
          yield chunk;
        }
        if (!publishedContent) throw providerError({ message: "AI provider returned an empty stream", code: 502 });
        return;
      } catch (error) {
        if (this.switchToFallback(error)) {
          // Let the route restart this iteration, clearing its partial JSON.
          if (publishedContent) throw Object.assign(new Error("Primary stream interrupted; restarting with backup AI"), { retryWithFallback: true });
          continue;
        }
        throw this.failure(error);
      }
    }
  }
}
