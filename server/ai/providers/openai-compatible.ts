import OpenAI from "openai";
import type {
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderCredentials,
  ProviderId,
} from "./types";
import { ProviderError, toOpenAIContent } from "./types";

/**
 * Adapter for every OpenAI-compatible endpoint: OpenAI itself, OpenRouter,
 * and self-hosted servers such as Ollama or vLLM. They differ only in base
 * URL, extra headers, and which models they expose.
 *
 * Prompt caching needs no request changes here, unlike the Anthropic adapter:
 * OpenAI (gpt-4o and later, which covers every GPT-5.x model this app uses)
 * caches automatically once a request's prefix exceeds ~1024 tokens - no
 * opt-in field. OpenRouter passes that straight through for OpenAI-family
 * models; for a Claude model reached via OpenRouter, caching is whatever the
 * upstream Anthropic route negotiates without help from this adapter, since
 * OpenRouter's OpenAI-compatible surface has no cache_control field to set.
 * Already reported below via usage.prompt_tokens_details.cached_tokens.
 */
export class OpenAICompatibleProvider implements Provider {
  constructor(
    readonly id: ProviderId,
    readonly label: string,
    private readonly defaultBaseUrl: string | undefined,
    private readonly knownModels: string[],
    readonly requiresBaseUrl = false,
    private readonly extraHeaders: Record<string, string> = {}
  ) {}

  listKnownModels(): string[] {
    return [...this.knownModels];
  }

  async chat(req: ChatRequest, creds: ProviderCredentials): Promise<ChatResponse> {
    const baseURL = creds.baseUrl || this.defaultBaseUrl;
    if (this.requiresBaseUrl && !baseURL) {
      throw new ProviderError(`${this.label} requires a base URL`, this.id);
    }

    const client = new OpenAI({
      apiKey: creds.apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(Object.keys(this.extraHeaders).length ? { defaultHeaders: this.extraHeaders } : {}),
    });

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })),
    };
    if (req.json) body.response_format = { type: "json_object" };
    if (req.maxOutputTokens) body.max_completion_tokens = req.maxOutputTokens;

    // Reasoning models reject sampling parameters. Try once with them, and on
    // an "unsupported parameter" 400 retry without so the caller still gets a
    // result - reported honestly via samplingApplied.
    const wantsSampling = req.temperature !== undefined || req.seed !== undefined;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.seed !== undefined) body.seed = req.seed;

    const send = async (payload: Record<string, unknown>) =>
      client.chat.completions.create(payload as any, { signal: req.signal });

    let completion: any;
    let samplingApplied = wantsSampling;
    try {
      completion = await send(body);
    } catch (err: any) {
      if (wantsSampling && isUnsupportedParamError(err)) {
        const { temperature, seed, ...rest } = body;
        samplingApplied = false;
        completion = await send(rest);
      } else {
        throw toProviderError(err, this.id);
      }
    }

    const usage = completion.usage ?? {};
    return {
      text: completion.choices?.[0]?.message?.content ?? "",
      servedModel: completion.model,
      samplingApplied,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
      },
      raw: completion,
    };
  }
}

function isUnsupportedParamError(err: any): boolean {
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    err?.status === 400 &&
    (msg.includes("unsupported") || msg.includes("not supported") || msg.includes("unrecognized"))
  );
}

function toProviderError(err: any, id: ProviderId): ProviderError {
  const status = err?.status;
  const retryable = status === 429 || (typeof status === "number" && status >= 500);
  return new ProviderError(err?.message ?? "Request failed", id, status, retryable);
}

export const openaiProvider = new OpenAICompatibleProvider(
  "openai",
  "OpenAI",
  undefined,
  [
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.2",
    "gpt-5",
    "gpt-5-mini",
  ]
);

export const openrouterProvider = new OpenAICompatibleProvider(
  "openrouter",
  "OpenRouter",
  "https://openrouter.ai/api/v1",
  [
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5",
    "openai/gpt-5.4",
    "google/gemini-2.5-pro",
    "meta-llama/llama-4-maverick",
    "deepseek/deepseek-chat",
  ],
  false,
  {
    // OpenRouter uses these for attribution on its dashboards.
    "HTTP-Referer": "https://victrondesigner.com",
    "X-Title": "VictronDesigner",
  }
);

/** Self-hosted OpenAI-compatible server (Ollama, vLLM, LM Studio, ...). */
export const localProvider = new OpenAICompatibleProvider(
  "local",
  "Local / self-hosted",
  undefined,
  [],
  true
);
