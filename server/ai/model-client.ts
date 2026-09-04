import OpenAI from "openai";

/**
 * Picks the vendor that actually serves a configured model id.
 *
 * The production endpoints talk to the OpenAI SDK directly rather than going
 * through server/ai/providers (they need streaming, which that abstraction
 * does not expose). That left the admin "AI model" setting able to name any
 * model while every request went to OpenAI, so choosing another vendor's
 * model failed at request time with a 404 instead of at configuration time.
 *
 * OpenRouter's API is OpenAI-compatible down to streaming and
 * response_format, so routing a vendor-prefixed id there keeps every existing
 * call site unchanged.
 */

/** True for ids like "google/gemini-3.1-pro-preview" - OpenRouter's form. */
export function isOpenRouterModel(model: string): boolean {
  return model.includes("/");
}

/** A bare "gemini-*" id, served by Google directly rather than a reseller. */
export function isGeminiModel(model: string): boolean {
  return !isOpenRouterModel(model) && model.startsWith("gemini-");
}

export function clientForModel(model: string): OpenAI {
  if (isGeminiModel(model)) {
    // Google exposes an OpenAI-compatible surface, verified to handle both
    // response_format json_object and streaming, so the call sites are
    // unchanged. Preferred over the same model via OpenRouter because it
    // bills our own Google key rather than a reseller balance.
    return new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }
  if (isOpenRouterModel(model)) {
    return new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        // OpenRouter uses these for attribution on its dashboards.
        "HTTP-Referer": "https://victrondesigner.com",
        "X-Title": "VictronDesigner",
      },
    });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/** The key a given model needs, so a "no key" guard checks the right one. */
export function hasKeyForModel(model: string): boolean {
  if (isGeminiModel(model)) return Boolean(process.env.GEMINI_API_KEY);
  if (isOpenRouterModel(model)) return Boolean(process.env.OPENROUTER_API_KEY);
  return Boolean(process.env.OPENAI_API_KEY);
}
