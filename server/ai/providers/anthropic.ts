import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderCredentials,
} from "./types";
import { ProviderError, messageText, toAnthropicContent } from "./types";

/**
 * Native Anthropic adapter.
 *
 * Two shape differences from the OpenAI style matter here: the system prompt
 * is a top-level field rather than a message, and current models reject
 * sampling parameters (temperature/top_p) outright with a 400 - so we never
 * send them and report samplingApplied: false.
 *
 * The system prompt is marked as an ephemeral cache breakpoint. Every skill
 * (system-design, wire-components) and the benchmark judge send a large,
 * mostly-static system prompt on every call - a fresh request each time, not
 * an accumulated conversation, but Anthropic's cache keys on the request
 * prefix itself, so repeats/iterations of the same case (and the judge's
 * fully-static rubric) still hit. Below the model's minimum cacheable prefix
 * (1024-4096 tokens depending on tier) the breakpoint is simply a no-op, so
 * this is safe to always send. Reported via usage.cache_read_input_tokens,
 * already mapped to cachedInputTokens below.
 */
export class AnthropicProvider implements Provider {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic";
  readonly requiresBaseUrl = false;

  listKnownModels(): string[] {
    return [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
    ];
  }

  async chat(req: ChatRequest, creds: ProviderCredentials): Promise<ChatResponse> {
    const client = new Anthropic({
      apiKey: creds.apiKey,
      ...(creds.baseUrl ? { baseURL: creds.baseUrl } : {}),
    });

    const systemText = req.messages
      .filter(m => m.role === "system")
      .map(m => messageText(m.content))
      .join("\n\n");

    const messages = req.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role as "user" | "assistant",
        content: toAnthropicContent(m.content) as any,
      }));

    if (messages.length === 0) {
      throw new ProviderError("Anthropic requires at least one non-system message", this.id);
    }

    // JSON mode has no dedicated flag here; the instruction goes in the system
    // prompt and the response is parsed by the caller.
    const systemPrompt = req.json
      ? `${systemText}\n\nRespond with a single valid JSON object and nothing else. No markdown fences, no prose.`
      : systemText;

    const system: Anthropic.TextBlockParam[] | undefined = systemPrompt
      ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
      : undefined;

    try {
      // Streaming, not create(): the SDK rejects non-streaming requests it
      // estimates could run past 10 minutes, which Fable's long reasoning
      // turns hit even at moderate max_tokens. finalMessage() still returns
      // the same shape as create() once the stream completes.
      const stream = client.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxOutputTokens ?? 16000,
          ...(system ? { system } : {}),
          messages,
        },
        { signal: req.signal }
      );
      const response = await stream.finalMessage();

      // content is a discriminated union - narrow before reading .text
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("");

      return {
        text,
        servedModel: response.model,
        samplingApplied: false, // sampling params are rejected by current models
        usage: {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
          cachedInputTokens: response.usage.cache_read_input_tokens ?? undefined,
        },
        raw: response,
      };
    } catch (err: any) {
      const status = err?.status;
      throw new ProviderError(
        err?.message ?? "Anthropic request failed",
        this.id,
        status,
        status === 429 || (typeof status === "number" && status >= 500)
      );
    }
  }
}

export const anthropicProvider = new AnthropicProvider();
