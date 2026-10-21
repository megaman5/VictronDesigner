import { DEVICE_DEFINITIONS } from './device-definitions';
import { getACVoltage, getSupportedACVoltages, isSplitPhase } from './ac-voltage';
import { calculateWireSize, conductorResistanceOhms, evaluateWireGauge, type InsulationType } from './wire-calculator';
import type { WireCalculation } from './schema';
import { analyzePVCircuits, panelOperatingValue } from './pv-analysis';
import { solveResistorNetwork, type Resistor } from './dc-network';

export const ELECTRICAL_ENGINE_VERSION = '1.6.0';
export interface AnalysisComponent { id: string; type: string; name?: string; properties?: Record<string, any> }
export interface AnalysisWire {
  id: string; fromComponentId: string; toComponentId: string;
  fromTerminal?: string; toTerminal?: string; polarity?: string; gauge?: string; length?: number; lengthEstimated?: boolean; conductorMaterial?: 'copper' | 'aluminum';
}
export interface ElectricalValue {
  status: 'known' | 'unknown' | 'unsupported'; currentA?: number; voltageV?: number;
  reason?: string; source: string; assumptions: string[];
}
export interface WireAnalysis extends ElectricalValue {
  wireId: string; scenario?: 'load' | 'charge' | 'governing' | 'normal-ground';
  calculation?: WireCalculation; selectedGauge?: string;
  sizingCurrentA?: number;
  selectedGaugeAmpacityA?: number; selectedGaugeVoltageDropPercent?: number; issues: string[];
  /** Problems only at an inverter's full rated output, not with the loads drawn - shown as warnings. */
  ratedOutputWarnings?: string[];
}
export interface AnalysisResult {
  engineVersion: string; fingerprint: string;
  components: Record<string, ElectricalValue>; wires: Record<string, WireAnalysis>; assumptions: string[];
}
export interface AnalysisOptions {
  temperatureC?: number; insulationType?: InsulationType; bundlingFactor?: number;
  maxVoltageDrop?: number; inverterEfficiency?: number; conductorMaterial?: "copper" | "aluminum";
}
type Domain = 'positive' | 'negative' | 'hot' | 'neutral' | 'pv-positive' | 'pv-negative' | 'ground' | 'data';
const inverters = new Set(['inverter', 'multiplus', 'quattro', 'phoenix-inverter']);
// Lynx Shunt / Smart BMS and BatteryProtect are series elements on the main
// conductors, like a fuse or SmartShunt. A transfer switch passes whichever AC
// source is selected.
const dcPass = new Set(['busbar-positive', 'busbar-negative', 'dc-panel', 'fuse', 'dc-breaker', 'switch', 'smartshunt', 'lynx-distributor', 'lynx-power-in', 'lynx-shunt', 'lynx-smart-bms', 'battery-protect']);
const acPass = new Set(['ac-panel', 'ac-breaker', 'transfer-switch']);
// Monitoring and balancing devices draw milliamps to a few watts.
const CERBO_TYPICAL_WATTS = 3; // Cerbo GX datasheet, without display/accessories
const negligibleDraw = new Set(['battery-balancer']);
const chargerTypes = ['mppt', 'blue-smart-charger', 'orion-dc-dc', 'alternator'];
/** "48/12" in a DC-DC model name: input and output nominal voltages. */
const converterRatio = (c: AnalysisComponent): { inV: number; outV: number } | undefined => {
  // "12/24", "12/24V", "24V/12V", "12/12-30"
  const m = String(c.properties?.model ?? c.name ?? '').match(/\b(12|24|48)\s*V?\s*\/\s*(12|24|48)(?!\d)/i);
  return m ? { inV: Number(m[1]), outV: Number(m[2]) } : undefined;
};
/**
 * Continuous AC output at 25C from Victron datasheets, by VA rating (MultiPlus,
 * MultiPlus-II, Quattro, Phoenix). The DC cable must carry what the inverter
 * can deliver, not just what happens to be drawn on the schematic today.
 */
const CONTINUOUS_WATTS_BY_VA: Record<number, number> = {
  250: 200, 375: 300, 500: 400, 800: 700, 1200: 1000, 1600: 1300, 2000: 1600, 3000: 2400,
  5000: 4000, 8000: 6500, 10000: 8000, 15000: 12000,
};
/** VA rating: the powerRating property, else the "12/3000" part of the model name. */
const ratedContinuousWatts = (c: AnalysisComponent): { watts: number; note: string } | undefined => {
  const p = c.properties ?? {};
  const named = String(p.model ?? c.name ?? '').match(/\b(?:12|24|48)\s*\/\s*(\d{3,5})\b/);
  const va = Number(p.powerRating) > 0 ? Number(p.powerRating) : named ? Number(named[1]) : NaN;
  if (!(va > 0)) return undefined;
  const table = CONTINUOUS_WATTS_BY_VA[va];
  // Unlisted ratings: 85% of VA, above every listed model's ratio (80-87%).
  return table ? { watts: table, note: `${va}VA model: ${table}W continuous at 25C (Victron datasheet).` }
    : { watts: va * 0.85, note: `${va}VA rating not in the datasheet table; ${va * 0.85}W continuous assumed (85% of VA, at or above every listed Victron model).` };
};
/** Tree-walk reasons the resistance solver may replace with a more specific one. */
const TOPOLOGY_REASONS = ['Missing, incompatible', 'Parallel paths or a circuit cycle', 'A single supported source path', 'Battery nominal voltage differs'];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const positive = (n: unknown): n is number => finite(n) && n > 0;
const unresolved = (reason: string, unsupported = false): ElectricalValue => ({ status: unsupported ? 'unsupported' : 'unknown', reason, source: 'unresolved', assumptions: [] });
const known = (currentA: number, voltageV: number, source: string, assumptions: string[] = []): ElectricalValue => ({ status: 'known', currentA, voltageV, source, assumptions });

/** Stable, non-security identifier for the complete calculation input. */
export function electricalFingerprint(value: unknown): string {
  const canonical = (v: any): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    return JSON.stringify(v) ?? 'null';
  };
  let hash = 2166136261;
  for (const char of canonical(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `electrical-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function terminalDomain(component: AnalysisComponent, terminal: string | undefined): Domain | undefined {
  // The canvas and saved designs use `negative` for SmartShunt BATT-,
  // while the device definition uses `battery-minus`. Both are the same
  // conducting terminal; VE.Direct must stay outside the power path.
  if (component.type === 'smartshunt') {
    if (terminal === 'negative' || terminal === 'battery-minus' || terminal === 'system-minus') return 'negative';
    if (terminal === 'data') return 'data';
  }
  if (component.type === 'busbar-positive' && /^pos-[1-6]$/.test(terminal ?? '')) return 'positive';
  if (component.type === 'busbar-negative' && /^neg-[1-6]$/.test(terminal ?? '')) return 'negative';
  if (component.type === 'ac-load' && terminal === 'hot') return 'hot';
  if (component.type === 'quattro' && /^ac-in-[12]-(hot|neutral|ground)$/.test(terminal ?? '')) return terminal!.endsWith('ground') ? 'ground' : terminal!.endsWith('neutral') ? 'neutral' : 'hot';
  const definition = DEVICE_DEFINITIONS[component.type === 'quattro' ? 'multiplus' : component.type]?.terminals.find(t => t.id === terminal);
  if (!definition) return undefined;
  if (definition.type === 'ac-in' || definition.type === 'ac-out') {
    return terminal?.includes('neutral') ? 'neutral' : (terminal?.includes('hot') || terminal === 'line') ? 'hot' : undefined;
  }
  return definition.type;
}

/**
 * Conservative steady-state analysis. Tree circuits are walked branch by
 * branch; parallel batteries, parallel cables and loops are solved as a
 * resistor network from each cable's gauge and length. Custom behavior and AC
 * transfer/charging need explicit models; they return unresolved, never an
 * invented zero current. Existing sizing tables are retained unchanged. No
 * conductor is rewritten.
 */
/**
 * Inverter cables are checked twice. Against what is drawn on the AC output
 * (errors: the design as drawn overloads them), and against the inverter's
 * rated continuous output (warnings: fine today, but not if someone uses the
 * inverter's full capacity later). An inverter with nothing drawn on its
 * output is shown at its rating, with any overload as a warning.
 */
export function analyzeElectricalDesign(input: { components: AnalysisComponent[]; wires: AnalysisWire[]; systemVoltage: number }, options: AnalysisOptions = {}): AnalysisResult {
  const result = analyzeCore(input, options, 'default');
  if (!input.components.some(c => inverters.has(c.type) && ratedContinuousWatts(c))) return result;
  const drawn = analyzeCore(input, options, 'drawn'), rated = analyzeCore(input, options, 'rated');
  // Missing length or an unrecognized gauge is wrong whatever the current.
  const currentIndependent = (issue: string) => /length|not recognized/i.test(issue);
  for (const [id, wire] of Object.entries(result.wires)) {
    if (wire.status !== 'known') continue;
    const d = drawn.wires[id], r = rated.wires[id];
    const shape = (issue: string) => issue.replace(/[\d.]+/g, '#');
    // As drawn: an inverter with nothing on its output draws nothing.
    const errors = d?.status === 'known' ? d.issues : wire.issues.filter(currentIndependent);
    const atRating = (r?.status === 'known' ? r.issues : wire.issues).filter(i => !errors.some(e => shape(e) === shape(i)));
    if (!atRating.length) continue;
    const amps = Math.max(wire.currentA!, r?.status === 'known' ? r.currentA! : 0);
    wire.issues = errors;
    wire.ratedOutputWarnings = atRating.map(i => `At the inverter's full rated output (${amps.toFixed(1)}A here): ${i.charAt(0).toLowerCase()}${i.slice(1)} The loads drawn today are within limits.`);
  }
  return result;
}

function analyzeCore(input: { components: AnalysisComponent[]; wires: AnalysisWire[]; systemVoltage: number }, options: AnalysisOptions, inverterDemand: 'drawn' | 'default' | 'rated'): AnalysisResult {
  const result: AnalysisResult = {
    engineVersion: ELECTRICAL_ENGINE_VERSION, fingerprint: electricalFingerprint({ input, options }),
    components: {}, wires: {}, assumptions: ['Steady-state demand; surge, fault and AC pass-through/charging scenarios are not modeled.', 'Wire lengths are one-way feet; existing copper sizing tables and derating rules are retained.'],
  };
  const components = new Map(input.components.map(c => [c.id, c]));
  const pvWires = analyzePVCircuits(input.components, input.wires);
  const efficiency = options.inverterEfficiency ?? 0.875;
  const domains = new Map<string, Domain>();
  for (const w of input.wires) {
    const a = components.get(w.fromComponentId), b = components.get(w.toComponentId);
    if (!a || !b) continue;
    const da = terminalDomain(a, w.fromTerminal), db = terminalDomain(b, w.toTerminal);
    if (da && da === db) domains.set(w.id, da);
  }
  const adjacency = new Map<string, AnalysisWire[]>();
  for (const w of input.wires) for (const id of [w.fromComponentId, w.toComponentId]) {
    const list = adjacency.get(id) ?? []; list.push(w); adjacency.set(id, list);
  }
  const reachable = (start: string, domain: Domain, excluded?: string, startTerminal?: string): Set<string> => {
    const visited = new Set<string>(), queue = [start];
    // Starting AT an inverter/charger, stay on the AC side the wire entered:
    // its AC input and AC output are different circuits.
    // Quattro: ac-in-1 and ac-in-2 are separate inputs.
    const acGroup = (t?: string) => (t ?? '').match(/^ac-(in|out)(-\d)?/)?.slice(1).join('') || undefined;
    // Likewise a DC-DC charger's input and output are different circuits.
    const dcGroup = (t?: string) => (t ?? '').match(/^(input|output)-/)?.[1];
    const startType = components.get(start)?.type ?? '';
    const groupOf = (domain === 'hot' || domain === 'neutral') && inverters.has(startType) ? acGroup
      : startType === 'orion-dc-dc' ? dcGroup : undefined;
    const startGroup = groupOf?.(startTerminal);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]; if (visited.has(id)) continue; visited.add(id);
      const c = components.get(id); if (!c) continue;
      const pass = domain === 'hot' || domain === 'neutral' ? acPass.has(c.type) : dcPass.has(c.type);
      // A traversal begins at either endpoint, but must not pass through a source/load/converter.
      if (id !== start && !pass) continue;
      for (const w of adjacency.get(id) ?? []) {
        if (w.id === excluded || domains.get(w.id) !== domain) continue;
        if (id === start && startGroup && groupOf!(w.fromComponentId === id ? w.fromTerminal : w.toTerminal) !== startGroup) continue;
        queue.push(w.fromComponentId === id ? w.toComponentId : w.fromComponentId);
      }
    }
    return visited;
  };
  // Batteries joined on BOTH their positive and negative terminals through
  // pass-through parts are one parallel bank, the same as an explicit shared
  // batteryBankId. One-sided joins stay separate sources (and are flagged).
  const inferredBank = new Map<string, string>();
  const batteries = input.components.filter(c => c.type === 'battery' && Number(c.properties?.voltage ?? input.systemVoltage) === input.systemVoltage);
  for (const b of batteries) {
    if (inferredBank.has(b.id)) continue;
    const pos = reachable(b.id, 'positive'), neg = reachable(b.id, 'negative');
    const members = batteries.filter(o => o.id === b.id || (pos.has(o.id) && neg.has(o.id)));
    if (members.length > 1) for (const m of members) if (!inferredBank.has(m.id)) inferredBank.set(m.id, `inferred:${b.id}`);
  }
  // Batteries wired negative-to-positive whose voltages add up to the system
  // voltage (two 12V in series for 24V) are one string: a single source.
  const seriesString = new Map<string, string>();
  {
    const parent = new Map<string, string>();
    const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x; };
    const all = input.components.filter(c => c.type === 'battery');
    for (const c of all) parent.set(c.id, c.id);
    for (const w of input.wires) {
      const a = components.get(w.fromComponentId), b = components.get(w.toComponentId);
      if (a?.type !== 'battery' || b?.type !== 'battery') continue;
      const ends = [w.fromTerminal, w.toTerminal].sort().join('/');
      if (ends === 'negative/positive') parent.set(find(a.id), find(b.id));
    }
    const groups = new Map<string, AnalysisComponent[]>();
    for (const c of all) { const r = find(c.id); groups.set(r, [...(groups.get(r) ?? []), c]); }
    for (const [root, members] of Array.from(groups)) {
      const total = members.reduce((sum, c) => sum + Number(c.properties?.voltage ?? 0), 0);
      if (members.length > 1 && total === input.systemVoltage) for (const m of members) seriesString.set(m.id, `series:${root}`);
    }
  }
  // An inverter/charger is an AC source only from its AC output. Seen from its
  // AC input it is a consumer, bounded by the shore/source rating feeding it.
  const viaTerminal = (id: string, domain: Domain, ids: Set<string>, current: AnalysisWire) =>
    (adjacency.get(id) ?? []).filter(edge => domains.get(edge.id) === domain && (edge.id === current.id || ids.has(edge.fromComponentId === id ? edge.toComponentId : edge.fromComponentId)))
      .map(edge => String(edge.fromComponentId === id ? edge.fromTerminal : edge.toTerminal));
  const chargerInput = (c: AnalysisComponent): ElectricalValue => {
    const p = c.properties ?? {}, label = c.name || c.id;
    if (!positive(p.acInputAmps)) return unresolved(`Set the rated AC input current for "${label}" in Charger Specifications. Its DC charge current cannot be used as AC input current.`);
    return known(p.acInputAmps, getACVoltage(c), 'declared charger maximum AC input current');
  };
  /**
   * Current sharing from resistance, for wires the tree walk cannot settle:
   * parallel batteries, parallel cables, loops, battery-to-battery links. The
   * DC circuit is solved as a resistor network - every cable's resistance comes
   * from its gauge and length, loads and chargers inject their own current.
   *
   * The one thing a design does not contain is each battery's internal
   * resistance, so it is not guessed: identical batteries are given the same
   * value and every value from ~0.01 to 1000 milliohm (per 100Ah) is tried,
   * keeping the worst result. Each battery (or series string) is also tried
   * disconnected, as its BMS or fuse can do. Batteries that differ are also
   * tried alone - with unknown relative resistances that is the only bound.
   */
  let sharingCache: Map<string, { value: ElectricalValue; scenario?: WireAnalysis['scenario'] }> | undefined;
  const sharing = () => sharingCache ??= solveSharing();
  const solveSharing = () => {
    const out = new Map<string, { value: ElectricalValue; scenario?: WireAnalysis['scenario'] }>();
    const nodeOf = (c: AnalysisComponent, terminal?: string) => {
      const d = terminalDomain(c, terminal);
      if (d !== 'positive' && d !== 'negative') return undefined;
      // A balancer's midpoint and bank terminals are separate connections, not one node.
      const group = c.type === 'orion-dc-dc' ? (terminal ?? '').match(/^(input|output)-/)?.[1] ?? '' : c.type === 'battery-balancer' ? terminal ?? '' : '';
      return `${c.id}|${d}|${group}`;
    };
    // Resistive elements: DC wires (same polarity, or a battery-to-battery series link).
    const wireEnds = new Map<string, [string, string]>();
    for (const w of input.wires) {
      const a = components.get(w.fromComponentId), b = components.get(w.toComponentId);
      if (!a || !b) continue;
      const na = nodeOf(a, w.fromTerminal), nb = nodeOf(b, w.toTerminal);
      if (!na || !nb || na === nb) continue;
      const series = a.type === 'battery' && b.type === 'battery' && [w.fromTerminal, w.toTerminal].sort().join('/') === 'negative/positive';
      if (domains.get(w.id) !== 'positive' && domains.get(w.id) !== 'negative' && !series) continue;
      wireEnds.set(w.id, [na, nb]);
    }
    const batteryList = input.components.filter(c => c.type === 'battery');
    const plus = (c: AnalysisComponent) => `${c.id}|positive|`, minus = (c: AnalysisComponent) => `${c.id}|negative|`;
    // Connected parts, joined by wires and through batteries.
    const parent = new Map<string, string>();
    const find = (x: string): string => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) x = parent.get(x)!; return x; };
    const join = (x: string, y: string) => parent.set(find(x), find(y));
    for (const [a, b] of Array.from(wireEnds.values())) join(a, b);
    for (const c of batteryList) join(plus(c), minus(c));
    // Series units: batteries joined negative-to-positive drop out together.
    const unitOf = new Map<string, string>();
    {
      const up = new Map(batteryList.map(c => [c.id, c.id]));
      const root = (x: string): string => { while (up.get(x) !== x) x = up.get(x)!; return x; };
      for (const w of input.wires) {
        const a = components.get(w.fromComponentId), b = components.get(w.toComponentId);
        if (a?.type === 'battery' && b?.type === 'battery' && [w.fromTerminal, w.toTerminal].sort().join('/') === 'negative/positive') up.set(root(a.id), root(b.id));
      }
      for (const c of batteryList) unitOf.set(c.id, root(c.id));
    }
    // Loads and chargers: [component, + node, - node, kind].
    type Device = { c: AnalysisComponent; p: string; n: string; kind: 'load' | 'charge' | 'both' };
    const devices: Device[] = [];
    const poison = new Map<string, string>();
    for (const c of input.components) {
      if (c.type === 'battery' || dcPass.has(c.type) || negligibleDraw.has(c.type)) continue;
      const touched = new Set<string>();
      for (const w of adjacency.get(c.id) ?? []) if (wireEnds.has(w.id)) touched.add(wireEnds.get(w.id)![w.fromComponentId === c.id ? 0 : 1]);
      if (!touched.size) continue;
      const groups = c.type === 'orion-dc-dc' ? ['input', 'output'] : [''];
      for (const g of groups) {
        const p = `${c.id}|positive|${g}`, n = `${c.id}|negative|${g}`;
        if (!touched.has(p) && !touched.has(n)) continue;
        const kind = c.type === 'orion-dc-dc' ? (g === 'input' ? 'both' : 'charge')
          : chargerTypes.includes(c.type) ? 'charge'
          : c.type === 'dc-load' || inverters.has(c.type) || c.type === 'cerbo' || negligibleDraw.has(c.type) ? 'load' : undefined;
        if (!kind) { poison.set(find(Array.from(touched)[0]), `This circuit includes "${c.name || c.id}" (${c.type}), whose electrical behavior is not supported.`); continue; }
        devices.push({ c, p, n, kind });
      }
    }
    // Nominal potentials: batteries as voltage sources, no load. Batteries of
    // different voltage in parallel would circulate current - a wiring fault.
    const emfInjection = new Map<string, number>();
    const R0 = 1e-3;
    for (const c of batteryList) {
      const v = Number(c.properties?.voltage ?? input.systemVoltage);
      emfInjection.set(plus(c), (emfInjection.get(plus(c)) ?? 0) + v / R0);
      emfInjection.set(minus(c), (emfInjection.get(minus(c)) ?? 0) - v / R0);
    }
    const wireOhms = (id: string, unknownOhms: number) => {
      const w = input.wires.find(x => x.id === id)!;
      return conductorResistanceOhms(w.gauge, w.length) ?? unknownOhms;
    };
    const wireResistors = (unknownOhms: number): Resistor[] => Array.from(wireEnds).map(([id, [a, b]]) => ({ id, a, b, ohms: Math.max(wireOhms(id, unknownOhms), 1e-6) }));
    const emf = solveResistorNetwork([...wireResistors(1e-4), ...batteryList.map(c => ({ id: `rint:${c.id}`, a: plus(c), b: minus(c), ohms: R0 }))], emfInjection);
    for (const c of batteryList) {
      const v = Number(c.properties?.voltage ?? input.systemVoltage);
      const across = (emf.potential.get(plus(c)) ?? 0) - (emf.potential.get(minus(c)) ?? 0);
      if (Math.abs(v - across) * 1 / R0 > 0.5) poison.set(find(plus(c)), 'Batteries of different voltages are connected in parallel; they would discharge into each other. Check the battery wiring.');
    }
    // Each device's demand at its own circuit voltage (a 12V starter circuit in a 24V boat).
    const injections = { load: new Map<string, number>(), charge: new Map<string, number>() };
    for (const d of devices) {
      const v = (emf.potential.get(d.p) ?? 0) - (emf.potential.get(d.n) ?? 0);
      if (!emf.potential.has(d.p) || !emf.potential.has(d.n) || !(v > 0.5)) {
        // No battery voltage across it. A battery-less island is left to the
        // tree walk; half-connected to a battery circuit, it cannot be solved.
        for (const node of [d.p, d.n]) if (batteryList.some(c => find(plus(c)) === find(node))) poison.set(find(node), `"${d.c.name || d.c.id}" is not connected across a battery circuit on both terminals.`);
        continue;
      }
      const local = Math.round(v);
      const value = d.kind === 'both' ? dcdcInput(d.c) : d.kind === 'charge' && d.c.type === 'orion-dc-dc' ? result.components[d.c.id] : demand(d.c, local);
      if (value.status !== 'known') { poison.set(find(d.p), value.reason ?? 'A connected device has no known current.'); continue; }
      const amps = value.currentA!;
      const scenarios: Array<'load' | 'charge'> = d.kind === 'both' ? ['load', 'charge'] : [d.kind];
      for (const s of scenarios) {
        const m = injections[s], sign = d.kind === 'charge' ? 1 : -1;
        m.set(d.p, (m.get(d.p) ?? 0) + sign * amps);
        m.set(d.n, (m.get(d.n) ?? 0) - sign * amps);
      }
    }
    // Availability scenarios: everything; each unit out; and for parts whose
    // batteries differ, each unit alone.
    const units = Array.from(new Set(Array.from(unitOf.values())));
    const membersOf = (u: string) => batteryList.filter(c => unitOf.get(c.id) === u);
    // Undeclared capacity: identity is unknown, so never assumed to match.
    const signature = (c: AnalysisComponent) => Number(c.properties?.capacity) > 0 ? `${c.properties?.batteryType ?? ''}|${c.properties!.capacity}|${c.properties?.voltage ?? ''}` : c.id;
    const unitsByPart = new Map<string, string[]>();
    for (const u of units) { const r = find(plus(membersOf(u)[0])); unitsByPart.set(r, [...(unitsByPart.get(r) ?? []), u]); }
    const availability: Array<Set<string>> = [new Set(units)];
    for (const [, us] of Array.from(unitsByPart)) {
      if (us.length < 2) continue;
      for (const u of us) availability.push(new Set(units.filter(x => x !== u)));
      const matched = new Set(us.flatMap(u => membersOf(u).map(signature))).size === 1;
      if (!matched) for (const u of us) availability.push(new Set(units.filter(x => x === u || !us.includes(x))));
    }
    const scales = [1e-5, 1e-4, 1e-3, 1e-2, 1e-1];
    const worst = new Map<string, { load: number; charge: number; byUnknown: [number, number] }>();
    const unknownLevels = [1e-6, 1];
    unknownLevels.forEach((unknownOhms, level) => {
      const wires = wireResistors(unknownOhms);
      for (const scale of scales) for (const avail of availability) {
        const rint = batteryList.filter(c => avail.has(unitOf.get(c.id)!)).map(c => ({ id: `rint:${c.id}`, a: plus(c), b: minus(c), ohms: scale * 100 / (Number(c.properties?.capacity) > 0 ? Number(c.properties!.capacity) : 100) }));
        for (const s of ['load', 'charge'] as const) {
          const solved = solveResistorNetwork([...wires, ...rint], injections[s]);
          for (const id of Array.from(wireEnds.keys())) {
            const amps = solved.current.get(id);
            if (amps === undefined) continue;
            const entry = worst.get(id) ?? { load: 0, charge: 0, byUnknown: [0, 0] as [number, number] };
            entry[s] = Math.max(entry[s], Math.abs(amps));
            entry.byUnknown[level] = Math.max(entry.byUnknown[level], Math.abs(amps));
            worst.set(id, entry);
          }
        }
      }
    });
    for (const [id, [a, b]] of Array.from(wireEnds)) {
      const part = find(a);
      if (poison.has(part)) { out.set(id, { value: unresolved(poison.get(part)!) }); continue; }
      const entry = worst.get(id);
      if (!entry || !emf.potential.has(a)) continue;
      const [lo, hi] = entry.byUnknown;
      if (Math.abs(hi - lo) > 0.01 * Math.max(hi, lo, 1)) { out.set(id, { value: unresolved('Set gauge and length on every cable in this loop or parallel run; how they share current depends on their resistance.') }); continue; }
      // Reference voltage: the circuit's nominal voltage at this wire (positive
      // side), or the lowest battery voltage in the part (negative side).
      const top = Math.max(emf.potential.get(a) ?? 0, emf.potential.get(b) ?? 0);
      const partVoltages = batteryList.filter(c => find(plus(c)) === part).map(c => Math.round((emf.potential.get(plus(c)) ?? 0)));
      if (!partVoltages.length) continue; // no battery in this part
      const voltage = domains.get(id) === 'positive' && top > 0.5 ? Math.round(top) : Math.min(...partVoltages.filter(v => v > 0), input.systemVoltage);
      const current = Math.round(Math.max(entry.load, entry.charge) * 1e6) / 1e6;
      out.set(id, {
        value: known(current, voltage, 'resistance network: worst case over battery resistance and disconnection', [
          'Current sharing calculated from each cable\'s resistance (gauge x length). Battery internal resistance is not in the design, so the full realistic range was checked and the worst case kept.',
          'Each battery (or series string) was also checked disconnected by its BMS or fuse; batteries that differ were also checked alone.',
        ]),
        scenario: entry.load && entry.charge ? 'governing' : entry.charge ? 'charge' : 'load',
      });
    }
    return out;
  };
  /**
   * Lowest rating of an AC breaker that every path between this wire and the
   * unrated chargers it feeds runs through - a sustained current above it trips.
   */
  const seriesBreakerA = (w: AnalysisWire, domain: Domain, downstreamIds: Set<string>): number => {
    const near = downstreamIds.has(w.fromComponentId) ? w.fromComponentId : w.toComponentId;
    const far = near === w.fromComponentId ? w.toComponentId : w.fromComponentId;
    const reach = (start: string, avoid: string) => {
      const seen = new Set<string>([avoid]), queue = [start];
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i]; if (seen.has(id)) continue; seen.add(id);
        if (id !== start && !acPass.has(components.get(id)?.type ?? '')) continue;
        for (const e of adjacency.get(id) ?? []) if (e.id !== w.id && domains.get(e.id) === domain) queue.push(e.fromComponentId === id ? e.toComponentId : e.fromComponentId);
      }
      seen.delete(avoid); return seen;
    };
    const chargers = Array.from(downstreamIds).filter(id => components.get(id)?.type === 'blue-smart-charger');
    const sources = input.components.filter(c => c.type === 'shore-power').map(c => c.id);
    let best = Infinity;
    for (const c of input.components) {
      const amps = Number(c.properties?.amps);
      if (c.type !== 'ac-breaker' || !(amps > 0)) continue;
      // Downstream breaker: the wire's load side no longer reaches any charger without it.
      if (downstreamIds.has(c.id) && (c.id === near || !chargers.some(id => reach(near, c.id).has(id)))) best = Math.min(best, amps);
      // Upstream breaker (or the wire's own end): the wire no longer reaches the shore without it.
      else if (!downstreamIds.has(c.id) && (c.id === far || !sources.some(id => reach(far, c.id).has(id)))) best = Math.min(best, amps);
    }
    return best;
  };
  const islandDemand = (a: Set<string>, sa: { charge: number; load: number; error?: ElectricalValue }, b: Set<string>, sb: { charge: number; load: number; error?: ElectricalValue }): ElectricalValue | undefined => {
    const supplied = sa.charge > 0 && !(sb.charge > 0) ? { supply: a, use: b } : sb.charge > 0 && !(sa.charge > 0) ? { supply: b, use: a } : undefined;
    if (!supplied) return undefined;
    // Island voltage: the converter's output rating, else the system voltage.
    const converter = Array.from(supplied.supply).map(id => components.get(id)!).find(c => c.type === 'orion-dc-dc');
    const islandV = (converter && converterRatio(converter)?.outV) || input.systemVoltage;
    let amps = 0;
    for (const id of Array.from(supplied.use)) {
      const c = components.get(id)!, p = c.properties ?? {};
      if (c.type === 'dc-load') {
        const v = p.voltage ?? islandV;
        if (finite(p.watts ?? p.power) && positive(v)) amps += (p.watts ?? p.power) / v;
        else if (finite(p.amps)) amps += p.amps;
        else return unresolved('Set load watts or amps.');
      } else if (c.type === 'orion-dc-dc') {
        const v = dcdcInput(c); if (v.status !== 'known') return v; amps += v.currentA!;
      } else if (c.type === 'cerbo') amps += (positive(p.watts) ? p.watts : CERBO_TYPICAL_WATTS) / islandV;
      else if (!dcPass.has(c.type) && !negligibleDraw.has(c.type)) return undefined; // let the normal rules explain it
    }
    return amps > 0 ? known(amps, islandV, 'battery-less circuit supplied by a converter or alternator', converter ? [`Island voltage ${islandV}V from the DC-DC model rating.`] : []) : undefined;
  };
  const dcdcInput = (c: AnalysisComponent): ElectricalValue => {
    const p = c.properties ?? {};
    if (positive(p.inputAmps) && positive(p.inputVoltage ?? input.systemVoltage)) return known(p.inputAmps, p.inputVoltage ?? input.systemVoltage, 'declared DC-DC input current');
    const ratio = converterRatio(c), out = p.amps ?? p.maxCurrent;
    if (ratio && positive(out)) return known(out * ratio.outV / ratio.inV / 0.9, ratio.inV, 'DC-DC output current x voltage ratio / efficiency', [`DC-DC input current estimated from the ${ratio.inV}/${ratio.outV} model rating at 90% efficiency.`]);
    return unresolved('Set DC-DC inputAmps and inputVoltage; output current cannot be used as input current.');
  };
  const drawnInverterDemand = (c: AnalysisComponent, outputEdges: AnalysisWire[], dcV: number): ElectricalValue => {
    const ids = new Set<string>();
    for (const w of outputEdges) for (const id of Array.from(reachable(w.fromComponentId === c.id ? w.toComponentId : w.fromComponentId, 'hot', w.id))) ids.add(id);
    let watts = 0; let count = 0;
    for (const id of Array.from(ids)) {
      const load = components.get(id)!;
      if (load.type === 'ac-load') {
        const value = demand(load); if (value.status !== 'known') return value;
        if (!getSupportedACVoltages(c).includes(value.voltageV!)) return unresolved('Connected AC load voltage is incompatible with inverter output voltage.');
        watts += value.currentA! * value.voltageV!; count++;
      } else if (load.type === 'blue-smart-charger') {
        const value = chargerInput(load); if (value.status !== 'known') return value;
        if (!getSupportedACVoltages(c).includes(value.voltageV!)) return unresolved('Connected charger AC voltage is incompatible with inverter output voltage.');
        return unresolved(`Inverter-fed charger "${load.name || load.id}" needs AC input power or power factor to calculate inverter DC demand.`, true);
      } else if (!acPass.has(load.type) && id !== c.id) return unresolved('Unsupported device or multiple sources on inverter AC output.', true);
    }
    if (!count) return unresolved('No connected AC load demand found.');
    return known(watts / efficiency / dcV, dcV, 'unique connected AC loads / efficiency / DC voltage', [`Inverter efficiency ${(efficiency * 100).toFixed(1)}%; connected steady-state loads only.`]);
  };
  const demand = (c: AnalysisComponent, dcV = input.systemVoltage): ElectricalValue => {
    const p = c.properties ?? {};
    if (c.type === 'solar-panel') return panelOperatingValue(c);
    if (c.type === 'dc-load' || c.type === 'ac-load') {
      const voltage = c.type === 'ac-load' ? getACVoltage(c) : p.voltage ?? dcV;
      if (!positive(voltage)) return unresolved('Set a positive nominal voltage.');
      if (finite(p.watts ?? p.power)) return known((p.watts ?? p.power) / voltage, voltage, 'declared load watts / nominal voltage');
      if (finite(p.amps)) return known(p.amps, voltage, 'declared load current');
      return unresolved('Set load watts or amps.');
    }
    if (inverters.has(c.type)) {
      if (!positive(dcV) || !positive(efficiency) || efficiency > 1) return unresolved('Set a valid DC voltage and inverter efficiency.');
      const outputEdges = (adjacency.get(c.id) ?? []).filter(w => domains.get(w.id) === 'hot' && (w.fromComponentId === c.id ? w.fromTerminal : w.toTerminal)?.startsWith('ac-out'));
      if (positive(p.dcInputAmps) && !outputEdges.length) return known(p.dcInputAmps, dcV, 'declared inverter DC input sizing current', ['Declared maximum DC input current; AC utilization is not inferred.']);
      if (positive(p.dcInputWatts) && !outputEdges.length) return known(p.dcInputWatts / dcV, dcV, 'declared inverter DC input watts / DC voltage');
      const rated = ratedContinuousWatts(c);
      const ratedValue = rated && known(rated.watts / efficiency / dcV, dcV, 'inverter rated continuous output / efficiency / DC voltage', [rated.note, `Inverter efficiency ${(efficiency * 100).toFixed(1)}%.`]);
      if (!outputEdges.length) {
        if (ratedValue && inverterDemand !== 'drawn') return ratedValue;
        if (ratedValue) return known(0, dcV, 'nothing drawn on inverter AC output');
        return unresolved('Connect inverter AC output to declared loads, set its VA rating, or set dcInputAmps/dcInputWatts from a reviewed specification; no utilization guess is made.');
      }
      const drawnValue = drawnInverterDemand(c, outputEdges, dcV);
      return inverterDemand === 'rated' && ratedValue && drawnValue.status === 'known' && ratedValue.currentA! > drawnValue.currentA! ? ratedValue : drawnValue;
    }
    if (c.type === 'blue-smart-charger') return positive(p.amps ?? p.maxCurrent) ? known(p.amps ?? p.maxCurrent, p.voltage ?? dcV, 'manufacturer maximum DC charge current') : unresolved(`Set the DC charge current for "${c.name || c.id}".`);
    if (c.type === 'mppt') return positive(p.maxCurrent) && positive(dcV) ? known(p.maxCurrent, dcV, 'manufacturer maximum DC output current') : unresolved('Set MPPT maximum DC output current.');
    if (c.type === 'alternator') return positive(p.amps ?? p.maxCurrent) ? known(p.amps ?? p.maxCurrent, p.voltage ?? dcV, 'declared alternator output current') : unresolved(`Set the output current for "${c.name || c.id}".`);
    if (c.type === 'cerbo') {
      const watts = positive(p.watts) ? p.watts : CERBO_TYPICAL_WATTS;
      return known(watts / dcV, dcV, positive(p.watts) ? 'declared GX device watts / DC voltage' : 'Cerbo GX typical consumption', positive(p.watts) ? [] : [`Cerbo GX assumed ${CERBO_TYPICAL_WATTS}W (datasheet typical, no touch display or accessories).`]);
    }
    if (negligibleDraw.has(c.type)) return known(0, dcV, 'negligible monitoring/balancing draw');
    if (c.type === 'orion-dc-dc') return positive(p.amps ?? p.maxCurrent) && positive(p.outputVoltage ?? p.voltage ?? dcV) ? known(p.amps ?? p.maxCurrent, p.outputVoltage ?? p.voltage ?? dcV, 'declared DC-DC maximum output current') : unresolved('Set DC-DC output amps and voltage.');
    if (c.type === 'battery' || dcPass.has(c.type) || acPass.has(c.type) || c.type === 'shore-power') return unresolved('Current depends on the connected circuit, not a component rating.');
    return unresolved(`Electrical analysis is not available for "${c.name || c.id}" (${c.type}).`, true);
  };
  for (const c of input.components) result.components[c.id] = demand(c);
  for (const w of input.wires) {
    const domain = domains.get(w.id);
    let value: ElectricalValue = unresolved('Missing, incompatible or unsupported terminals.');
    let scenario: WireAnalysis['scenario'];
    if (pvWires.has(w.id)) { value = pvWires.get(w.id)!; scenario = 'charge'; }
    else if (domain === 'ground') { value = known(0, 0, 'normal protective ground', ['Ground fault current and protective conductor sizing require separate checks.']); scenario = 'normal-ground'; }
    else if (domain === 'data') value = unresolved('Data cables are not sized as power conductors.', true);
    else if (domain?.startsWith('pv')) value = unresolved('Connect a complete PV array to MPPT PV+ and PV- and set panel power and Vmp.');
    else if (domain) {
      const a = reachable(w.fromComponentId, domain, w.id, w.fromTerminal), b = reachable(w.toComponentId, domain, w.id, w.toTerminal);
      if (a.has(w.toComponentId)) value = unresolved('Parallel paths or a circuit cycle prevent supported current sharing inference.', true);
      else {
        const ac = domain === 'hot' || domain === 'neutral';
        const summarize = (ids: Set<string>) => {
          let load = 0, charge = 0, sources = 0, acInputOnly = 0, sourceRatingA = Infinity, split = false; const voltages = new Set<number>(); const sourceKeys = new Set<string>(); let error: ElectricalValue | undefined, voltageError: ElectricalValue | undefined, unratedCharger: ElectricalValue | undefined;
          const transfer = ac ? Array.from(ids).find(id => components.get(id)?.type === 'transfer-switch') : undefined;
          for (const id of Array.from(ids)) {
            const c = components.get(id)!;
            if (ac && inverters.has(c.type) && !viaTerminal(id, domain, ids, w).some(t => t.startsWith('ac-out'))) { acInputOnly++; continue; }
            if (c.type === 'battery' || (ac && (c.type === 'shore-power' || inverters.has(c.type)))) {
              const bank = c.properties?.batteryBankId;
              if (ac && c.type === 'shore-power' && positive(c.properties?.maxAmps)) sourceRatingA = Math.min(sourceRatingA, c.properties!.maxAmps);
              sourceKeys.add(!ac && c.type === 'battery' && typeof bank === 'string' && bank.trim() && Number(c.properties?.voltage) === input.systemVoltage ? `bank:${bank}`
                : !ac && seriesString.has(c.id) ? seriesString.get(c.id)!
                : !ac && inferredBank.has(c.id) ? inferredBank.get(c.id)!
                : transfer && c.type === 'shore-power' ? `transfer:${transfer}` : c.id);
              sources = sourceKeys.size;
              if (!ac && c.type === 'battery' && !seriesString.has(c.id) && c.properties?.voltage != null && Number(c.properties.voltage) !== input.systemVoltage) voltageError = unresolved('Battery nominal voltage differs from system voltage; declare a supported bank configuration.');
              // 120/240V split phase: the drawing has one hot conductor, so which
              // leg each 120V load sits on is unknown. Every conductor is sized for
              // the worst case, all 120V loads on one leg: 240V loads at W/240 plus
              // 120V loads at W/120. No conductor can carry more than that.
              if (ac && isSplitPhase(c)) split = true; continue;
            }
            const converterInput = !ac && c.type === 'orion-dc-dc' && (adjacency.get(id) ?? []).some(edge => domains.get(edge.id) === domain && (edge.fromComponentId === id ? edge.fromTerminal : edge.toTerminal)?.startsWith('input-') && (edge.id === w.id || ids.has(edge.fromComponentId === id ? edge.toComponentId : edge.fromComponentId)));
            const isLoad = c.type === (ac ? 'ac-load' : 'dc-load') || (!ac && inverters.has(c.type)) || converterInput || (ac && c.type === 'blue-smart-charger') || (!ac && (c.type === 'cerbo' || negligibleDraw.has(c.type)));
            if (isLoad || (!ac && chargerTypes.includes(c.type))) {
              const v = converterInput ? dcdcInput(c) : ac && c.type === 'blue-smart-charger' ? chargerInput(c) : result.components[id];
              if (v.status !== 'known' && ac && c.type === 'blue-smart-charger') { unratedCharger = v; continue; }
              if (v.status !== 'known') { error = v; continue; }
              voltages.add(v.voltageV!); if (isLoad) load += v.currentA!; else charge += v.currentA!;
            } else if (!(ac ? acPass : dcPass).has(c.type)) error = unresolved(`This wire connects to "${c.name || c.id}" (${c.type}), whose electrical behavior is not supported. Review that component's power connections.`, true);
          }
          return { load, charge, sources, voltages, error: error ?? voltageError, voltageError, unratedCharger, acInputOnly, sourceRatingA, split };
        };
        const sa = summarize(a), sb = summarize(b);
        // The supply-free side is what this wire feeds, however many supplies
        // sit behind the other side: a load's wire carries that load's current.
        // Several supplies only leave wires BETWEEN them unresolved.
        const downstream = sa.sources >= 1 && sb.sources === 0 ? sb : sb.sources >= 1 && sa.sources === 0 ? sa : undefined;
        const upstream = downstream === sa ? sb : downstream === sb ? sa : undefined;
        // A battery-less island supplied by a converter or alternator - an
        // Orion's 12V output panel in a 48V boat, an alternator feeding an
        // Orion's input. The supply is the side with the charger; the wire
        // carries what the other side draws, at the island's own voltage.
        const island = !ac && !sa.sources && !sb.sources ? islandDemand(a, sa, b, sb) : undefined;
        // One input leg of a transfer switch carries at most its own source's rating.
        const transferLeg = ac && !downstream ? [[a, sa], [b, sb]].find(([ids, sum]: any) => (sum as any).sources === 1 && !Array.from(ids as Set<string>).some(id => components.get(id)?.type === 'transfer-switch')
          && Array.from((ids === a ? b : a) as Set<string>).some(id => components.get(id)?.type === 'transfer-switch')) : undefined;
        const legSource = transferLeg ? Array.from(transferLeg[0] as Set<string>).map(id => components.get(id)!).find(c => c.type === 'shore-power') : undefined;
        if (island) value = island;
        else if (legSource && positive(legSource.properties?.maxAmps)) { value = known(legSource.properties!.maxAmps, getACVoltage(legSource), 'transfer-switch input sized to its source rating'); scenario = 'load'; }
        // Problems behind the supply side do not change what a branch draws;
        // only a voltage-domain problem there does.
        else if (downstream ? downstream.error || upstream!.voltageError : sa.error || sb.error) value = (downstream ? downstream.error ?? upstream!.voltageError : sa.error ?? sb.error)!;
        // A charger with no declared AC input current: its circuit is bounded by
        // the shore inlet feeding it, as a MultiPlus AC input is.
        else if (ac && downstream && upstream && downstream.unratedCharger && Number.isFinite(upstream.sourceRatingA) && !upstream.split) {
          const breaker = seriesBreakerA(w, domain, downstream === sa ? a : b);
          value = breaker < upstream.sourceRatingA
            ? known(breaker, input.systemVoltage, 'charger AC input sized to the breaker protecting it', ['Charger AC input current not declared; bounded by the AC breaker in series with this circuit.'])
            : known(upstream.sourceRatingA, input.systemVoltage, 'charger AC input sized to the shore-power rating', ['Charger AC input current not declared; bounded by the shore-power inlet rating feeding it.']);
          value.voltageV = Array.from(a).concat(Array.from(b)).map(id => components.get(id)!).filter(x => x.type === 'shore-power').map(x => getACVoltage(x))[0] ?? value.voltageV;
          scenario = 'load';
        }
        else if (downstream?.unratedCharger) value = downstream.unratedCharger;
        else if (ac && downstream && upstream && downstream.acInputOnly && !Number.isFinite(upstream.sourceRatingA))
          value = unresolved('Set the shore-power inlet rating (maxAmps) to size the inverter/charger AC input conductors.');
        else if (ac && downstream && upstream && downstream.acInputOnly) {
          value = known(upstream.sourceRatingA, input.systemVoltage, 'inverter/charger AC input sized to the shore-power rating', ['AC input pass-through and charging demand are bounded by the shore-power inlet rating, not modeled separately.']);
          value.voltageV = Array.from(a).concat(Array.from(b)).map(id => components.get(id)!).filter(x => x.type === 'shore-power').map(x => getACVoltage(x))[0] ?? value.voltageV;
          scenario = 'load';
        }
        else if (!downstream) value = unresolved('A single supported source path is required; disconnected or multiple-source circuits need review.', sa.sources + sb.sources > 1);
        else if (ac && Array.from(a).concat(Array.from(b)).some(id => { const source = components.get(id)!; return (source.type === 'shore-power' || inverters.has(source.type)) && Array.from(downstream.voltages).some(v => !getSupportedACVoltages(source).includes(v)); })) value = unresolved('Connected AC load voltage is incompatible with the source output voltage.');
        else if ((downstream.voltages.size > 1 && !upstream!.split) || (!ac && Array.from(downstream.voltages).some(v => v !== input.systemVoltage))) value = unresolved('Connected loads have different nominal voltages; resolve the voltage domain.');
        else if (downstream.load === 0 && downstream.charge === 0 && Array.from(downstream === sa ? a : b).some(id => negligibleDraw.has(components.get(id)!.type)))
          value = known(0, input.systemVoltage, 'negligible monitoring/balancing draw');
        else if (downstream.load === 0 && downstream.charge === 0) value = unresolved('No declared load or charger current on this branch.');
        else {
          const voltage = ac ? Math.min(...Array.from(downstream.voltages)) : input.systemVoltage;
          value = known(Math.max(downstream.load, downstream.charge), voltage, 'terminal-aware branch demand', [
            ...(upstream!.split && downstream.voltages.size > 1 ? ['120/240V split phase: worst case with every 120V load on one leg (240V loads at W/240 plus 120V loads at W/120); voltage drop judged against 120V.'] : []),'Charge and discharge demands are evaluated separately; source current never cancels load demand.', 'Parallel batteries form one source for common downstream branches; each battery\'s own cables are solved separately from cable resistance.']);
          scenario = downstream.charge && downstream.load ? 'governing' : downstream.charge ? 'charge' : 'load';
        }
      }
    }
    // The tree walk could not settle this DC wire (parallel batteries, a loop,
    // a battery-to-battery link): solve the circuit from cable resistance.
    if (value.status !== 'known' && !pvWires.has(w.id) && domain !== 'ground' && domain !== 'data') {
      const solved = sharing().get(w.id);
      if (solved?.value.status === 'known' || (solved && TOPOLOGY_REASONS.some(r => value.reason?.startsWith(r)))) { value = solved.value; scenario = solved.scenario; }
    }
    if (value.status === 'known' && (w.conductorMaterial ?? options.conductorMaterial) === 'aluminum' && scenario !== 'normal-ground') value = unresolved('Only copper conductor sizing tables are available; aluminum sizing is unsupported.', true);
    const analysis: WireAnalysis = { ...value, wireId: w.id, selectedGauge: w.gauge, scenario, issues: [...(pvWires.get(w.id)?.issues ?? [])] };
    if (value.status === 'known' && scenario !== 'normal-ground') {
      if (!positive(w.length)) analysis.issues.push('Set a positive physical wire length to calculate conductor size.');
      else {
        const sizingCurrent = analysis.sizingCurrentA ?? value.currentA!;
        analysis.calculation = calculateWireSize({ current: sizingCurrent, voltage: value.voltageV!, length: w.length, ...options, currentGauge: w.gauge });
        if (w.gauge) {
          const selected = evaluateWireGauge(w.gauge, { current: sizingCurrent, voltage: value.voltageV!, length: w.length, ...options });
          analysis.selectedGaugeAmpacityA = selected?.ampacityA;
          analysis.selectedGaugeVoltageDropPercent = selected?.voltageDropPercent;
          if (!selected) analysis.issues.push('Selected gauge is not recognized.');
          else {
            if (sizingCurrent > selected.ampacityA) analysis.issues.push('Selected conductor exceeds derated ampacity.');
            if (selected.voltageDropPercent > (options.maxVoltageDrop ?? 3)) analysis.issues.push('Selected conductor exceeds the configured voltage drop limit.');
          }
        }
        if (analysis.calculation.status === 'error') analysis.issues.push(analysis.calculation.message ?? 'Conductor sizing failed.');
      }
    }
    result.wires[w.id] = analysis;
  }
  result.assumptions = Array.from(new Set([...result.assumptions, ...Array.from(pvWires.values()).flatMap(value => value.assumptions)]));
  return result;
}
