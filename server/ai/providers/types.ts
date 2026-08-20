/**
 * Provider-neutral chat interface.
 *
 * Everything the app asks of a model goes through this shape so that skills,
 * the benchmark harness and the request handlers do not care which vendor is
 * behind a given model id.
 */

export type ProviderId = "openai" | "openrouter" | "anthropic" | "gemini" | "local";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** Ask for a JSON object back. Providers apply their own native mechanism. */
  json?: boolean;
  maxOutputTokens?: number;
  /**
   * Only applied where the provider still accepts it. Current Anthropic and
   * OpenAI reasoning models reject sampling parameters outright, so this is a
   * request, not a guarantee - see `samplingApplied` on the response.
   */
  temperature?: number;
  seed?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ChatResponse {
  text: string;
  usage: TokenUsage;
  /** Model id the provider reports actually serving the request. */
  servedModel?: string;
  /** False when the provider refused or ignored temperature/seed. */
  samplingApplied: boolean;
  raw?: unknown;
}

export interface ProviderCredentials {
  apiKey: string;
  /** For OpenRouter and self-hosted OpenAI-compatible endpoints. */
  baseUrl?: string;
}

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  /** True when the provider needs a base URL as well as a key. */
  readonly requiresBaseUrl: boolean;
  chat(req: ChatRequest, creds: ProviderCredentials): Promise<ChatResponse>;
  /** Model ids we know about. Not exhaustive - callers may pass any string. */
  listKnownModels(): string[];
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: ProviderId,
    readonly status?: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
