import type { SchematicComponent, Wire } from "@shared/schema";
import { findBatteryBanks, isSeriesLink } from "@shared/battery-bank";

export type LoadMode = "nominal" | "expected" | "max";

export interface SolveOptions {
  systemVoltage: number;
  loadMode?: LoadMode;
  // Resolves an inverter's DC input current (actual + rated/capacity) by id.
  inverterDcInput?: (inverterId: string) => { dcInputCurrent: number; maxDCInputCurrent: number };
}

const SOURCE_TYPES = new Set(["mppt", "blue-smart-charger", "orion-dc-dc", "alternator"]);
const INVERTER_TYPES = new Set(["inverter", "multiplus", "phoenix-inverter"]);

/**
 * Compute the current through every DC wire by modelling the DC system as a
 * graph rooted at the battery bank(s).
 *
 * Each rail (positive / negative) is treated as a tree rooted at the bank: the
 * current on a wire equals the net load demand of everything "downstream" of it
 * (loads draw current, charging sources reduce it). This handles arbitrary
 * radial topologies - chained bus bars, sub-panels, fuses/switches in series -
 * not just a single trunk.
 *
 * Series-connected batteries are collapsed into one bank node; the series-link
 * wires carry the whole bank current.
 *
 * Returns a Map of wireId -> amps. Wires it can't root (AC wires, or sub-systems
 * with no battery, e.g. downstream of a DC-DC converter) are simply omitted so
 * the caller can fall back to its own estimate.
 */
export function solveDcWireCurrents(
  components: SchematicComponent[],
  wires: Wire[],
  options: SolveOptions
): Map<string, number> {
  const result = new Map<string, number>();
  const { systemVoltage, loadMode = "nominal" } = options;
  const loadFactor = loadMode === "expected" ? 0.75 : 1;
  const useMaxInverter = loadMode === "max";
  const inverterDc = options.inverterDcInput || (() => ({ dcInputCurrent: 0, maxDCInputCurrent: 0 }));

  const banks = findBatteryBanks(components, wires);
  if (banks.length === 0) return result; // no battery to root the network

  // Collapse each battery bank to a single node id; non-batteries map to self.
  const batteryToBank = new Map<string, string>();
  banks.forEach((b, i) => b.batteryIds.forEach(id => batteryToBank.set(id, `__bank_${i}`)));
  const nodeIdOf = (compId: string) => batteryToBank.get(compId) || compId;
  const bankNodeIds = new Set(banks.map((_, i) => `__bank_${i}`));

  // Net current injection per node: loads positive (sinks), sources negative.
  const injectionByNode = new Map<string, number>();
  const addInj = (nodeId: string, amps: number) =>
    injectionByNode.set(nodeId, (injectionByNode.get(nodeId) || 0) + amps);

  for (const c of components) {
    const nodeId = nodeIdOf(c.id);
    if (bankNodeIds.has(nodeId)) continue; // the bank is the root, not a load/source
    if (INVERTER_TYPES.has(c.type)) {
      const dc = inverterDc(c.id);
      addInj(nodeId, useMaxInverter ? dc.maxDCInputCurrent : dc.dcInputCurrent * loadFactor);
    } else if (c.type === "dc-load") {
      const w = Number(c.properties?.watts ?? c.properties?.power ?? 0);
      const v = Number(c.properties?.voltage) || systemVoltage;
      if (w > 0 && v > 0) addInj(nodeId, (w / v) * loadFactor);
    } else if (SOURCE_TYPES.has(c.type)) {
      const amps = c.type === "mppt"
        ? Number(c.properties?.maxCurrent ?? c.properties?.amps ?? c.properties?.current ?? 0)
        : Number(c.properties?.amps ?? c.properties?.current ?? 0);
      addInj(nodeId, -amps);
    }
    // fuses, switches, shunts, bus bars, panels: pass-through (0)
  }

  // Whole-bank current (used for the internal series-link wires).
  let totalNet = 0;
  injectionByNode.forEach(v => { totalNet += v; });
  const bankTotalCurrent = Math.max(0, totalNet);
  for (const w of wires) {
    if (isSeriesLink(w, components)) result.set(w.id, bankTotalCurrent);
  }

  // Solve each rail independently as a tree rooted at the bank.
  for (const polarity of ["positive", "negative"] as const) {
    const adj = new Map<string, Array<{ wireId: string; other: string }>>();
    const addEdge = (a: string, b: string, wireId: string) => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a)!.push({ wireId, other: b });
    };
    for (const w of wires) {
      if (w.polarity !== polarity) continue;
      if (isSeriesLink(w, components)) continue;
      const a = nodeIdOf(w.fromComponentId);
      const b = nodeIdOf(w.toComponentId);
      if (a === b) continue; // self-loop inside a collapsed bank
      addEdge(a, b, w.id);
      addEdge(b, a, w.id);
    }

    const visited = new Set<string>();
    const visitedEdges = new Set<string>();
    // Returns the net injection of the subtree reached through `node`.
    const dfs = (node: string): number => {
      visited.add(node);
      let subtreeInj = bankNodeIds.has(node) ? 0 : (injectionByNode.get(node) || 0);
      for (const { wireId, other } of adj.get(node) || []) {
        if (visitedEdges.has(wireId) || visited.has(other)) continue;
        visitedEdges.add(wireId);
        const childInj = dfs(other);
        const edgeCurrent = Math.abs(childInj);
        const existing = result.get(wireId);
        result.set(wireId, existing != null ? Math.max(existing, edgeCurrent) : edgeCurrent);
        subtreeInj += childInj;
      }
      return subtreeInj;
    };
    for (const bankId of Array.from(bankNodeIds)) {
      if (adj.has(bankId) && !visited.has(bankId)) dfs(bankId);
    }
  }

  return result;
}
