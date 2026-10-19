import type { AnalysisComponent, AnalysisWire, ElectricalValue } from './electrical-analysis';
import { DEVICE_DEFINITIONS } from './device-definitions';

export interface PVWireValue extends ElectricalValue { sizingCurrentA?: number; issues?: string[] }
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const unknown = (reason: string, unsupported = false): PVWireValue => ({ status: unsupported ? 'unsupported' : 'unknown', reason, source: 'PV circuit', assumptions: [] });

export function panelOperatingValue(component: AnalysisComponent): ElectricalValue {
  const p = component.properties ?? {};
  const voltage = p.vmp ?? p.voltage;
  const watts = p.watts ?? p.power;
  const current = p.imp ?? (valid(watts) && valid(voltage) ? watts / voltage : undefined);
  if (!valid(voltage) || !valid(current)) return unknown('Set solar panel power and PV voltage (Vmp), or a positive Imp rating.');
  if (p.isc !== undefined && (!valid(p.isc) || p.isc < current)) return unknown('Panel Isc must be positive and at least its operating current (Imp).');
  if (p.voc !== undefined && (!valid(p.voc) || p.voc < voltage)) return unknown('Panel Voc must be positive and at least its operating voltage (Vmp).');
  return { status: 'known', currentA: current, voltageV: voltage, source: 'panel Imp or rated watts / Vmp', assumptions: ['Panel voltage is Vmp, independent of battery voltage.'] };
}

/** Complete terminal circuits: each panel is a source between its two terminals.
 * Enumerate independent series strings, then sum their currents on shared feeds.
 * Converters are boundaries: PV never conducts through an MPPT into its battery side.
 */
export function analyzePVCircuits(components: AnalysisComponent[], wires: AnalysisWire[]): Map<string, PVWireValue> {
  const result = new Map<string, PVWireValue>();
  type Edge = { a: string; b: string; wire?: AnalysisWire; panel?: AnalysisComponent };
  const graph = new Map<string, Edge[]>();
  const metadata = new Map<string, { component: AnalysisComponent; terminal: string; allowed: boolean }>();
  const passive = new Set(['busbar-positive', 'busbar-negative', 'fuse', 'switch', 'dc-breaker']);
  const node = (c: AnalysisComponent, terminal: string) => {
    const key = JSON.stringify([c.id, terminal]);
    const definition = DEVICE_DEFINITIONS[c.type]?.terminals.find(t => t.id === terminal);
    const allowed = c.type === 'solar-panel' ? terminal === 'positive' || terminal === 'negative'
      : c.type === 'mppt' ? terminal === 'pv-positive' || terminal === 'pv-negative'
      : passive.has(c.type) && (terminal === '@rail' || definition?.type === 'positive' || definition?.type === 'negative'
        || (c.type === 'busbar-positive' && /^pos-[1-6]$/.test(terminal)) || (c.type === 'busbar-negative' && /^neg-[1-6]$/.test(terminal)));
    metadata.set(key, { component: c, terminal, allowed });
    if (!graph.has(key)) graph.set(key, []);
    return key;
  };
  const add = (edge: Edge) => {
    graph.get(edge.a)!.push(edge); graph.get(edge.b)!.push(edge);
  };
  const byId = new Map(components.map(c => [c.id, c]));
  for (const wire of wires) {
    const a = byId.get(wire.fromComponentId), b = byId.get(wire.toComponentId);
    if (!a || !b) {
      if (a?.type === 'solar-panel' || b?.type === 'solar-panel' || wire.fromTerminal?.startsWith('pv-') || wire.toTerminal?.startsWith('pv-'))
        result.set(wire.id, unknown('PV wire refers to a missing component.'));
      continue;
    }
    add({ a: node(a, wire.fromTerminal ?? ''), b: node(b, wire.toTerminal ?? ''), wire });
  }
  for (const c of components) {
    if (c.type === 'solar-panel') add({ a: node(c, 'positive'), b: node(c, 'negative'), panel: c });
    else if (passive.has(c.type)) {
      const terminals = Array.from(metadata.entries()).filter(([, m]) => m.component.id === c.id && m.allowed).map(([key]) => key);
      const hub = node(c, '@rail');
      for (const terminal of terminals) add({ a: hub, b: terminal });
    }
  }
  const seen = new Set<string>();
  for (const [seed, meta] of Array.from(metadata)) {
    if (seen.has(seed) || !(meta.component.type === 'solar-panel' || (meta.component.type === 'mppt' && meta.terminal.startsWith('pv-')))) continue;
    const nodes = new Set<string>(), edges = new Set<Edge>(), queue = [seed];
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i]; if (nodes.has(key)) continue;
      nodes.add(key); seen.add(key);
      for (const edge of graph.get(key) ?? []) { edges.add(edge); queue.push(edge.a === key ? edge.b : edge.a); }
    }
    const circuitWires = Array.from(edges).filter(e => e.wire);
    if (!circuitWires.length) continue;
    const reject = (reason: string, unsupported = false) => { for (const edge of circuitWires) result.set(edge.wire!.id, unknown(reason, unsupported)); };
    if (Array.from(nodes).some(key => !metadata.get(key)!.allowed)) { reject('PV circuit has a missing or incompatible terminal, or connects to a non-PV device.'); continue; }
    const controllers = new Map(Array.from(nodes).map(key => metadata.get(key)!.component).filter(c => c.type === 'mppt').map(c => [c.id, c]));
    if (controllers.size !== 1) { reject('Connect each PV array to one MPPT PV input with both positive and negative wires.', controllers.size > 1); continue; }
    const controller = Array.from(controllers.values())[0];
    const start = JSON.stringify([controller.id, 'pv-positive']), end = JSON.stringify([controller.id, 'pv-negative']);
    if (!nodes.has(start) || !nodes.has(end)) { reject('PV circuit is incomplete: connect both array leads to MPPT PV+ and PV-.'); continue; }
    // Conducting rails must be trees. Redundant wires require current-sharing inference.
    const parent = new Map<string, string>();
    const root = (key: string): string => { let next = key; while (parent.has(next)) next = parent.get(next)!; return next; };
    let loop = false;
    for (const edge of Array.from(edges)) if (!edge.panel) {
      const a = root(edge.a), b = root(edge.b);
      if (a === b) { loop = true; break; }
      parent.set(a, b);
    }
    if (loop) { reject('Parallel wire paths or a PV conductor loop require current-sharing review.', true); continue; }
    const paths: Edge[][] = [];
    let invalidPolarity = false, tooComplex = false, steps = 0;
    const walk = (key: string, visited: Set<string>, path: Edge[], reversed = false) => {
      if (tooComplex || ++steps > 10000 || paths.length >= 128 || path.length > 512) { tooComplex = true; return; }
      if (key === end) { if (reversed) invalidPolarity = true; else paths.push(path); return; }
      for (const edge of graph.get(key) ?? []) {
        const next = edge.a === key ? edge.b : edge.a;
        if (visited.has(next)) continue;
        walk(next, new Set([...Array.from(visited), next]), [...path, edge], reversed || (!!edge.panel && key !== edge.a));
      }
    };
    walk(start, new Set([start]), []);
    if (tooComplex) { reject('PV topology is too complex for independent-string analysis.', true); continue; }
    if (!paths.length || invalidPolarity) { reject('PV circuit is incomplete or a panel polarity is reversed.'); continue; }
    const covered = new Set(paths.flat());
    if (paths.some(path => !path.some(edge => edge.panel)) || circuitWires.some(edge => !covered.has(edge))) {
      reject('PV circuit contains a shorted or disconnected array branch.'); continue;
    }
    const panelUse = new Set<string>();
    let error: PVWireValue | undefined;
    const strings = paths.map(path => {
      const panels = path.filter(edge => edge.panel).map(edge => edge.panel!);
      let voltage = 0, current = 0, sizing = 0, voc = 0;
      const assumptions: string[] = [];
      for (const panel of panels) {
        if (panelUse.has(panel.id)) error = unknown('PV strings share panels; cross-connected arrays require review.', true);
        panelUse.add(panel.id);
        const value = panelOperatingValue(panel);
        if (value.status !== 'known') { error = value; continue; }
        if (current && Math.abs(current - value.currentA!) > Math.max(current, value.currentA!) * .01)
          error = unknown('Series panels have mismatched operating currents; use matched panels or separate MPPT inputs.', true);
        current = value.currentA!;
        voltage += value.voltageV!;
        const p = panel.properties ?? {};
        sizing = Math.max(sizing, (p.isc ?? current) * 1.25 * 1.25);
        if (!valid(p.isc)) assumptions.push('Isc not supplied: provisional conductor estimate uses 1.5625 × Imp; confirm with the panel datasheet Isc.');
        if (valid(p.voc)) voc += p.voc; else voc = NaN;
      }
      return { path, voltage, current, sizing, voc, assumptions };
    });
    if (strings.some(s => Math.abs(s.voltage - strings[0].voltage) > strings[0].voltage * .01))
      error = unknown('Parallel PV strings have mismatched Vmp voltages; use matching strings or separate MPPT inputs.', true);
    if (error) { for (const edge of circuitWires) result.set(edge.wire!.id, error); continue; }
    const issues: string[] = [], assumptions = Array.from(new Set(strings.flatMap(s => s.assumptions)));
    assumptions.push('Series panel voltages add; parallel string currents add. PV voltage is independent of battery voltage.',
      'PV conductor sizing uses 1.25 × 1.25 × Isc when provided; voltage-drop checks conservatively use the sizing current and string Vmp.');
    const maxVoltage = controller.properties?.maxPVVoltage;
    if (valid(maxVoltage) && strings.some(s => (Number.isFinite(s.voc) ? s.voc : s.voltage) >= maxVoltage))
      issues.push('PV array voltage reaches or exceeds the MPPT maximum PV input voltage.');
    if (strings.some(s => !Number.isFinite(s.voc))) assumptions.push('Voc not supplied: MPPT open-circuit voltage compatibility is not verified.');
    else assumptions.push('Voc is the declared panel rating; cold-weather voltage rise requires a separate check.');
    if (!valid(maxVoltage)) assumptions.push('MPPT maximum PV input voltage is not supplied; controller voltage compatibility is not verified.');
    for (const edge of circuitWires) {
      const flowing = strings.filter(s => s.path.includes(edge));
      result.set(edge.wire!.id, { status: 'known', currentA: flowing.reduce((sum, s) => sum + s.current, 0),
        voltageV: strings[0].voltage, sizingCurrentA: flowing.reduce((sum, s) => sum + s.sizing, 0),
        source: 'terminal-aware PV series/parallel string demand', assumptions, issues });
    }
  }
  return result;
}
