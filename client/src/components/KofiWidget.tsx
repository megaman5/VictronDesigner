import { useEffect } from "react";

const SCRIPT_SRC = "https://storage.ko-fi.com/cdn/scripts/overlay-widget.js";
const KOFI_USERNAME = "megaman5";

// The overlay draws itself straight into <body>, so it must only be drawn once
// per page load - React re-mounts would otherwise stack duplicate buttons.
let drawn = false;

const POSITION_STYLE_ID = "kofi-widget-position";

/**
 * Ko-fi pins the button bottom-LEFT from its own remote stylesheet
 * (floating-chat-wrapper.css: `position: fixed; bottom: 16px; left: 16px`),
 * and the widget's `floating-chat.core.position.*` config key is dead - it is
 * declared in the script's defaults but never read. So the only reliable way
 * to move it is to override those two classes here.
 *
 * The wrap already carries `max-width: 180px`, so flipping the anchor is
 * enough; the popup sits `position: relative` inside the wrap and follows it.
 */
function injectPositionOverride() {
  if (document.getElementById(POSITION_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = POSITION_STYLE_ID;
  style.textContent = `
    .floatingchat-container-wrap,
    .floatingchat-container-wrap-mobi {
      left: auto !important;
      right: 24px !important;
    }
  `;
  document.head.appendChild(style);
}

declare global {
  interface Window {
    kofiWidgetOverlay?: {
      draw: (username: string, config: Record<string, string>) => void;
    };
  }
}

function draw() {
  if (drawn || !window.kofiWidgetOverlay) return;
  window.kofiWidgetOverlay.draw(KOFI_USERNAME, {
    type: "floating-chat",
    "floating-chat.donateButton.text": "Tip Me",
    "floating-chat.donateButton.background-color": "#794bc4",
    "floating-chat.donateButton.text-color": "#fff",
  });
  drawn = true;
}

/**
 * Ko-fi "Tip Me" floating button.
 *
 * Loaded after mount rather than from index.html so it never blocks first
 * paint, and so it stays off the admin pages. If the CDN is unreachable the
 * button simply does not appear - nothing else is affected.
 */
export function KofiWidget() {
  useEffect(() => {
    // Inject before the script draws, so the button never flashes bottom-left
    injectPositionOverride();
    if (drawn) return;

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      if (window.kofiWidgetOverlay) draw();
      else existing.addEventListener("load", draw, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", draw, { once: true });
    script.addEventListener("error", () => {
      console.warn("[Ko-fi] widget script failed to load");
    }, { once: true });
    document.body.appendChild(script);
  }, []);

  return null;
}
