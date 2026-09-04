import { createCanvas } from "canvas";
import type { SchematicComponent, Wire } from "@shared/schema";
import { getComponentDimensions, getComponentTerminals } from "../../client/src/lib/terminal-config";

/**
 * Renders a design to a PNG for the model to look at.
 *
 * The iterative loop's weak point is spatial: it cannot tell from JSON that two
 * components overlap, that a run crosses the whole canvas, or that one corner
 * is empty while another is crowded. A picture makes those obvious.
 *
 * This is deliberately a schematic, not a copy of the canvas artwork - boxes,
 * labels, terminals and wire paths. It has to run per iteration on the server
 * with no DOM, and spacing is the thing being communicated, so redrawing every
 * component's bespoke SVG would be cost without benefit.
 */

/** Wire colours by polarity, matching the canvas conventions. */
const WIRE_COLORS: Record<string, string> = {
  positive: "#dc2626",
  negative: "#1f2937",
  ground: "#16a34a",
  hot: "#dc2626",
  neutral: "#9ca3af",
};

const CANVAS_W = 2000;
const CANVAS_H = 1500;

export interface RenderOptions {
  /** Longest edge of the output image. Smaller costs fewer input tokens. */
  maxDimension?: number;
  /** Draw the 20px design grid. Off by default - it adds noise at small sizes. */
  showGrid?: boolean;
}

export interface RenderedSchematic {
  /** Raw PNG bytes. */
  png: Buffer;
  /** Same image as a data URL, which is what the provider adapters want. */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Crop to the content plus a margin, so a design using one corner of the
 * 2000x1500 canvas does not render as a stamp in the middle of white space.
 */
function contentBounds(components: SchematicComponent[]) {
  if (components.length === 0) {
    return { minX: 0, minY: 0, maxX: CANVAS_W, maxY: CANVAS_H };
  }
  const margin = 120;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const c of components) {
    const d = getComponentDimensions(c.type, c.properties as any);
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + d.width);
    maxY = Math.max(maxY, c.y + d.height);
  }

  return {
    minX: Math.max(0, minX - margin),
    minY: Math.max(0, minY - margin),
    maxX: Math.min(CANVAS_W, maxX + margin),
    maxY: Math.min(CANVAS_H, maxY + margin),
  };
}

export function renderSchematicPng(
  components: SchematicComponent[],
  wires: Wire[],
  options: RenderOptions = {}
): RenderedSchematic {
  const maxDimension = options.maxDimension ?? 1024;
  const b = contentBounds(components);
  const contentW = Math.max(1, b.maxX - b.minX);
  const contentH = Math.max(1, b.maxY - b.minY);

  const scale = Math.min(maxDimension / contentW, maxDimension / contentH, 1.5);
  const width = Math.round(contentW * scale);
  const height = Math.round(contentH * scale);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-b.minX, -b.minY);

  if (options.showGrid) {
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1 / scale;
    for (let x = Math.floor(b.minX / 20) * 20; x <= b.maxX; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, b.minY); ctx.lineTo(x, b.maxY); ctx.stroke();
    }
    for (let y = Math.floor(b.minY / 20) * 20; y <= b.maxY; y += 20) {
      ctx.beginPath(); ctx.moveTo(b.minX, y); ctx.lineTo(b.maxX, y); ctx.stroke();
    }
  }

  const byId = new Map(components.map(c => [c.id, c]));

  // Wires first so components sit on top of them.
  ctx.lineWidth = 3 / scale > 3 ? 3 : Math.max(2, 3 / scale);
  for (const w of wires) {
    const from = byId.get(w.fromComponentId);
    const to = byId.get(w.toComponentId);
    if (!from || !to) continue;

    const a = terminalPoint(from, w.fromTerminal);
    const z = terminalPoint(to, w.toTerminal);
    if (!a || !z) continue;

    ctx.strokeStyle = WIRE_COLORS[w.polarity] ?? "#6b7280";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    // Orthogonal dog-leg, mirroring how the canvas routes rather than drawing
    // a diagonal the real design would never contain.
    const midX = (a.x + z.x) / 2;
    ctx.lineTo(midX, a.y);
    ctx.lineTo(midX, z.y);
    ctx.lineTo(z.x, z.y);
    ctx.stroke();
  }

  // Components.
  for (const c of components) {
    const d = getComponentDimensions(c.type, c.properties as any);

    ctx.fillStyle = "#eff6ff";
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(c.x, c.y, d.width, d.height);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "center";
    fitText(ctx, c.name || c.type, d.width - 8, 15, true);
    ctx.fillText(c.name || c.type, c.x + d.width / 2, c.y + d.height / 2);

    ctx.fillStyle = "#64748b";
    fitText(ctx, c.type, d.width - 8, 12, false);
    ctx.fillText(c.type, c.x + d.width / 2, c.y + d.height / 2 + 16);

    // Terminals, so the model can see which side a connection has to leave from.
    for (const t of getComponentTerminals(c.type, c.properties as any)) {
      ctx.fillStyle = terminalColor(t.type);
      ctx.beginPath();
      ctx.arc(c.x + t.x, c.y + t.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  const png = canvas.toBuffer("image/png");
  return {
    png,
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    width,
    height,
  };

  function terminalPoint(comp: SchematicComponent, terminalId: string) {
    const t = getComponentTerminals(comp.type, comp.properties as any).find(x => x.id === terminalId);
    if (!t) return null;
    return { x: comp.x + t.x, y: comp.y + t.y };
  }
}

function terminalColor(type: string): string {
  if (type.includes("positive")) return "#dc2626";
  if (type.includes("negative")) return "#1f2937";
  if (type === "ground") return "#16a34a";
  return "#9ca3af";
}

/**
 * Pick the largest font size at which a label still fits its box.
 *
 * These labels used to be truncated to fit ("300A Positive Bus" -> "300A Posit..."),
 * which the vision judges reliably marked down as a fault in the *design* -
 * they cannot tell a clipped label from a badly named component. Shrinking to
 * fit keeps the name readable, so a judge grades the layout rather than the
 * renderer. Very long names simply render at the 8px floor.
 */
export function fitText(ctx: any, text: string, maxWidth: number, preferredPx: number, bold: boolean): void {
  const weight = bold ? "bold " : "";
  for (let px = preferredPx; px >= 8; px--) {
    ctx.font = `${weight}${px}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return;
  }
  ctx.font = `${weight}8px sans-serif`;
}

/**
 * Vision-capable model check. Sending an image to a text-only model is a hard
 * API error rather than a graceful degrade, so the layout picture is only
 * attached when the model can actually look at it.
 */
export function modelSupportsVision(model: string): boolean {
  const m = (model ?? "").toLowerCase();
  if (!m) return false;
  if (m.includes("audio") || m.includes("realtime") || m.includes("embedding")) return false;
  // A provider prefix ("anthropic/claude-opus-5") means OpenRouter routing;
  // vision support belongs to the underlying model either way.
  const bare = m.includes("/") ? m.slice(m.indexOf("/") + 1) : m;
  return (
    bare.startsWith("gpt-4o") ||
    bare.startsWith("gpt-4.1") ||
    bare.startsWith("gpt-5") ||
    bare.startsWith("o3") ||
    bare.startsWith("o4") ||
    // All current Claude (3+) and Gemini (1.5+) chat models accept images.
    bare.startsWith("claude-") ||
    bare.startsWith("gemini-")
  );
}

/**
 * Build the user turn for an iteration, attaching a rendered picture of the
 * design so far.
 *
 * The loop's blind spot is spatial: from JSON alone a model cannot see that
 * two components overlap, that a run crosses the whole canvas, or that one
 * corner is crowded while another is empty. Rendering the current state each
 * round - rather than once up front - means it is looking at what it just
 * produced rather than at the layout it started from.
 *
 * Returns a plain string when there is nothing to show or the model cannot
 * see, so callers can pass the result straight through either way.
 */
export function buildIterationUserMessage(
  text: string,
  design: { components?: any[]; wires?: any[] } | null | undefined,
  model: string
): string | Array<Record<string, any>> {
  if (!design?.components?.length || !modelSupportsVision(model)) return text;

  try {
    const image = renderSchematicPng(design.components as any, (design.wires ?? []) as any, {
      maxDimension: 1024,
    });
    return [
      {
        type: "text",
        text: `${text}\n\nThe image shows the current layout. Use it to judge spacing, overlaps and how far wires have to run.`,
      },
      { type: "image_url", image_url: { url: image.dataUrl } },
    ];
  } catch (err: any) {
    // A rendering failure must not take the whole generation down - fall back
    // to the text-only prompt this endpoint used before.
    console.warn("[ai-vision] could not render layout:", err?.message);
    return text;
  }
}
