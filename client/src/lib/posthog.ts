// PostHog analytics integration.
// The project API key (a public phc_ key) is served by the backend from
// POSTHOG_PROJ so the client bundle doesn't need a rebuild to rotate it.
// If the key isn't configured, every helper is a silent no-op.
import posthog from "posthog-js";

let initialized = false;

export async function initPostHog(): Promise<void> {
  if (initialized) return;
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const config = await res.json();
    if (!config.posthogKey) return;

    posthog.init(config.posthogKey, {
      api_host: config.posthogHost || "https://us.i.posthog.com",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      persistence: "localStorage+cookie",
    });
    initialized = true;
  } catch {
    // Analytics must never break the app
  }
}

export function phCapture(event: string, properties?: Record<string, any>) {
  if (!initialized) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // ignore
  }
}

export function phIdentify(id: string, properties?: Record<string, any>) {
  if (!initialized) return;
  try {
    posthog.identify(id, properties);
  } catch {
    // ignore
  }
}
