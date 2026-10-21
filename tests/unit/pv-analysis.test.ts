import { describe, expect, it } from 'vitest';
import { analyzeElectricalDesign, type AnalysisComponent, type AnalysisWire } from '../../shared/electrical-analysis';
import { buildDesignReview } from '../../shared/design-review';

const c = (id: string, type: string, properties: Record<string, any> = {}): AnalysisComponent => ({ id, type, properties });
const panel = (id: string, properties: Record<string, any> = {}) => c(id, 'solar-panel', { watts: 240, voltage: 24, isc: 11, voc: 30, ...properties });
const controller = (id = 'mppt') => c(id, 'mppt', { maxCurrent: 50, maxPVVoltage: 100 });
const w = (id: string, from: string, ft: string, to: string, tt: string): AnalysisWire => ({ id, fromComponentId: from, fromTerminal: ft, toComponentId: to, toTerminal: tt, gauge: '10 AWG', length: 15 });
const leads = (panelId = 'pv', mpptId = 'mppt') => [w(`${panelId}+`, panelId, 'positive', mpptId, 'pv-positive'), w(`${panelId}-`, panelId, 'negative', mpptId, 'pv-negative')];
const analyze = (components: AnalysisComponent[], wires: AnalysisWire[], systemVoltage = 12) => analyzeElectricalDesign({ components, wires, systemVoltage });

describe('PV circuit analysis', () => {
  it('sizes both single-panel leads at Vmp and Isc, separately from MPPT DC output', () => {
    const result = analyze([panel('pv'), controller(), c('battery', 'battery')], [...leads(), w('charge', 'mppt', 'batt-positive', 'battery', 'positive')]);
    for (const id of ['pv+', 'pv-']) {
      expect(result.wires[id]).toMatchObject({ status: 'known', currentA: 10, voltageV: 24, sizingCurrentA: 17.1875, scenario: 'charge' });
      expect(result.wires[id].calculation?.current).toBe(17.1875);
      expect(result.wires[id].issues).toEqual([]);
    }
    expect(result.wires.charge.currentA).toBe(50);
    expect(result.wires.charge.voltageV).toBe(12);
    expect(result.components.pv).toMatchObject({ status: 'known', currentA: 10, voltageV: 24 });
  });
  it('resolves reversed wire drawing directions and never substitutes battery voltage', () => {
    const wires = leads().map(wire => ({ ...wire, fromComponentId: wire.toComponentId, toComponentId: wire.fromComponentId,
      fromTerminal: wire.toTerminal, toTerminal: wire.fromTerminal }));
    for (const voltage of [12, 24, 48]) {
      const result = analyze([panel('pv'), controller()], wires, voltage);
      expect(result.wires['pv+']).toMatchObject({ status: 'known', currentA: 10, voltageV: 24 });
    }
  });
  it('supports existing watts/Vmp designs with explicitly provisional sizing assumptions', () => {
    const result = analyze([panel('pv', { isc: undefined, voc: undefined }), controller()], leads());
    expect(result.wires['pv+']).toMatchObject({ status: 'known', currentA: 10, sizingCurrentA: 15.625 });
    expect(result.wires['pv+'].assumptions.join(' ')).toContain('provisional');
    expect(result.wires['pv+'].assumptions.join(' ')).toContain('open-circuit voltage compatibility is not verified');
  });
  it('adds voltages across series panels without adding their currents', () => {
    const wires = [w('positive', 'a', 'positive', 'mppt', 'pv-positive'), w('series', 'a', 'negative', 'b', 'positive'), w('negative', 'b', 'negative', 'mppt', 'pv-negative')];
    const result = analyze([panel('a'), panel('b'), controller()], wires);
    for (const wire of wires) expect(result.wires[wire.id]).toMatchObject({ status: 'known', currentA: 10, voltageV: 48, sizingCurrentA: 17.1875 });
  });
  it('supports parallel panels directly on the MPPT without counting their output rating', () => {
    const result = analyze([panel('a'), panel('b'), controller()], [...leads('a'), ...leads('b')]);
    for (const id of ['a+', 'a-', 'b+', 'b-']) expect(result.wires[id]).toMatchObject({ status: 'known', currentA: 10, voltageV: 24 });
  });
  it('sums parallel strings on combiner feeds and traces a PV fuse', () => {
    const components = [panel('a'), panel('b'), c('pos', 'busbar-positive'), c('neg', 'busbar-negative'), c('fuse', 'fuse'), controller()];
    const wires = [w('a+', 'a', 'positive', 'pos', 'pos-1'), w('b+', 'b', 'positive', 'pos', 'pos-2'),
      w('a-', 'a', 'negative', 'neg', 'neg-1'), w('b-', 'b', 'negative', 'neg', 'neg-2'),
      w('feed+', 'pos', 'pos-3', 'fuse', 'in'), w('fuse', 'fuse', 'out', 'mppt', 'pv-positive'), w('feed-', 'neg', 'neg-3', 'mppt', 'pv-negative')];
    const result = analyze(components, wires);
    for (const id of ['feed+', 'feed-', 'fuse']) expect(result.wires[id]).toMatchObject({ status: 'known', currentA: 20, sizingCurrentA: 34.375, voltageV: 24 });
    for (const id of ['a+', 'b+', 'a-', 'b-']) expect(result.wires[id].currentA).toBe(10);
  });
  it('reports MPPT overvoltage using series Voc rather than Vmp', () => {
    const wires = [w('positive', 'a', 'positive', 'mppt', 'pv-positive'), w('series', 'a', 'negative', 'b', 'positive'), w('negative', 'b', 'negative', 'mppt', 'pv-negative')];
    const result = analyze([panel('a', { voc: 55 }), panel('b', { voc: 55 }), controller()], wires);
    expect(result.wires.positive.issues).toContain('PV array voltage reaches or exceeds the MPPT maximum PV input voltage.');
  });
  it.each([{ watts: 0 }, { voltage: 0 }, { voltage: undefined }, { isc: 2 }, { voc: 10 }, { watts: Infinity }])('requires valid panel ratings: %j', (properties) => {
    const result = analyze([panel('pv', properties), controller()], leads());
    expect(result.wires['pv+'].status).toBe('unknown');
    expect(result.wires['pv+'].currentA).toBeUndefined();
    expect(result.wires['pv+'].calculation).toBeUndefined();
  });
  it('accepts explicit Vmp and Imp ratings', () => {
    expect(analyze([panel('pv', { watts: undefined, vmp: 24, imp: 10 }), controller()], leads()).wires['pv+'].currentA).toBe(10);
  });
  it('leaves a missing return or disconnected controller unresolved', () => {
    expect(analyze([panel('pv'), controller()], leads().slice(0, 1)).wires['pv+'].status).toBe('unknown');
    expect(analyze([panel('pv')], leads()).wires['pv+'].status).toBe('unknown');
  });
  it('rejects reversed panel polarity and shorted panel bypasses', () => {
    const reversed = [w('p', 'pv', 'negative', 'mppt', 'pv-positive'), w('n', 'pv', 'positive', 'mppt', 'pv-negative')];
    expect(analyze([panel('pv'), controller()], reversed).wires.p.status).toBe('unknown');
    const shorted = analyze([panel('pv'), controller()], [...leads(), w('short', 'pv', 'positive', 'pv', 'negative')]);
    expect(shorted.wires['pv+'].status).toBe('unknown');
  });
  it('rejects parallel conductors, mismatched series currents and mismatched parallel voltages', () => {
    expect(analyze([panel('pv'), controller()], [...leads(), w('duplicate', 'pv', 'positive', 'mppt', 'pv-positive')]).wires['pv+'].status).toBe('unsupported');
    const series = [w('p', 'a', 'positive', 'mppt', 'pv-positive'), w('s', 'a', 'negative', 'b', 'positive'), w('n', 'b', 'negative', 'mppt', 'pv-negative')];
    expect(analyze([panel('a'), panel('b', { watts: 120 }), controller()], series).wires.p.status).toBe('unsupported');
    expect(analyze([panel('a'), panel('b', { voltage: 20 }), controller()], [...leads('a'), ...leads('b')]).wires['a+'].status).toBe('unsupported');
  });
  it('rejects an array connected to multiple controllers or battery-side terminals', () => {
    const result = analyze([panel('pv'), controller(), controller('other')], [...leads(), ...leads('pv', 'other').map(wire => ({ ...wire, id: `other${wire.id}` }))]);
    expect(result.wires['pv+'].status).toBe('unsupported');
    const batterySide = leads().map(wire => ({ ...wire, toTerminal: wire.toTerminal?.replace('pv-', 'batt-') }));
    expect(analyze([panel('pv'), controller()], batterySide).wires['pv+'].status).toBe('unknown');
  });
  it('checks the chosen gauge against PV sizing current and retains material and length checks', () => {
    const undersized = leads().map(wire => ({ ...wire, gauge: '18 AWG', length: 1 }));
    const result = analyze([panel('pv', { isc: 15 }), controller()], undersized);
    expect(result.wires['pv+'].issues).toContain('Selected conductor exceeds derated ampacity.');
    expect(analyze([panel('pv'), controller()], leads().map(wire => ({ ...wire, length: 0 }))).wires['pv+'].issues).toContain('Set a positive physical wire length to calculate conductor size.');
    expect(analyze([panel('pv'), controller()], leads().map(wire => ({ ...wire, conductorMaterial: 'aluminum' as const }))).wires['pv+'].status).toBe('unsupported');
  });
  it('removes generic PV unresolved warnings from design review for a complete circuit', () => {
    const input = { components: [panel('pv'), controller()], wires: leads(), systemVoltage: 12 };
    const review = buildDesignReview(input as any, { valid: true, score: 100, issues: [] } as any);
    expect(review.issues.filter(issue => issue.category === 'unresolved')).toEqual([]);
  });
});
