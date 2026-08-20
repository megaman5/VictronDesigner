import type { Provider, ProviderCredentials, ProviderId } from "./types";
import { ProviderError } from "./types";
import { openaiProvider, openrouterProvider, localProvider } from "./openai-compatible";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";

export * from "./types";
export { estimateCostUsd, isPriced, MODEL_PRICING, PRICING_AS_OF } from "../pricing";

export const PROVIDERS: Record<ProviderId, Provider> = {
  openai: openaiProvider,
  openrouter: openrouterProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  local: localProvider,
};

export function getProvider(id: ProviderId): Provider {
  const p = PROVIDERS[id];
  if (!p) throw new ProviderError(`Unknown provider "${id}"`, id);
  return p;
}

/** Environment variable holding the platform key for each provider. */
const PLATFORM_KEY_ENV: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  local: "LOCAL_AI_API_KEY",
};

export function platformCredentials(id: ProviderId): ProviderCredentials | null {
  const apiKey = process.env[PLATFORM_KEY_ENV[id]];
  if (!apiKey) return null;
  const baseUrl = id === "local" ? process.env.LOCAL_AI_BASE_URL : undefined;
  return { apiKey, ...(baseUrl ? { baseUrl } : {}) };
}

export function hasPlatformKey(id: ProviderId): boolean {
  return platformCredentials(id) !== null;
}

/**
 * Guess which provider serves a model id. Used so callers can name a model
 * without also naming a provider; an explicit provider always wins.
 */
export function inferProvider(model: string): ProviderId {
  if (model.includes("/")) return "openrouter"; // vendor/model is OpenRouter's form
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gemini-")) return "gemini";
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  return "openai";
}

export interface ResolvedTarget {
  provider: Provider;
  credentials: ProviderCredentials;
  /** True when the key came from the platform rather than the user. */
  usingPlatformKey: boolean;
}

/**
 * Work out which provider and key to use for a call.
 * A caller-supplied key is always preferred; otherwise the platform key is
 * used, which is what usage limits are enforced against.
 */
export function resolveTarget(opts: {
  model: string;
  providerId?: ProviderId;
  userCredentials?: ProviderCredentials | null;
}): ResolvedTarget {
  const providerId = opts.providerId ?? inferProvider(opts.model);
  const provider = getProvider(providerId);

  if (opts.userCredentials?.apiKey) {
    return { provider, credentials: opts.userCredentials, usingPlatformKey: false };
  }

  const platform = platformCredentials(providerId);
  if (!platform) {
    throw new ProviderError(
      `No API key available for ${provider.label}. Add your own key or set ${PLATFORM_KEY_ENV[providerId]}.`,
      providerId,
      401
    );
  }
  return { provider, credentials: platform, usingPlatformKey: true };
}

/** Every provider plus whether the server can currently call it. */
export function describeProviders() {
  return (Object.keys(PROVIDERS) as ProviderId[]).map(id => {
    const p = PROVIDERS[id];
    return {
      id,
      label: p.label,
      requiresBaseUrl: p.requiresBaseUrl,
      hasPlatformKey: hasPlatformKey(id),
      knownModels: p.listKnownModels(),
    };
  });
}
