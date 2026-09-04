import { GoogleGenAI } from "@google/genai";
import type {
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderCredentials,
} from "./types";
import { ProviderError, messageText, toGeminiParts } from "./types";

/**
 * Native Google Gemini adapter.
 *
 * Gemini keeps the system prompt in `config.systemInstruction` and asks for
 * JSON via `responseMimeType`, so the mapping is mechanical but not the same
 * as either OpenAI or Anthropic.
 *
 * Prompt caching, like OpenAI's, is implicit for 2.5+ generation Gemini
 * models (which includes every gemini-3.x id this app calls) - a matching
 * prefix is cached and discounted automatically, no request field to set.
 * Already reported below via usageMetadata.cachedContentTokenCount.
 */
export class GeminiProvider implements Provider {
  readonly id = "gemini" as const;
  readonly label = "Google Gemini";
  readonly requiresBaseUrl = false;

  listKnownModels(): string[] {
    return [
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      // Retired for new API users as of 2026-08; kept for grandfathered keys.
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ];
  }

  async chat(req: ChatRequest, creds: ProviderCredentials): Promise<ChatResponse> {
    const client = new GoogleGenAI({ apiKey: creds.apiKey });

    const systemInstruction = req.messages
      .filter(m => m.role === "system")
      .map(m => messageText(m.content))
      .join("\n\n");

    // Gemini expects alternating user/model turns; our skills only ever send a
    // system prompt plus a single user message.
    const contents = req.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: toGeminiParts(m.content),
      }));

    if (contents.length === 0) {
      throw new ProviderError("Gemini requires at least one non-system message", this.id);
    }

    try {
      const response = await client.models.generateContent({
        model: req.model,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(req.json ? { responseMimeType: "application/json" } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
        },
      });

      const usage = response.usageMetadata ?? {};
      return {
        text: response.text ?? "",
        servedModel: req.model,
        samplingApplied: req.temperature !== undefined,
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: usage.candidatesTokenCount ?? 0,
          reasoningTokens: usage.thoughtsTokenCount,
          cachedInputTokens: usage.cachedContentTokenCount,
        },
        raw: response,
      };
    } catch (err: any) {
      const status = err?.status ?? err?.code;
      throw new ProviderError(
        err?.message ?? "Gemini request failed",
        this.id,
        typeof status === "number" ? status : undefined,
        status === 429 || (typeof status === "number" && status >= 500)
      );
    }
  }
}

export const geminiProvider = new GeminiProvider();
