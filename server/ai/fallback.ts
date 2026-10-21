import type {
  ChatCompletion, ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { APIConnectionError, APIUserAbortError } from "openai";
import { clientForModel, hasKeyForModel } from "./model-client";
import { inferProvider } from "./providers";
import { describeAIError, setErrorMessage } from "./errors";
import { redactSecrets } from "./key-vault";

// The backup is the production model again, thinking briefly. Every primary
// failure in Oct 2026 was Gemini thinking past the idle limit, not an outage,
// and the old free OpenRouter Nemotron backup failed 21 of 21 of them. On
// core-designs (2 passes) low-effort gemini-3.8-flash scored median 89 in
// 15-78s; low-effort gpt-5.5 scored median 32, and Nemotron 44.
export const AI_FALLBACK_MODEL = "gemini-3.8-flash";
export const AI_FALLBACK_REASONING_EFFORT = "low";
// Healthy Gemini runs went silent for up to 86s before the first token, so
// the old 90s limit was cutting off normal answers. 180s gives slow-but-healthy
// answers twice that, and still leaves the backup ~100s of the 280s run budget
// (its quick retry took 15-78s in benchmarks).
export const AI_REQUEST_IDLE_TIMEOUT_MS = 180_000;
// Non-streaming calls must return the whole design within this; an AI Wire
// call that would have succeeded hit the old 120s limit.
export const AI_COMPLETION_TIMEOUT_MS = 180_000;
// The backup needs this much of the run left to be worth starting: its quick
// retry took 15-78s per pass. A backup started with 10s left (seen 2026-10-20)
// can only fail, and its failure used to discard the primary's earlier draft.
export const AI_FALLBACK_MIN_MS = 60_000;
// The primary is never cut shorter than this to make room for the backup.
const AI_PRIMARY_MIN_IDLE_MS = 30_000;

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface FallbackEvent {
  primaryModel: string;
  model: string;
  provider: string;
  reason: string;
}

export function canUseAIFallback(): boolean {
  return process.env.AI_FALLBACK_ENABLED !== "false" && hasKeyForModel(AI_FALLBACK_MODEL);
}

export function shouldFallback(error: any): boolean {
  // SDK subclasses keep Error.name === "Error"; use their actual types.
  return [401, 402, 404, 408, 429].includes(error?.status)
    || (typeof error?.status === "number" && error.status >= 500)
    || error instanceof APIConnectionError
    || error instanceof APIUserAbortError
    || error?.abortCause === "provider-timeout"
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
  signal?: AbortSignal;
  /** Epoch ms when the whole run ends; lets the session keep time for the backup. */
  deadline?: number;
  private primaryFailure?: string;
  private usage: ModelUsage[] = [];
  private attempts: any[] = [];
  private abortCause?: string;

  constructor(model: string, private onFallback?: (event: FallbackEvent) => void) {
    this.model = this.primaryModel = model;
  }

  get metadata() {
    return {
      model: this.model,
      provider: inferProvider(this.model),
      modelUsage: this.usage.map(row => ({ ...row })),
      aiRouting: { primaryModel: this.primaryModel, servedModel: this.attempts.at(-1)?.servedModel ?? this.model, usedFallback: this.usedFallback, primaryFailure: this.primaryFailure, abortCause: this.signal?.reason?.abortCause ?? this.abortCause, attempts: this.attempts.map(row => ({ ...row })) },
    };
  }

  get responseMetadata() {
    return { aiModel: this.model, aiProvider: inferProvider(this.model), usedFallback: this.usedFallback };
  }

  assertValidFallback(validation: { score: number; issues: { severity: string; message: string; category?: string }[] } | null | undefined, minScore: number, requirementCheck?: { complete: boolean; issues?: { message: string }[] }, producedByBackup = this.usedFallback) {
    // Only the backup's own designs face this gate. A primary draft from an
    // earlier pass is returned with its issues listed, as any primary result.
    if (!producedByBackup) return;
    const errors = validation?.issues.filter(issue => issue.severity === "error") ?? [];
    const unresolved = validation?.issues.filter(issue => issue.category === 'unresolved') ?? [];
    // Name the reason that actually failed: a 97-point design rejected for an
    // unmet request used to be reported as "Required score: 70; received: 97".
    const reasons = !validation ? ["The design could not be checked."]
      : errors.length ? errors.slice(0, 3).map(issue => issue.message)
      : validation.score < minScore ? [`Quality score ${validation.score} is below the required ${minScore}.`]
      : unresolved.length ? unresolved.slice(0, 3).map(issue => issue.message)
      : requirementCheck && !requirementCheck.complete ? (requirementCheck.issues?.length ? requirementCheck.issues.slice(0, 3).map(issue => issue.message) : ["It did not include everything you asked for."])
      : [];
    if (reasons.length) {
      throw Object.assign(new Error(
        `The backup AI could not produce a design that passes validation. ${reasons.join("; ")} Try simplifying the request or correcting the component settings.`
      ), { status: 422 });
    }
  }

  private recordUsage(model: string, inputTokens: number, outputTokens: number) {
    let row = this.usage.find(entry => entry.model === model);
    if (!row) { row = { model, inputTokens: 0, outputTokens: 0 }; this.usage.push(row); }
    row.inputTokens += inputTokens;
    row.outputTokens += outputTokens;
  }

  /** On late passes, cut the primary early enough that the backup still fits. */
  private primaryTimeout(limit: number): number {
    if (this.usedFallback || this.deadline === undefined || !canUseAIFallback()) return limit;
    const primaryShare = this.deadline - Date.now() - AI_FALLBACK_MIN_MS;
    return primaryShare >= AI_PRIMARY_MIN_IDLE_MS ? Math.min(limit, primaryShare) : limit;
  }

  private switchToFallback(error: any): boolean {
    if (this.signal?.aborted) return false;
    if (this.deadline !== undefined && this.deadline - Date.now() < AI_FALLBACK_MIN_MS) return false;
    if (this.usedFallback || !canUseAIFallback() || !shouldFallback(error)) return false;
    this.primaryFailure = redactSecrets(describeAIError(error));
    this.model = AI_FALLBACK_MODEL;
    this.usedFallback = true;
    const event: FallbackEvent = { primaryModel: this.primaryModel, model: this.model, provider: inferProvider(this.model), reason: this.primaryFailure };
    console.warn(`[ai-fallback] ${event.primaryModel} failed: ${event.reason}; switching to ${event.model} (${AI_FALLBACK_REASONING_EFFORT} reasoning)`);
    this.onFallback?.(event);
    return true;
  }

  private failure(error: any) {
    if (!this.usedFallback) return error;
    return Object.assign(new Error(`Primary AI failed: ${this.primaryFailure}. Backup AI also failed: ${describeAIError(error)}`), {
      status: error?.status, abortCause: error?.abortCause, fallbackExhausted: true,
    });
  }

  private body(body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming) {
    if (!this.usedFallback) return { ...body, model: this.model };
    // The backup only gets the time the primary left, so think briefly. This
    // also makes it a real second chance when it is the same model as the
    // primary. It can see images, so the iteration picture is kept.
    return {
      ...body, model: this.model,
      response_format: { type: "json_object" },
      max_completion_tokens: Math.min(body.max_completion_tokens ?? 32_000, 32_000),
      reasoning_effort: AI_FALLBACK_REASONING_EFFORT,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    };
  }

  private async request(body: ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming): Promise<any> {
    if (!hasKeyForModel(this.model)) throw Object.assign(new Error(`No API key configured for ${this.model}`), { status: 401 });
    const idle = new AbortController();
    const timeoutMs = this.primaryTimeout(body.stream ? AI_REQUEST_IDLE_TIMEOUT_MS : AI_COMPLETION_TIMEOUT_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(), timeoutMs);
      timer.unref?.();
    };
    touch();
    this.abortCause = undefined;
    const payload = this.body(body) as any;
    const attempt = { model: this.model, startedAt: new Date().toISOString(), durationMs: 0, streaming: Boolean(body.stream), settings: { maxCompletionTokens: payload.max_completion_tokens ?? null, reasoningEffort: payload.reasoning_effort ?? null, reasoning: payload.reasoning ?? null }, finishReason: undefined as string | undefined, servedModel: undefined as string | undefined, abortCause: undefined as string | undefined };
    this.attempts.push(attempt);
    const started = Date.now();
    const classifyError = (error: any) => {
      if (this.signal?.aborted || idle.signal.aborted) {
        this.abortCause = this.signal?.aborted ? this.signal.reason?.abortCause ?? 'client-cancelled' : 'provider-timeout';
        attempt.abortCause = this.abortCause;
        error.abortCause = this.abortCause;
        setErrorMessage(error, this.abortCause === 'provider-timeout' ? `AI provider sent no response data for ${Math.round(timeoutMs / 1000)} seconds.` : this.signal?.reason?.message ?? 'AI request cancelled.');
        if (this.signal?.reason?.status) error.status = this.signal.reason.status;
      }
      return error;
    };
    let streaming = false;
    try {
      const result: any = await clientForModel(this.model).chat.completions.create(payload, {
        maxRetries: 0, timeout: timeoutMs,
        signal: this.signal ? AbortSignal.any([this.signal, idle.signal]) : idle.signal,
      });
      if (body.stream) {
        streaming = true;
        // Keep the watchdog alive through consumption, resetting on actual
        // provider chunks (including reasoning), rather than SSE heartbeats.
        return (async function* () {
          try {
            for await (const chunk of result) {
              touch();
              yield chunk;
            }
          } catch (error) { throw classifyError(error); }
          finally { clearTimeout(timer); attempt.durationMs = Date.now() - started; }
        })();
      }
      attempt.finishReason = result.choices?.[0]?.finish_reason; attempt.servedModel = result.model;
      return result;
    } catch (error: any) {
      throw classifyError(error);
    } finally {
      if (!streaming) clearTimeout(timer);
      attempt.durationMs = Date.now() - started;
    }
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
          const attempt = this.attempts.at(-1);
          if (attempt) { attempt.durationMs = Date.now() - Date.parse(attempt.startedAt); attempt.servedModel = chunk.model; if (chunk.choices?.[0]?.finish_reason) attempt.finishReason = chunk.choices[0].finish_reason; }
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
        if (this.signal?.aborted) { this.abortCause = this.signal.reason?.abortCause ?? 'client-cancelled'; Object.assign(error as object, { abortCause: this.abortCause }); }
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
