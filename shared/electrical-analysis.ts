import { DEVICE_DEFINITIONS } from './device-definitions';
import { getACVoltage, getSupportedACVoltages, isSplitPhase } from './ac-voltage';
import { calculateWireSize, evaluateWireGauge, type InsulationType } from './wire-calculator';
import type { WireCalculation } from './schema';
import { analyzePVCircuits, panelOperatingValue } from './pv-analysis';

export const ELECTRICAL_ENGINE_VERSION = '1.3.0';
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
const dcPass = new Set(['busbar-positive', 'busbar-negative', 'dc-panel', 'fuse', 'dc-breaker', 'switch', 'smartshunt', 'lynx-distributor', 'lynx-power-in']);
const acPass = new Set(['ac-panel', 'ac-breaker']);
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
  const reachable = (start: string, domain: Domain, excluded?: string): Set<string> => {
    const visited = new Set<string>(), queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]; if (visited.has(id)) continue; visited.add(id);
      const c = components.get(id); if (!c) continue;
      const pass = domain === 'hot' || domain === 'neutral' ? acPass.has(c.type) : dcPass.has(c.type);
      // A traversal begins at either endpoint, but must not pass through a source/load/converter.
      if (id !== start && !pass) continue;
      for (const w of adjacency.get(id) ?? []) {
        if (w.id === excluded || domains.get(w.id) !== domain) continue;
        queue.push(w.fromComponentId === id ? w.toComponentId : w.fromComponentId);
      }
    }
    return visited;
  };
  const chargerInput = (c: AnalysisComponent): ElectricalValue => {
    const p = c.properties ?? {}, label = c.name || c.id;
    if (!positive(p.acInputAmps)) return unresolved(`Set the rated AC input current for "${label}" in Charger Specifications. Its DC charge current cannot be used as AC input current.`);
    return known(p.acInputAmps, getACVoltage(c), 'declared charger maximum AC input current');
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
      const a = reachable(w.fromComponentId, domain, w.id), b = reachable(w.toComponentId, domain, w.id);
      if (a.has(w.toComponentId)) value = unresolved('Parallel paths or a circuit cycle prevent supported current sharing inference.', true);
      else {
        const ac = domain === 'hot' || domain === 'neutral';
        const summarize = (ids: Set<string>) => {
          let load = 0, charge = 0, sources = 0; const voltages = new Set<number>(); const sourceKeys = new Set<string>(); let error: ElectricalValue | undefined;
          for (const id of Array.from(ids)) {
            const c = components.get(id)!;
            if (c.type === 'battery' || (ac && (c.type === 'shore-power' || inverters.has(c.type)))) {
              const bank = c.properties?.batteryBankId;
              sourceKeys.add(!ac && c.type === 'battery' && typeof bank === 'string' && bank.trim() && Number(c.properties?.voltage) === input.systemVoltage ? `bank:${bank}` : c.id);
              sources = sourceKeys.size;
              if (!ac && c.type === 'battery' && c.properties?.voltage != null && Number(c.properties.voltage) !== input.systemVoltage) error = unresolved('Battery nominal voltage differs from system voltage; declare a supported bank configuration.');
              if (ac && isSplitPhase(c)) error = unresolved('Split-phase leg and neutral balancing are not modeled.', true); continue;
            }
            const converterInput = !ac && c.type === 'orion-dc-dc' && (adjacency.get(id) ?? []).some(edge => domains.get(edge.id) === domain && (edge.fromComponentId === id ? edge.fromTerminal : edge.toTerminal)?.startsWith('input-') && (edge.id === w.id || ids.has(edge.fromComponentId === id ? edge.toComponentId : edge.fromComponentId)));
            const isLoad = c.type === (ac ? 'ac-load' : 'dc-load') || (!ac && inverters.has(c.type)) || converterInput || (ac && c.type === 'blue-smart-charger');
            if (isLoad || (!ac && ['mppt','blue-smart-charger', 'orion-dc-dc'].includes(c.type))) {
              const v = converterInput ? positive(c.properties?.inputAmps) && positive(c.properties?.inputVoltage ?? input.systemVoltage) ? known(c.properties!.inputAmps, c.properties!.inputVoltage ?? input.systemVoltage, 'declared DC-DC input current') : unresolved('Set DC-DC inputAmps and inputVoltage; output current cannot be used as input current.') : ac && c.type === 'blue-smart-charger' ? chargerInput(c) : result.components[id]; if (v.status !== 'known') { error = v; continue; }
              voltages.add(v.voltageV!); if (isLoad) load += v.currentA!; else charge += v.currentA!;
            } else if (!(ac ? acPass : dcPass).has(c.type)) error = unresolved(`This wire connects to "${c.name || c.id}" (${c.type}), whose electrical behavior is not supported. Review that component's power connections.`, true);
          }
          return { load, charge, sources, voltages, error };
        };
        const sa = summarize(a), sb = summarize(b);
        const downstream = sa.sources === 1 && sb.sources === 0 ? sb : sb.sources === 1 && sa.sources === 0 ? sa : undefined;
        if (sa.error || sb.error) value = sa.error ?? sb.error!;
        else if (!downstream) value = unresolved('A single supported source path is required; disconnected or multiple-source circuits need review.', sa.sources + sb.sources > 1);
        else if (ac && Array.from(a).concat(Array.from(b)).some(id => { const source = components.get(id)!; return (source.type === 'shore-power' || inverters.has(source.type)) && Array.from(downstream.voltages).some(v => !getSupportedACVoltages(source).includes(v)); })) value = unresolved('Connected AC load voltage is incompatible with the source output voltage.');
        else if (downstream.voltages.size > 1 || (!ac && Array.from(downstream.voltages).some(v => v !== input.systemVoltage))) value = unresolved('Connected loads have different nominal voltages; resolve the voltage domain.');
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
