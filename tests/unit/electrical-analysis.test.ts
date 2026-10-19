import { describe, expect, it } from 'vitest';
import { analyzeElectricalDesign, electricalFingerprint, type AnalysisComponent, type AnalysisWire } from '../../shared/electrical-analysis';
import { calculateWireSize, calculateInverterDCInput, evaluateWireGauge } from '../../server/wire-calculator';
import { calculateWireSize as browserSize, displayLengthToFeet, feetToDisplayLength } from '../../client/src/lib/wire-calculator';

const c = (id: string, type: string, properties: Record<string, any> = {}): AnalysisComponent => ({ id, type, properties });
const w = (id: string, from: string, to: string, fromTerminal = 'positive', toTerminal = 'positive'): AnalysisWire => ({ id, fromComponentId: from, toComponentId: to, fromTerminal, toTerminal, gauge: '18 AWG', length: 10 });
const analyze = (components: AnalysisComponent[], wires: AnalysisWire[], voltage = 12) => analyzeElectricalDesign({ components, wires, systemVoltage: voltage });

describe('Shared electrical analysis', () => {
  it('uses precisely the same sizing implementation in the browser and server', () => {
    expect(browserSize).toBe(calculateWireSize);
    for (const current of [0, 5, 40, 100, 450]) for (const currentGauge of [undefined, '10 AWG', '4/0 AWG']) {
      const params = { current, voltage: 12, length: 10, currentGauge };
      expect(browserSize(params)).toEqual(calculateWireSize(params));
    }
  });
  it('preserves physical length without rounding through meter conversion', () => {
    expect(displayLengthToFeet(feetToDisplayLength(12.123456, 'm'), 'm')).toBeCloseTo(12.123456, 12);
  });
  it('resolves a branch in either drawing direction without changing the selected gauge', () => {
    const components = [c('battery', 'battery'), c('load', 'dc-load', { watts: 120 })];
    const wire = w('wire', 'battery', 'load');
    const normal = analyze(components, [wire]).wires.wire;
    const reverse = analyze(components, [{ ...wire, fromComponentId: 'load', toComponentId: 'battery' }]).wires.wire;
    expect(normal.currentA).toBe(10); expect(reverse.currentA).toBe(10);
    expect(normal.selectedGauge).toBe('18 AWG');
    expect(normal.selectedGaugeVoltageDropPercent).toBeCloseTo(10.6416666667, 6);
    expect(normal.issues).toContain('Selected conductor exceeds the configured voltage drop limit.');
    expect(wire.gauge).toBe('18 AWG');
  });
  it('sums nested DC branches once', () => {
    const components = [c('battery', 'battery'), c('bus', 'busbar-positive'), c('panel', 'dc-panel'), c('a', 'dc-load', { watts: 60 }), c('b', 'dc-load', { amps: 3 })];
    const wires = [w('main', 'battery', 'bus', 'positive', 'pos-1'), w('panel', 'bus', 'panel', 'pos-2', 'main-in-pos'), w('a', 'panel', 'a', 'load-1-pos'), w('b', 'panel', 'b', 'load-2-pos')];
    const values = analyze(components, wires).wires;
    expect(values.main.currentA).toBe(8); expect(values.panel.currentA).toBe(8);
    expect(values.a.currentA).toBe(5); expect(values.b.currentA).toBe(3);
  });
  it('does not cancel charger current against load demand', () => {
    const components = [c('battery', 'battery'), c('bus', 'busbar-positive'), c('load', 'dc-load', { watts: 120 }), c('mppt', 'mppt', { maxCurrent: 50 })];
    const values = analyze(components, [w('main', 'battery', 'bus', 'positive', 'pos-1'), w('load', 'bus', 'load', 'pos-2'), w('charge', 'bus', 'mppt', 'pos-3', 'batt-positive')]).wires;
    expect(values.main.currentA).toBe(50); expect(values.main.scenario).toBe('governing');
    expect(values.charge.currentA).toBe(50); expect(values.load.currentA).toBe(10);
  });
  it.each(['negative', 'battery-minus'])('traces SmartShunt BATT- (%s) through the negative bus to inverter and DC branches', (batteryTerminal) => {
    const components = [c('battery', 'battery'), c('shunt', 'smartshunt'), c('bus', 'busbar-negative'),
      c('inverter', 'inverter'), c('ac', 'ac-load', { watts: 1100, acVoltage: 110 }),
      c('panel', 'dc-panel'), c('dc', 'dc-load', { watts: 40 }), c('mppt', 'mppt', { maxCurrent: 50 })];
    const wires = [w('battery', 'battery', 'shunt', 'negative', batteryTerminal),
      w('shunt', 'shunt', 'bus', 'system-minus', 'neg-1'),
      w('inverter', 'bus', 'inverter', 'neg-3', 'dc-negative'),
      w('ac', 'inverter', 'ac', 'ac-out-hot', 'hot'),
      w('panel', 'bus', 'panel', 'neg-4', 'main-in-neg'),
      w('dc', 'panel', 'dc', 'load-1-neg', 'negative'),
      w('mppt', 'mppt', 'bus', 'batt-negative', 'neg-2')];
    for (const connections of [wires, wires.map(wire => ({ ...wire, fromComponentId: wire.toComponentId,
      toComponentId: wire.fromComponentId, fromTerminal: wire.toTerminal, toTerminal: wire.fromTerminal }))]) {
      const values = analyze(components, connections).wires;
      const inverterCurrent = 1100 / .875 / 12;
      for (const id of ['battery', 'shunt', 'inverter', 'panel', 'dc', 'mppt']) {
        expect(values[id].status).toBe('known');
        expect(values[id].calculation).toBeDefined();
        expect(values[id].voltageV).toBe(12);
      }
      expect(values.inverter.currentA).toBeCloseTo(inverterCurrent);
      expect(values.panel.currentA).toBeCloseTo(40 / 12);
      expect(values.dc.currentA).toBeCloseTo(40 / 12);
      expect(values.mppt.currentA).toBe(50);
      for (const id of ['battery', 'shunt']) {
        expect(values[id].currentA).toBeCloseTo(inverterCurrent + 40 / 12);
        expect(values[id].scenario).toBe('governing');
      }
    }
  });
  it('does not treat SmartShunt data or missing battery connections as a negative source path', () => {
    const components = [c('battery', 'battery'), c('shunt', 'smartshunt'), c('load', 'dc-load', { amps: 3 })];
    const load = w('load', 'shunt', 'load', 'system-minus', 'negative');
    for (const terminal of ['data', 'missing']) {
      const result = analyze(components, [w('battery', 'battery', 'shunt', 'negative', terminal), load]);
      expect(result.wires.load.status).toBe('unknown');
      expect(result.wires.load.calculation).toBeUndefined();
    }
    expect(analyze(components, [load]).wires.load.status).toBe('unknown');
    expect(analyze([c('a', 'smartshunt'), c('b', 'smartshunt')], [w('data', 'a', 'b', 'data', 'data')]).wires.data)
      .toMatchObject({ status: 'unsupported', reason: 'Data cables are not sized as power conductors.' });
  });
  it('still flags multiple battery sources connected through a SmartShunt', () => {
    const components = [c('a', 'battery'), c('b', 'battery'), c('shunt', 'smartshunt'), c('load', 'dc-load', { amps: 3 })];
    const values = analyze(components, [w('a', 'a', 'shunt', 'negative', 'negative'),
      w('b', 'b', 'shunt', 'negative', 'battery-minus'), w('load', 'shunt', 'load', 'system-minus', 'negative')]).wires;
    expect(values.load.status).toBe('unsupported');
    expect(values.load.calculation).toBeUndefined();
  });
  it('keeps AC output demand and inverter DC input in separate voltage domains', () => {
    const components = [c('battery', 'battery'), c('inverter', 'inverter'), c('panel', 'ac-panel'), c('load', 'ac-load', { watts: 1200, acVoltage: 120 })];
    const wires = [w('dc', 'battery', 'inverter', 'positive', 'dc-positive'), w('ac', 'inverter', 'panel', 'ac-out-hot', 'main-in-hot'), w('load', 'panel', 'load', 'load-1-hot', 'hot')];
    const result = analyze(components, wires);
    expect(result.wires.ac.currentA).toBe(10); expect(result.wires.ac.voltageV).toBe(120);
    expect(result.wires.dc.currentA).toBeCloseTo(1200 / .875 / 12);
    expect(result.wires.dc.voltageV).toBe(12);
  });
  it('reports unknown load current and disconnected circuits without substituting zero', () => {
    for (const value of [analyze([c('load', 'dc-load'), c('battery', 'battery')], [w('w', 'battery', 'load')]).wires.w,
      analyze([c('a', 'dc-load', { watts: 12 }), c('b', 'dc-load', { watts: 12 })], [w('w', 'a', 'b')]).wires.w]) {
      expect(value.status).toBe('unknown'); expect(value.currentA).toBeUndefined(); expect(value.calculation).toBeUndefined();
    }
  });
  it('rejects guessing parallel sharing, mixed voltage and unknown terminals', () => {
    const components = [c('battery', 'battery'), c('load', 'dc-load', { watts: 12, voltage: 24 })];
    const cycle = analyze(components, [w('a', 'battery', 'load'), w('b', 'battery', 'load')]);
    expect(cycle.wires.a.status).toBe('unsupported');
    expect(analyze(components, [w('a', 'battery', 'load')]).wires.a.status).toBe('unknown');
    expect(analyze(components, [w('a', 'battery', 'load', 'missing')]).wires.a.currentA).toBeUndefined();
  });
  it('marks custom behavior and multiple banks unsupported, and incomplete PV circuits unknown', () => {
    expect(analyze([c('custom', 'custom')], []).components.custom.status).toBe('unsupported');
    const components = [c('a', 'battery'), c('b', 'battery'), c('bus', 'busbar-positive'), c('load', 'dc-load', { amps: 3 })];
    const result = analyze(components, [w('a', 'a', 'bus', 'positive', 'pos-1'), w('b', 'b', 'bus', 'positive', 'pos-2'), w('load', 'bus', 'load', 'pos-3')]);
    expect(result.wires.a.status).toBe('unsupported');
    expect(analyze([c('solar', 'solar-panel'), c('mppt', 'mppt')], [w('pv', 'solar', 'mppt', 'positive', 'pv-positive')]).wires.pv.status).toBe('unknown');
  });
  it('explicitly rejects aluminum sizing in both compatibility APIs and structured analysis', () => {
    expect(calculateWireSize({ current: 10, voltage: 12, length: 10, conductorMaterial: 'aluminum' })).toMatchObject({ status: 'error' });
    const result = analyzeElectricalDesign({ components: [c('battery', 'battery'), c('load', 'dc-load', { amps: 3 })], wires: [w('w', 'battery', 'load')], systemVoltage: 12 }, { conductorMaterial: 'aluminum' });
    expect(result.wires.w.status).toBe('unsupported'); expect(result.wires.w.calculation).toBeUndefined();
  });
  it('rejects incompatible AC source voltage and respects per-wire material', () => {
    const source = c('source', 'shore-power', { acOutputVoltage: '120' });
    const result = analyze([source, c('load', 'ac-load', { watts: 230, acVoltage: 230 })], [w('ac', 'source', 'load', 'ac-out-hot', 'hot')]);
    expect(result.wires.ac.status).toBe('unknown');
    expect(result.wires.ac.reason).toContain('incompatible');
    const wire = { ...w('dc', 'battery', 'load'), conductorMaterial: 'aluminum' as const };
    const material = analyze([c('battery', 'battery'), c('load', 'dc-load', { amps: 3 })], [wire]);
    expect(material.wires.dc.status).toBe('unsupported');
  });
  it('includes options in deterministic fingerprints independent of object key order', () => {
    expect(electricalFingerprint({ b: 2, a: 1 })).toBe(electricalFingerprint({ a: 1, b: 2 }));
    const input = { components: [], wires: [], systemVoltage: 12 };
    expect(analyzeElectricalDesign(input).fingerprint).not.toBe(analyzeElectricalDesign(input, { temperatureC: 50 }).fingerprint);
  });
  it('evaluates an insufficient selected conductor without silently using the recommendation', () => {
    const selected = evaluateWireGauge('18 AWG', { current: 30, length: 10, voltage: 12 });
    expect(selected?.ampacityA).toBe(20); expect(selected?.voltageDropPercent).toBeCloseTo(31.925);
  });
  it('counts a shared inverter load once across hot and neutral legacy paths', () => {
    const components = [c('inverter', 'inverter'), c('load', 'ac-load', { watts: 1200, acVoltage: 120 })];
    const wires = [w('h', 'inverter', 'load', 'ac-out-hot', 'hot'), w('n', 'inverter', 'load', 'ac-out-neutral', 'neutral')];
    expect(calculateInverterDCInput('inverter', components, wires, 12).acLoadWatts).toBe(1200);
  });
});

describe('Blue Smart Charger circuits', () => {
  const components = [c('battery','battery'),c('bus','busbar-positive'),c('load','dc-load',{watts:120}),
    c('charger','blue-smart-charger',{amps:30,voltage:12}),c('shore','shore-power',{voltage:120})];
  const wires = [w('main','battery','bus','positive','pos-1'),w('load','bus','load','pos-2','positive'),
    w('charge','bus','charger','pos-3','dc-positive'),w('hot','shore','charger','ac-out-hot','ac-in-hot'),
    w('neutral','shore','charger','ac-out-neutral','ac-in-neutral')];
  it('supports DC output without letting missing AC demand invalidate the DC circuit', () => {
    const result = analyze(components,wires);
    expect(result.wires.main.currentA).toBe(30);
    expect(result.wires.main.scenario).toBe('governing');
    expect(result.wires.charge.currentA).toBe(30);
    expect(result.wires.load.currentA).toBe(10);
    for (const id of ['hot','neutral']) {
      expect(result.wires[id].status).toBe('unknown');
      expect(result.wires[id].reason).toContain('rated AC input current');
      expect(result.wires[id].calculation).toBeUndefined();
    }
  });
  it('uses declared AC input amps on hot and neutral and preserves DC charge amps', () => {
    const rated = components.map(c=>c.id==='charger'?{...c,properties:{...c.properties,acInputAmps:4,acVoltage:120}}:c);
    const result = analyze(rated,wires);
    expect(result.wires.hot.currentA).toBe(4);
    expect(result.wires.neutral.currentA).toBe(4);
    expect(result.wires.hot.voltageV).toBe(120);
    expect(result.wires.charge.currentA).toBe(30);
    expect(result.wires.main.currentA).toBe(30);
  });
});
