import type { SchematicComponent, Wire } from "@shared/schema";
import { TERMINAL_CONFIGS } from "./terminal-config";

export interface TerminalOverride {
  from?: string;
  to?: string;
}

const BUSBAR_TYPES = new Set(["busbar-positive", "busbar-negative"]);

/**
 * Bus bars are a single electrical node — every slot (pos-1..pos-6) is
 * interchangeable. This computes, for each bus bar, which physical slot each
 * connected wire should visually attach to so that wires fan out in the same
 * left-to-right order as the components they connect to, minimizing crossings.
 *
 * Returns a map of wireId -> { from?, to? } overriding the bus-bar endpoint's
 * terminal id. It does NOT mutate wire data (the electrical connection is
 * unchanged); it's purely a layout optimization applied at render time.
 */
export function computeBusbarTerminalOverrides(
  components: SchematicComponent[],
  wires: Wire[]
): Map<string, TerminalOverride> {
  const overrides = new Map<string, TerminalOverride>();
  const busbars = components.filter((c) => BUSBAR_TYPES.has(c.type));
  if (busbars.length === 0) return overrides;

  const compById = new Map(components.map((c) => [c.id, c]));
  const centerX = (c: SchematicComponent): number => {
    const cfg = TERMINAL_CONFIGS[c.type];
    return c.x + (cfg?.width || 120) / 2;
  };

  for (const bus of busbars) {
    const cfg = TERMINAL_CONFIGS[bus.type];
    if (!cfg) continue;

    // Physical slots, left-to-right.
    const slots = [...cfg.terminals].sort((a, b) => a.x - b.x);
    if (slots.length === 0) continue;

    // Gather wires touching this bus bar with the x of their opposite endpoint.
    const conns: Array<{ wireId: string; endpoint: "from" | "to"; otherX: number }> = [];
    for (const w of wires) {
      let endpoint: "from" | "to" | null = null;
      let otherId: string | null = null;
      if (w.fromComponentId === bus.id) {
        endpoint = "from";
        otherId = w.toComponentId;
      } else if (w.toComponentId === bus.id) {
        endpoint = "to";
        otherId = w.fromComponentId;
      }
      if (!endpoint || !otherId) continue;
      const other = compById.get(otherId);
      if (!other) continue;
      conns.push({ wireId: w.id, endpoint, otherX: centerX(other) });
    }

    if (conns.length < 2) continue; // nothing to reorder

    // Order wires by the position of the component they connect to, then lay
    // them across the slots in that same order.
    conns.sort((a, b) => a.otherX - b.otherX);

    conns.forEach((conn, i) => {
      // Use unique slots when there's room; otherwise distribute evenly and let
      // the normal fan-out handle slots that end up shared.
      const slotIndex =
        conns.length <= slots.length
          ? i
          : Math.min(slots.length - 1, Math.floor((i * slots.length) / conns.length));
      const slot = slots[slotIndex];
      if (!slot) return;
      const existing = overrides.get(conn.wireId) || {};
      existing[conn.endpoint] = slot.id;
      overrides.set(conn.wireId, existing);
    });
  }

  return overrides;
}
