import { loadDesignDocument, type DesignDocument } from "../../shared/design-document";
import type { SchematicComponent, Wire } from "../../shared/schema";

const component = (id: string, type: string, properties: Record<string, unknown> = {}): SchematicComponent => ({
  id, type, name: id, x: 100, y: 100, properties,
});
const wire = (id: string, from: string, to: string, polarity: Wire["polarity"] = "positive"): Wire => ({
  id, fromComponentId: from, toComponentId: to, fromTerminal: "positive", toTerminal: "positive",
  length: 5, polarity, gauge: "10",
});
const fixture = (name: string, components: SchematicComponent[], wires: Wire[] = []): DesignDocument =>
  loadDesignDocument({ name, systemVoltage: 12, components, wires });

/** Structural regression inputs, not independently certified electrical designs. */
export const designFixtures = {
  solar: fixture("Simple solar", [component("pv", "solar-panel", { watts: 200 }), component("mppt", "mppt", { maxCurrent: 20 }), component("battery", "battery", { voltage: 12, capacity: 100 })], [wire("pv-feed", "pv", "mppt"), wire("charge", "mppt", "battery")]),
  acDc: fixture("AC and DC loads", [component("battery", "battery", { voltage: 12 }), component("inverter", "inverter", { efficiency: 0.875 }), component("ac", "ac-load", { watts: 1200, acVoltage: 120 }), component("dc", "dc-load", { watts: 60, voltage: 12 })], [wire("dc-input", "battery", "inverter"), wire("ac-output", "inverter", "ac", "hot"), wire("dc-feed", "battery", "dc")]),
  banks: fixture("Multiple battery banks", [component("bank-a-1", "battery", { bankId: "a", voltage: 12 }), component("bank-a-2", "battery", { bankId: "a", voltage: 12 }), component("bank-b", "battery", { bankId: "b", voltage: 24 })]),
  shore: fixture("Shore power", [component("shore", "shore-power", { acVoltage: 120 }), component("charger", "multiplus", { acVoltage: 120 })], [wire("shore-feed", "shore", "charger", "hot")]),
  parallel: fixture("Parallel conductors", [component("battery", "battery"), component("inverter", "inverter")], [wire("parallel-1", "battery", "inverter"), wire("parallel-2", "battery", "inverter")]),
  custom: fixture("Custom component", [component("custom", "custom:retained-definition", { terminals: [{ id: "input", type: "positive", x: 0, y: 20 }], width: 120, height: 80, customFutureProperty: { preserved: true } })]),
  incomplete: fixture("Unfinished design", [component("battery", "battery"), component("load", "dc-load")]),
  legacy: loadDesignDocument({ id: "saved-legacy", name: "Legacy", components: [component("battery", "battery")], wires: [], systemVoltage: 12, legacyExtension: { retain: "yes" } }),
};
