import { DEVICE_DEFINITIONS } from './device-definitions';
import { getACVoltage, getSupportedACVoltages, isSplitPhase } from './ac-voltage';
import { calculateWireSize, evaluateWireGauge, type InsulationType } from './wire-calculator';
import type { WireCalculation } from './schema';
import { analyzePVCircuits, panelOperatingValue } from './pv-analysis';

export const ELECTRICAL_ENGINE_VERSION = '1.4.0';
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
  const m = String(c.properties?.model ?? c.name ?? '').match(/\b(12|24|48)\s*\/\s*(12|24|48)\b/);
  return m ? { inV: Number(m[1]), outV: Number(m[2]) } : undefined;
};
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
 * Conservative steady-state analysis of tree circuits. Cycles, parallel current
 * sharing, custom behavior and AC transfer/charging need
 * explicit models; they return unresolved, never an invented zero current.
 * Existing sizing tables are retained unchanged. No conductor is rewritten.
 */
export function analyzeElectricalDesign(input: { components: AnalysisComponent[]; wires: AnalysisWire[]; systemVoltage: number }, options: AnalysisOptions = {}): AnalysisResult {
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
  const bankKey = (c: AnalysisComponent) => {
    const bank = c.properties?.batteryBankId;
    return typeof bank === 'string' && bank.trim() && Number(c.properties?.voltage) === input.systemVoltage ? `bank:${bank}` : inferredBank.get(c.id);
  };
  /**
   * A wire on one battery's own leg of a parallel bank (battery -> its fuse ->
   * the common switch/shunt). Sharing between batteries is NOT inferred -
   * cable runs and BMS disconnects make it unreliable. Instead the leg is
   * sized for the worst case of one other battery dropping out: with two
   * batteries that is the full bank current (an exact bound), with three or
   * more identical batteries bank current / (n - 1). Mixed capacities or
   * voltages stay unresolved.
   */
  const bankShare = (a: Set<string>, b: Set<string>, summarize: (ids: Set<string>) => { load: number; charge: number; sources: number; error?: ElectricalValue }) => {
    const batteriesIn = (ids: Set<string>) => Array.from(ids).map(id => components.get(id)!).filter(c => c.type === 'battery');
    const keysA = new Set(batteriesIn(a).map(bankKey)), keysB = new Set(batteriesIn(b).map(bankKey));
    const key = Array.from(keysA).find(k => k && keysB.has(k));
    if (!key) return undefined;
    // The battery's leg: only that bank's batteries and pass-through parts.
    const isLeg = (ids: Set<string>) => Array.from(ids).every(id => { const c = components.get(id)!; return (c.type === 'battery' && bankKey(c) === key) || dcPass.has(c.type); });
    const [near, far] = isLeg(a) && !isLeg(b) ? [a, b] : isLeg(b) && !isLeg(a) ? [b, a] : [undefined, undefined];
    if (!near || !far) return undefined;
    const union = new Set([...Array.from(a), ...Array.from(b)]);
    const bank = batteriesIn(union).filter(c => bankKey(c) === key);
    const same = (f: (c: AnalysisComponent) => unknown) => new Set(bank.map(f)).size === 1;
    if (!same(c => Number(c.properties?.voltage ?? input.systemVoltage)) || (bank.length > 2 && !(same(c => Number(c.properties?.capacity)) && positive(Number(bank[0].properties?.capacity)))))
      return { value: unresolved('Batteries in this bank differ (or do not declare capacity); per-battery current is not inferred. Declare matching batteries or size each battery cable for the full bank current.'), scenario: undefined };
    const whole = summarize(union);
    if (whole.error) return { value: whole.error, scenario: undefined };
    if (whole.sources !== 1) return undefined;
    const demand = Math.max(whole.load, whole.charge);
    if (!(demand > 0)) return undefined;
    const k = batteriesIn(near).filter(c => bankKey(c) === key).length;
    const remaining = bank.length - 1; // one other battery disconnected
    const leg = Math.min(demand, demand * k / Math.max(1, remaining));
    return {
      value: known(leg, input.systemVoltage, 'parallel bank leg, one other battery disconnected',
        [bank.length === 2 ? 'Each battery cable in a 2-battery bank is sized for the full bank current: either battery may be disconnected by its BMS or fuse.'
          : `Sized for the bank current shared by the ${remaining} remaining identical batteries when one is disconnected; no normal-operation sharing is assumed.`]),
      scenario: (whole.charge && whole.load ? 'governing' : whole.charge ? 'charge' : 'load') as WireAnalysis['scenario'],
    };
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
  const demand = (c: AnalysisComponent): ElectricalValue => {
    const p = c.properties ?? {};
    if (c.type === 'solar-panel') return panelOperatingValue(c);
    if (c.type === 'dc-load' || c.type === 'ac-load') {
      const voltage = c.type === 'ac-load' ? getACVoltage(c) : p.voltage ?? input.systemVoltage;
      if (!positive(voltage)) return unresolved('Set a positive nominal voltage.');
      if (finite(p.watts ?? p.power)) return known((p.watts ?? p.power) / voltage, voltage, 'declared load watts / nominal voltage');
      if (finite(p.amps)) return known(p.amps, voltage, 'declared load current');
      return unresolved('Set load watts or amps.');
    }
    if (inverters.has(c.type)) {
      if (!positive(input.systemVoltage) || !positive(efficiency) || efficiency > 1) return unresolved('Set a valid DC voltage and inverter efficiency.');
      const outputEdges = (adjacency.get(c.id) ?? []).filter(w => domains.get(w.id) === 'hot' && (w.fromComponentId === c.id ? w.fromTerminal : w.toTerminal)?.startsWith('ac-out'));
      if (!outputEdges.length) {
        if (positive(p.dcInputAmps)) return known(p.dcInputAmps, input.systemVoltage, 'declared inverter DC input sizing current', ['Declared maximum DC input current; AC utilization is not inferred.']);
        if (positive(p.dcInputWatts)) return known(p.dcInputWatts / input.systemVoltage, input.systemVoltage, 'declared inverter DC input watts / DC voltage');
        return unresolved('Connect inverter AC output to declared loads, or set dcInputAmps/dcInputWatts from a reviewed specification; no utilization guess is made.');
      }
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
      return known(watts / efficiency / input.systemVoltage, input.systemVoltage, 'unique connected AC loads / efficiency / DC voltage', [`Inverter efficiency ${(efficiency * 100).toFixed(1)}%; connected steady-state loads only.`]);
    }
    if (c.type === 'blue-smart-charger') return positive(p.amps ?? p.maxCurrent) ? known(p.amps ?? p.maxCurrent, p.voltage ?? input.systemVoltage, 'manufacturer maximum DC charge current') : unresolved(`Set the DC charge current for "${c.name || c.id}".`);
    if (c.type === 'mppt') return positive(p.maxCurrent) && positive(input.systemVoltage) ? known(p.maxCurrent, input.systemVoltage, 'manufacturer maximum DC output current') : unresolved('Set MPPT maximum DC output current.');
    if (c.type === 'alternator') return positive(p.amps ?? p.maxCurrent) ? known(p.amps ?? p.maxCurrent, p.voltage ?? input.systemVoltage, 'declared alternator output current') : unresolved(`Set the output current for "${c.name || c.id}".`);
    if (c.type === 'cerbo') {
      const watts = positive(p.watts) ? p.watts : CERBO_TYPICAL_WATTS;
      return known(watts / input.systemVoltage, input.systemVoltage, positive(p.watts) ? 'declared GX device watts / DC voltage' : 'Cerbo GX typical consumption', positive(p.watts) ? [] : [`Cerbo GX assumed ${CERBO_TYPICAL_WATTS}W (datasheet typical, no touch display or accessories).`]);
    }
    if (negligibleDraw.has(c.type)) return known(0, input.systemVoltage, 'negligible monitoring/balancing draw');
    if (c.type === 'orion-dc-dc') return positive(p.amps ?? p.maxCurrent) && positive(p.outputVoltage ?? p.voltage ?? input.systemVoltage) ? known(p.amps ?? p.maxCurrent, p.outputVoltage ?? p.voltage ?? input.systemVoltage, 'declared DC-DC maximum output current') : unresolved('Set DC-DC output amps and voltage.');
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
          let load = 0, charge = 0, sources = 0, acInputOnly = 0, sourceRatingA = Infinity; const voltages = new Set<number>(); const sourceKeys = new Set<string>(); let error: ElectricalValue | undefined;
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
              if (!ac && c.type === 'battery' && !seriesString.has(c.id) && c.properties?.voltage != null && Number(c.properties.voltage) !== input.systemVoltage) error = unresolved('Battery nominal voltage differs from system voltage; declare a supported bank configuration.');
              if (ac && isSplitPhase(c)) error = unresolved('Split-phase leg and neutral balancing are not modeled.', true); continue;
            }
            const converterInput = !ac && c.type === 'orion-dc-dc' && (adjacency.get(id) ?? []).some(edge => domains.get(edge.id) === domain && (edge.fromComponentId === id ? edge.fromTerminal : edge.toTerminal)?.startsWith('input-') && (edge.id === w.id || ids.has(edge.fromComponentId === id ? edge.toComponentId : edge.fromComponentId)));
            const isLoad = c.type === (ac ? 'ac-load' : 'dc-load') || (!ac && inverters.has(c.type)) || converterInput || (ac && c.type === 'blue-smart-charger') || (!ac && (c.type === 'cerbo' || negligibleDraw.has(c.type)));
            if (isLoad || (!ac && chargerTypes.includes(c.type))) {
              const v = converterInput ? dcdcInput(c) : ac && c.type === 'blue-smart-charger' ? chargerInput(c) : result.components[id]; if (v.status !== 'known') { error = v; continue; }
              voltages.add(v.voltageV!); if (isLoad) load += v.currentA!; else charge += v.currentA!;
            } else if (!(ac ? acPass : dcPass).has(c.type)) error = unresolved(`This wire connects to "${c.name || c.id}" (${c.type}), whose electrical behavior is not supported. Review that component's power connections.`, true);
          }
          return { load, charge, sources, voltages, error, acInputOnly, sourceRatingA };
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
        const shared = !ac && !island && !downstream && !sa.error && !sb.error ? bankShare(a, b, summarize) : undefined;
        // One input leg of a transfer switch carries at most its own source's rating.
        const transferLeg = ac && !downstream ? [[a, sa], [b, sb]].find(([ids, sum]: any) => (sum as any).sources === 1 && !Array.from(ids as Set<string>).some(id => components.get(id)?.type === 'transfer-switch')
          && Array.from((ids === a ? b : a) as Set<string>).some(id => components.get(id)?.type === 'transfer-switch')) : undefined;
        const legSource = transferLeg ? Array.from(transferLeg[0] as Set<string>).map(id => components.get(id)!).find(c => c.type === 'shore-power') : undefined;
        if (island) value = island;
        else if (shared) { value = shared.value; scenario = shared.scenario; }
        else if (legSource && positive(legSource.properties?.maxAmps)) { value = known(legSource.properties!.maxAmps, getACVoltage(legSource), 'transfer-switch input sized to its source rating'); scenario = 'load'; }
        else if (sa.error || sb.error) value = sa.error ?? sb.error!;
        else if (ac && downstream && upstream && downstream.acInputOnly && !Number.isFinite(upstream.sourceRatingA))
          value = unresolved('Set the shore-power inlet rating (maxAmps) to size the inverter/charger AC input conductors.');
        else if (ac && downstream && upstream && downstream.acInputOnly) {
          value = known(upstream.sourceRatingA, input.systemVoltage, 'inverter/charger AC input sized to the shore-power rating', ['AC input pass-through and charging demand are bounded by the shore-power inlet rating, not modeled separately.']);
          value.voltageV = Array.from(a).concat(Array.from(b)).map(id => components.get(id)!).filter(x => x.type === 'shore-power').map(x => getACVoltage(x))[0] ?? value.voltageV;
          scenario = 'load';
        }
        else if (!downstream) value = unresolved('A single supported source path is required; disconnected or multiple-source circuits need review.', sa.sources + sb.sources > 1);
        else if (ac && Array.from(a).concat(Array.from(b)).some(id => { const source = components.get(id)!; return (source.type === 'shore-power' || inverters.has(source.type)) && Array.from(downstream.voltages).some(v => !getSupportedACVoltages(source).includes(v)); })) value = unresolved('Connected AC load voltage is incompatible with the source output voltage.');
        else if (downstream.voltages.size > 1 || (!ac && Array.from(downstream.voltages).some(v => v !== input.systemVoltage))) value = unresolved('Connected loads have different nominal voltages; resolve the voltage domain.');
        else if (downstream.load === 0 && downstream.charge === 0 && Array.from(downstream === sa ? a : b).some(id => negligibleDraw.has(components.get(id)!.type)))
          value = known(0, input.systemVoltage, 'negligible monitoring/balancing draw');
        else if (downstream.load === 0 && downstream.charge === 0) value = unresolved('No declared load or charger current on this branch.');
        else {
          const voltage = ac ? Array.from(downstream.voltages)[0] : input.systemVoltage;
          value = known(Math.max(downstream.load, downstream.charge), voltage, 'terminal-aware branch demand', ['Charge and discharge demands are evaluated separately; source current never cancels load demand.', 'Batteries sharing an explicit batteryBankId and nominal system voltage form one source for common downstream branches only; individual battery current sharing is not inferred.']);
          scenario = downstream.charge && downstream.load ? 'governing' : downstream.charge ? 'charge' : 'load';
        }
      }
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
