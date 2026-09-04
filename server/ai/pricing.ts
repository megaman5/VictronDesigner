/**
 * Model pricing, in USD per million tokens.
 *
 * Used to estimate what a request cost so benchmark runs can be compared on
 * price as well as quality, and so per-user spend can be capped.
 *
 * These are list prices and go stale - `asOf` records when each block was
 * last checked. An unknown model yields a null cost rather than a guess, so
 * callers can tell "free" apart from "not priced".
 */

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cached input reads, where the provider prices them separately. */
  cachedInputPerMTok?: number;
  /**
   * Vendor-specific long-prompt surcharge. Only set where the vendor actually
   * has one - OpenAI charges more past 272k input tokens, Anthropic and Google
   * do not use that rule, so applying it to everything would over-bill them.
   */
  longContext?: {
    thresholdTokens: number;
    inputMultiplier: number;
    outputMultiplier: number;
  };
}

/** OpenAI's surcharge past 272k input tokens: 2x input, 1.5x output. */
const OPENAI_LONG_CONTEXT = {
  thresholdTokens: 272_000,
  inputMultiplier: 2,
  outputMultiplier: 1.5,
} as const;

const ASOF = "2026-08-20";

/**
 * Sources:
 * - Anthropic: first-party API rates (claude-api reference, 2026-06-24)
 * - OpenAI: openai.com GPT-5.6 announcement + corroborating trade coverage,
 *   after the 2026-07-30 cuts (Terra -20%, Luna -80%)
 * - Google/OpenRouter: OpenRouter's /api/v1/models pricing feed
 *
 * NOTE: OpenRouter's feed lists gpt-5.6-sol at $2.50/$15.00, which contradicts
 * two independent sources giving $5.00/$30.00. We use the higher first-party
 * figure - under-estimating spend is the worse failure for a budget cap.
 *
 * Cached input is ~10% of the input rate across all three vendors, which is
 * what estimateCostUsd assumes when a model has no explicit cached rate.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // --- Anthropic ---
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },

  // --- OpenAI GPT-5.6 (rates as of the 2026-07-30 cuts) ---
  "gpt-5.6-sol": { inputPerMTok: 5, outputPerMTok: 30, cachedInputPerMTok: 0.5 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.6-terra": { inputPerMTok: 2, outputPerMTok: 12, cachedInputPerMTok: 0.2 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.6-luna": { inputPerMTok: 0.2, outputPerMTok: 1.2, cachedInputPerMTok: 0.02 , longContext: OPENAI_LONG_CONTEXT },

  // --- OpenAI GPT-5.x ---
  "gpt-5.5": { inputPerMTok: 5, outputPerMTok: 30 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.5-pro": { inputPerMTok: 30, outputPerMTok: 180 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.4": { inputPerMTok: 2.5, outputPerMTok: 15, cachedInputPerMTok: 0.25 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.4-mini": { inputPerMTok: 0.75, outputPerMTok: 4.5 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.4-nano": { inputPerMTok: 0.2, outputPerMTok: 1.25 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.4-pro": { inputPerMTok: 30, outputPerMTok: 180 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.3-codex": { inputPerMTok: 1.75, outputPerMTok: 14 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.2": { inputPerMTok: 1.75, outputPerMTok: 14 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.2-pro": { inputPerMTok: 21, outputPerMTok: 168 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5.1": { inputPerMTok: 1.25, outputPerMTok: 10 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5": { inputPerMTok: 1.25, outputPerMTok: 10 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5-mini": { inputPerMTok: 0.25, outputPerMTok: 2 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5-nano": { inputPerMTok: 0.05, outputPerMTok: 0.4 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-5-pro": { inputPerMTok: 15, outputPerMTok: 120 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-4.1-mini": { inputPerMTok: 0.4, outputPerMTok: 1.6 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 , longContext: OPENAI_LONG_CONTEXT },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 , longContext: OPENAI_LONG_CONTEXT },

  // --- Frontier models reached via OpenRouter (rates from its /models feed,
  // checked 2026-09-01). lookupPrice strips the vendor prefix, so these also
  // cover the bare ids. ---
  "grok-4.6": { inputPerMTok: 2, outputPerMTok: 6 },
  "grok-4.5": { inputPerMTok: 2, outputPerMTok: 6 },
  "kimi-k3": { inputPerMTok: 3, outputPerMTok: 15 },
  "qwen3.8-max": { inputPerMTok: 2, outputPerMTok: 6 },
  "mistral-medium-3-5": { inputPerMTok: 1.5, outputPerMTok: 7.5 },
  "nova-premier-v1": { inputPerMTok: 2.5, outputPerMTok: 12.5 },
  "glm-5v-turbo": { inputPerMTok: 1.2, outputPerMTok: 4 },

  // --- Google Gemini ---
  // 3.5/3.6 rates from OpenRouter's feed, checked 2026-08-31 (Google retired
  // gemini-2.5-flash for new API users that month).
  "gemini-3.7-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "gemini-3.6-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  "gemini-3.5-flash": { inputPerMTok: 1.5, outputPerMTok: 9 },
  "gemini-3.5-flash-lite": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-3.1-pro-preview": { inputPerMTok: 2, outputPerMTok: 12 },
  "gemini-3.1-flash-lite": { inputPerMTok: 0.25, outputPerMTok: 1.5 },
  "gemini-3-flash-preview": { inputPerMTok: 0.5, outputPerMTok: 3 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "gemini-2.5-flash-lite": { inputPerMTok: 0.1, outputPerMTok: 0.4 },
};

export const PRICING_AS_OF = ASOF;

function costFromPrice(
  price: ModelPrice,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }
): number {
  const cached = usage.cachedInputTokens ?? 0;
  const uncachedInput = Math.max(0, usage.inputTokens - cached);

  const cachedRate = price.cachedInputPerMTok ?? price.inputPerMTok * 0.1;

  const lc = price.longContext;
  const overThreshold = lc !== undefined && usage.inputTokens > lc.thresholdTokens;
  const inMul = overThreshold ? lc!.inputMultiplier : 1;
  const outMul = overThreshold ? lc!.outputMultiplier : 1;

  return (
    (uncachedInput / 1_000_000) * price.inputPerMTok * inMul +
    (cached / 1_000_000) * cachedRate * inMul +
    (usage.outputTokens / 1_000_000) * price.outputPerMTok * outMul
  );
}

/**
 * Cost in USD for a request, or null when the model is not in the table.
 * Null means "unknown", never "free" - callers must not treat it as zero.
 */
export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }
): number | null {
  const price = lookupPrice(model);
  if (!price) return null;
  return costFromPrice(price, usage);
}

/**
 * Flat token assumption for rows with no recorded token usage - every ai_logs
 * row from before cost tracking actually shipped (see routes.ts "Recent
 * Changes" - cost_usd was null for all of them, not just unpriced models).
 * Sized to the one platform-billed request that does have real counts
 * (27,018 in / 5,544 out on a wire-components call).
 */
export const FALLBACK_ESTIMATE_TOKENS = { inputTokens: 25_000, outputTokens: 5_500 };

/** Stand-in for a model name pricing has never heard of. Mid-tier GPT-5 rates. */
const GENERIC_FALLBACK_PRICE: ModelPrice = { inputPerMTok: 2, outputPerMTok: 12 };

/**
 * Baseline cost estimate for a request with no recorded cost - used only for
 * admin reporting (the AI Usage dashboard), never for quota enforcement.
 * Always returns a number: a known model uses its real per-token rate against
 * the flat token assumption above; an unrecognized model falls back further
 * to a generic mid-tier rate, so the dashboard always has a number to sum
 * instead of an unpriced gap.
 */
export function estimateFallbackCostUsd(model: string | null): number {
  const price = (model ? lookupPrice(model) : null) ?? GENERIC_FALLBACK_PRICE;
  return costFromPrice(price, FALLBACK_ESTIMATE_TOKENS);
}

/**
 * Look up a price, tolerating provider prefixes ("anthropic/claude-opus-5")
 * and dated snapshots ("gpt-5.4-2026-03-05").
 */
export function lookupPrice(model: string): ModelPrice | null {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  const withoutVendor = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  if (MODEL_PRICING[withoutVendor]) return MODEL_PRICING[withoutVendor];

  // Strip a trailing ISO date snapshot suffix
  const undated = withoutVendor.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (MODEL_PRICING[undated]) return MODEL_PRICING[undated];

  // Strip rolling-alias suffixes: "gpt-5.2-chat-latest" and "gpt-5.2-latest"
  // are the same billed model as "gpt-5.2". Without this they priced as null,
  // which the quota code correctly treats as "unknown" - so a large share of
  // real traffic was never counted against anyone's allowance.
  const unaliased = undated.replace(/-(?:chat-)?latest$/, "");
  if (MODEL_PRICING[unaliased]) return MODEL_PRICING[unaliased];

  return null;
}

export function isPriced(model: string): boolean {
  return lookupPrice(model) !== null;
}
