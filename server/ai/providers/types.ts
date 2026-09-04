/**
 * Provider-neutral chat interface.
 *
 * Everything the app asks of a model goes through this shape so that skills,
 * the benchmark harness and the request handlers do not care which vendor is
 * behind a given model id.
 */

export type ProviderId = "openai" | "openrouter" | "anthropic" | "gemini" | "local";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image";
  /** Always a data URL (data:image/png;base64,...) - what schematic-image produces. */
  dataUrl: string;
}

export type MessagePart = TextPart | ImagePart;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** A plain string, or parts when the message carries an image. */
  content: string | MessagePart[];
}

/** Text of a message, ignoring images - for providers' system-prompt fields. */
export function messageText(content: string | MessagePart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is TextPart => p.type === "text")
    .map(p => p.text)
    .join("\n");
}

/** Split a data URL into what Anthropic and Gemini want: media type + raw base64. */
export function splitDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("Image content must be a base64 data URL");
  return { mediaType: match[1], data: match[2] };
}

/** OpenAI-style content: a string passes through, parts become content blocks. */
export function toOpenAIContent(content: string | MessagePart[]): string | Array<Record<string, any>> {
  if (typeof content === "string") return content;
  return content.map(p =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image_url", image_url: { url: p.dataUrl } }
  );
}

/** Anthropic-style content blocks. */
export function toAnthropicContent(content: string | MessagePart[]): string | Array<Record<string, any>> {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    const { mediaType, data } = splitDataUrl(p.dataUrl);
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  });
}

/** Gemini-style parts. */
export function toGeminiParts(content: string | MessagePart[]): Array<Record<string, any>> {
  if (typeof content === "string") return [{ text: content }];
  return content.map(p => {
    if (p.type === "text") return { text: p.text };
    const { mediaType, data } = splitDataUrl(p.dataUrl);
    return { inlineData: { mimeType: mediaType, data } };
  });
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
