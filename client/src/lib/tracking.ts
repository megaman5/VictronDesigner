// Client-side tracking for observability

let sessionTracked = false;

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

// Initialize tracking on app load
export function initTracking() {
  if (sessionTracked) return;
  
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
