import type { SchematicComponent, Wire } from "@shared/schema";
import { getComponentTerminals, type Terminal } from "../client/src/lib/terminal-config";
import { solveDcWireCurrents } from "../client/src/lib/dc-current-solver";
import { calculateWireSize, calculateInverterDCInput, getACVoltage } from "./wire-calculator";

/**
 * Deterministic repair pass for AI-generated designs.
 *
 * The model gets two things wrong far more than anything else: it invents
 * terminal ids that do not exist on a component, and it guesses wire gauges
 * instead of sizing them. Both are things we can work out exactly, so we fix
 * them here rather than spending iterations asking the model to try again.
 */

export interface DesignRepair {
  kind: "terminal-remapped" | "wire-dropped" | "gauge-resized";
  wireId?: string;
  detail: string;
}

export interface NormalizedDesign {
  components: SchematicComponent[];
  wires: Wire[];
  repairs: DesignRepair[];
}

const INVERTER_TYPES = new Set(["inverter", "multiplus", "phoenix-inverter", "quattro"]);

/** Terminal types that can legitimately carry a wire of the given polarity. */
function compatibleTypes(polarity: string | undefined): string[] {
  switch (polarity) {
    case "positive": return ["positive", "pv-positive"];
    case "negative": return ["negative", "pv-negative"];
    case "hot": return ["ac-in", "ac-out", "hot"];
    case "neutral": return ["neutral", "ac-in", "ac-out"];
    case "ground": return ["ground"];
    default: return [];
  }
}

/** Shared words between two terminal ids, used to pick the closest match. */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/[-_]/));
  const tb = b.split(/[-_]/);
  return tb.filter(t => ta.has(t)).length;
}

/**
 * Components whose terminals are interchangeable slots on one electrical node.
 * Only these get the "spread across free slots" preference - on anything else
 * the terminals mean different things and shuffling them would be wrong.
 */
/**
 * Devices with a battery side and a system side that must not be swapped: all
 * current has to pass through the shunt/contactor for them to work at all.
 * Only these get side-aware terminal matching - an MPPT's "batt" vs "pv"
 * terminals are a different distinction entirely.
 */
const BATTERY_SIDE_DEVICES = new Set(["lynx-shunt", "lynx-smart-bms", "smartshunt"]);

const INTERCHANGEABLE_SLOTS = new Set([
  "busbar-positive",
  "busbar-negative",
  "lynx-power-in",
  "lynx-distributor",
  "dc-panel",
  "ac-panel",
]);

/**
 * Choose the best real terminal to stand in for one the model invented.
 *
 * Scoring, in order of weight: an exact polarity-type match; whether the other
 * end of the wire implies the battery side or the system side (a Lynx Shunt or
 * Smart BMS must not have those swapped); a free slot, but only where slots are
 * genuinely interchangeable; then the closest name.
 */
function pickReplacement(
  invalidId: string,
  polarity: string | undefined,
  terminals: Terminal[],
  usedTerminalIds: Set<string>,
  componentType: string,
  otherEndType: string | undefined
): Terminal | null {
  const allowed = compatibleTypes(polarity);
  const candidates = terminals.filter(t => allowed.includes(t.type));
  if (candidates.length === 0) return null;

  const exactPolarity = polarity === "positive" ? "positive"
    : polarity === "negative" ? "negative"
    : null;

  const slotsInterchangeable = INTERCHANGEABLE_SLOTS.has(componentType);
  const otherEndIsBattery = otherEndType === "battery";

  const sideScore = (t: Terminal) => {
    if (!BATTERY_SIDE_DEVICES.has(componentType)) return 0;
    const isBatterySide = t.id.includes("batt");
    // Wire from the bank lands on the battery side; anything else on the system side.
    return otherEndIsBattery === isBatterySide ? 50 : -50;
  };

  const score = (t: Terminal) =>
    (exactPolarity && t.type === exactPolarity ? 100 : 0) +
    sideScore(t) +
    (slotsInterchangeable && !usedTerminalIds.has(t.id) ? 25 : 0) +
    tokenOverlap(invalidId, t.id) * 5;

  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Repair invalid terminal references and size every wire the design can be
 * reasoned about. Returns new arrays; the inputs are not mutated.
 */
export function normalizeAIDesign(
  componentsIn: SchematicComponent[],
  wiresIn: Wire[],
  systemVoltage: number
): NormalizedDesign {
  const components = componentsIn.map(c => ({ ...c }));
  const repairs: DesignRepair[] = [];

  const byId = new Map(components.map(c => [c.id, c]));
  const terminalsFor = new Map<string, Terminal[]>();
  for (const c of components) {
    terminalsFor.set(c.id, getComponentTerminals(c.type, c.properties));
  }

  // Terminals the model used that really do exist - so replacements can
  // prefer a free slot rather than doubling up on an occupied one.
  const usedByComponent = new Map<string, Set<string>>();
  const markUsed = (compId: string, termId: string | null | undefined) => {
    if (!termId) return;
    if (!usedByComponent.has(compId)) usedByComponent.set(compId, new Set());
    usedByComponent.get(compId)!.add(termId);
  };
  for (const w of wiresIn) {
    const fromTerms = terminalsFor.get(w.fromComponentId);
    const toTerms = terminalsFor.get(w.toComponentId);
    if (fromTerms?.some(t => t.id === w.fromTerminal)) markUsed(w.fromComponentId, w.fromTerminal);
    if (toTerms?.some(t => t.id === w.toTerminal)) markUsed(w.toComponentId, w.toTerminal);
  }

  // --- 1. Terminal repair -------------------------------------------------
  const wires: Wire[] = [];
  for (const original of wiresIn) {
    const wire: Wire = { ...original };
    let drop = false;

    for (const end of ["from", "to"] as const) {
      const compId = end === "from" ? wire.fromComponentId : wire.toComponentId;
      const termId = end === "from" ? wire.fromTerminal : wire.toTerminal;
      const comp = byId.get(compId);
      const terminals = terminalsFor.get(compId);

      // Unknown component is a different problem; leave it for the validator.
      if (!comp || !terminals || terminals.length === 0) continue;
      if (terminals.some(t => t.id === termId)) continue;

      const otherEndId = end === "from" ? wire.toComponentId : wire.fromComponentId;
      const replacement = pickReplacement(
        String(termId ?? ""),
        wire.polarity as string | undefined,
        terminals,
        usedByComponent.get(compId) ?? new Set(),
        comp.type,
        byId.get(otherEndId)?.type
      );

      if (!replacement) {
        drop = true;
        repairs.push({
          kind: "wire-dropped",
          wireId: wire.id,
          detail: `No ${wire.polarity ?? "compatible"} terminal on ${comp.type} to replace "${termId}"`,
        });
        break;
      }

      if (end === "from") wire.fromTerminal = replacement.id;
      else wire.toTerminal = replacement.id;
      markUsed(compId, replacement.id);

      repairs.push({
        kind: "terminal-remapped",
        wireId: wire.id,
        detail: `${comp.type}: "${termId}" -> "${replacement.id}"`,
      });
    }

    if (!drop) wires.push(wire);
  }

  // --- 2. Wire sizing -----------------------------------------------------
  const dcCurrents = solveDcWireCurrents(components, wires, {
    systemVoltage,
    inverterDcInput: (inverterId: string) => {
      const r = calculateInverterDCInput(inverterId, components, wires, systemVoltage);
      return {
        dcInputCurrent: r.dcInputCurrent,
        maxDCInputCurrent: r.dcInputCurrent,
      };
    },
  });

  for (const wire of wires) {
    const current = currentForWire(wire, components, byId, dcCurrents, systemVoltage);
    if (!(current > 0) || !wire.length) continue;

    // The AC side is sized at its own voltage, the DC side at system voltage.
    const isAC = wire.polarity === "hot" || wire.polarity === "neutral";
    const voltage = isAC ? acVoltageForWire(wire, byId) : systemVoltage;

    const calc = calculateWireSize({
      current,
      length: wire.length,
      voltage,
      conductorMaterial: (wire as any).conductorMaterial || "copper",
      currentGauge: wire.gauge, // never recommends smaller than what is there
    });

    // calculateWireSize already returns the gauge with an " AWG" suffix
    const recommended = stripAwg(calc.recommendedGauge);
    if (recommended && recommended !== stripAwg(wire.gauge)) {
      const before = wire.gauge;
      wire.gauge = `${recommended} AWG`;
      wire.current = current;
      repairs.push({
        kind: "gauge-resized",
        wireId: wire.id,
        detail: `${before ?? "unset"} -> ${wire.gauge} for ${current.toFixed(1)}A over ${wire.length}ft`,
      });
    }
  }

  return { components, wires, repairs };
}

function stripAwg(g: string | null | undefined): string | undefined {
  return g ? g.replace(" AWG", "").trim() : undefined;
}

/** AC voltage for a wire, taken from whichever end declares one. */
function acVoltageForWire(wire: Wire, byId: Map<string, SchematicComponent>): number {
  const from = byId.get(wire.fromComponentId);
  const to = byId.get(wire.toComponentId);
  for (const c of [to, from]) {
    if (!c) continue;
    if (c.type === "ac-load" || c.properties?.acOutputVoltage !== undefined || c.properties?.acVoltage !== undefined) {
      return getACVoltage(c);
    }
  }
  return 120;
}

/**
 * Current through a wire: the DC solver where it can root the wire, otherwise
 * a direct estimate from the load or inverter on either end.
 */
function currentForWire(
  wire: Wire,
  components: SchematicComponent[],
  byId: Map<string, SchematicComponent>,
  dcCurrents: Map<string, number>,
  systemVoltage: number
): number {
  const solved = wire.id ? dcCurrents.get(wire.id) : undefined;
  if (solved && solved > 0) return solved;

  const from = byId.get(wire.fromComponentId);
  const to = byId.get(wire.toComponentId);

  for (const comp of [to, from]) {
    if (!comp) continue;

    if (comp.type === "ac-load") {
      const watts = Number(comp.properties?.watts ?? comp.properties?.power ?? 0);
      const v = getACVoltage(comp);
      if (watts > 0 && v > 0) return watts / v;
    }

    if (comp.type === "dc-load") {
      const watts = Number(comp.properties?.watts ?? comp.properties?.power ?? 0);
      const v = Number(comp.properties?.voltage ?? systemVoltage);
      if (watts > 0 && v > 0) return watts / v;
    }

    if (INVERTER_TYPES.has(comp.type) && (wire.polarity === "positive" || wire.polarity === "negative")) {
      const r = calculateInverterDCInput(comp.id, components, [], systemVoltage);
      if (r.dcInputCurrent > 0) return r.dcInputCurrent;
      const watts = Number(comp.properties?.watts ?? comp.properties?.powerRating ?? 0);
      if (watts > 0) return watts / 0.875 / systemVoltage;
    }
  }

  return 0;
}
