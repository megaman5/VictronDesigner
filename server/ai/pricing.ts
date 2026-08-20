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
}

const ASOF = "2026-06-24";

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Anthropic (first-party API rates)
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

export const PRICING_AS_OF = ASOF;

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

  const cached = usage.cachedInputTokens ?? 0;
  const uncachedInput = Math.max(0, usage.inputTokens - cached);

  const cachedRate = price.cachedInputPerMTok ?? price.inputPerMTok * 0.1;

  return (
    (uncachedInput / 1_000_000) * price.inputPerMTok +
    (cached / 1_000_000) * cachedRate +
    (usage.outputTokens / 1_000_000) * price.outputPerMTok
  );
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

  return null;
}

export function isPriced(model: string): boolean {
  return lookupPrice(model) !== null;
}
