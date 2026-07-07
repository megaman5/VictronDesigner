// Client-side tracking for observability

import { phCapture } from "@/lib/posthog";

let sessionTracked = false;

// Noise that isn't actionable: browser-extension errors and opaque
// cross-origin "Script error." reports. These were ~97% of logged errors
// (2000+ "runtime.sendMessage(). Tab not found." from a Chrome extension).
const ERROR_NOISE_PATTERNS = [
  /runtime\.sendMessage/i,
  /extension context invalidated/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-web-extension:\/\//i,
  /^Script error\.?$/,
  /ResizeObserver loop/i,
];

function isNoiseError(message: string, stack?: string, filename?: string): boolean {
  const haystacks = [message, stack, filename].filter(Boolean) as string[];
  return ERROR_NOISE_PATTERNS.some((re) => haystacks.some((h) => re.test(h)));
}

// Track page view
export async function trackPageView(page: string = window.location.pathname) {
  try {
    await fetch("/api/track/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        page,
        metadata: {
          referrer: document.referrer,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        }
      }),
    });
    sessionTracked = true;
  } catch (error) {
    console.error("Failed to track page view:", error);
  }
}

// Track user action
export async function trackAction(
  name: string,
  type: "action" | "export" | "save" | "load" | "feedback" = "action",
  metadata?: Record<string, any>
) {
  phCapture(name, { type, ...metadata });
  try {
    await fetch("/api/track/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, metadata }),
    });
  } catch (error) {
    console.error("Failed to track action:", error);
  }
}

// Track client-side error
export async function trackError(
  message: string,
  stack?: string,
  metadata?: Record<string, any>
) {
  if (isNoiseError(message, stack, metadata?.filename)) return;
  phCapture("client_error", { message, ...metadata });
  try {
    await fetch("/api/track/error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, stack, metadata }),
    });
  } catch (error) {
    console.error("Failed to track error:", error);
  }
}

// After a deploy, hashed chunk filenames change and clients still on the old
// index.html fail to lazy-load modules ("Failed to fetch dynamically imported
// module" / "'text/html' is not a valid JavaScript MIME type"). Reload once
// to pick up the new build instead of leaving the user on a broken page.
function setupStaleChunkRecovery() {
  const RELOAD_FLAG = "vd-chunk-reload";
  const reloadOnce = () => {
    if (sessionStorage.getItem(RELOAD_FLAG)) return; // avoid reload loops
    sessionStorage.setItem(RELOAD_FLAG, "1");
    window.location.reload();
  };

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnce();
  });

  window.addEventListener("unhandledrejection", (event) => {
    const msg = String(event.reason?.message || event.reason || "");
    if (
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /not a valid JavaScript MIME type/i.test(msg)
    ) {
      event.preventDefault();
      reloadOnce();
    }
  });
}

// Initialize tracking on app load
export function initTracking() {
  if (sessionTracked) return;

  setupStaleChunkRecovery();

  // Track initial page view
  trackPageView();

  // Set up global error handler
  window.addEventListener("error", (event) => {
    trackError(
      event.message,
      event.error?.stack,
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      }
    );
  });

  // Track unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    trackError(
      `Unhandled Promise Rejection: ${event.reason}`,
      event.reason?.stack,
      { type: "unhandledrejection" }
    );
  });
}
