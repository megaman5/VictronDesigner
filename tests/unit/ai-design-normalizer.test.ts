import { describe, it, expect } from 'vitest';
import { normalizeAIDesign } from '../../server/ai-design-normalizer';
import type { SchematicComponent, Wire } from '@shared/schema';

const comp = (
  id: string, type: string, properties: any = {}, x = 100, y = 100
): SchematicComponent => ({ id, type, x, y, name: `${type}-${id}`, properties });

const wire = (
  id: string, fromComponentId: string, fromTerminal: string,
  toComponentId: string, toTerminal: string,
  polarity: string, gauge = '10 AWG', length = 5
): Wire => ({ id, fromComponentId, fromTerminal, toComponentId, toTerminal, polarity, gauge, length } as Wire);

describe('AI design normalizer - terminal repair', () => {
  it('remaps an MPPT load terminal on a model without a LOAD output', () => {
    // The regression: the prompt taught the model about load-positive, and it
    // uses it on a 150|60 which has no LOAD output.
    const components = [comp('m1', 'mppt', { model: '150|60', maxCurrent: 60 }), comp('l1', 'dc-load', { watts: 60, voltage: 12 })];
    const wires = [wire('w1', 'm1', 'load-positive', 'l1', 'positive', 'positive')];

    const r = normalizeAIDesign(components, wires, 12);
    expect(r.wires).toHaveLength(1);
    expect(r.wires[0].fromTerminal).toBe('batt-positive');
    expect(r.repairs.some(x => x.kind === 'terminal-remapped')).toBe(true);
  });

  it('leaves a valid MPPT load terminal alone on a 100|20', () => {
    const components = [comp('m1', 'mppt', { model: '100|20', maxCurrent: 20 }), comp('l1', 'dc-load', { watts: 60, voltage: 12 })];
    const wires = [wire('w1', 'm1', 'load-positive', 'l1', 'positive', 'positive')];

    const r = normalizeAIDesign(components, wires, 12);
    expect(r.wires[0].fromTerminal).toBe('load-positive');
    expect(r.repairs.some(x => x.kind === 'terminal-remapped')).toBe(false);
  });

  it('remaps an invented bus bar terminal to a real slot', () => {
    const components = [comp('b1', 'busbar-positive'), comp('f1', 'fuse', { fuseRating: 100 })];
    const wires = [wire('w1', 'f1', 'out', 'b1', 'main', 'positive')];

    const r = normalizeAIDesign(components, wires, 12);
    expect(r.wires[0].toTerminal).toMatch(/^pos-\d$/);
  });

  it('spreads several invented bus bar terminals across free slots', () => {
    const components = [
      comp('b1', 'busbar-positive'),
      comp('f1', 'fuse', { fuseRating: 100 }),
      comp('f2', 'fuse', { fuseRating: 100 }),
      comp('f3', 'fuse', { fuseRating: 100 }),
    ];
    const wires = [
      wire('w1', 'f1', 'out', 'b1', 'main', 'positive'),
      wire('w2', 'f2', 'out', 'b1', 'main', 'positive'),
      wire('w3', 'f3', 'out', 'b1', 'main', 'positive'),
    ];

    const r = normalizeAIDesign(components, wires, 12);
    const slots = r.wires.map(w => w.toTerminal);
    expect(new Set(slots).size).toBe(3); // no doubling up while slots remain
  });

  it('remaps an invented AC load terminal', () => {
    const components = [comp('i1', 'multiplus', { watts: 3000, acOutputVoltage: '120' }), comp('l1', 'ac-load', { watts: 600, acVoltage: 120 })];
    const wires = [wire('w1', 'i1', 'ac-out-hot', 'l1', 'line', 'hot', '12 AWG', 10)];

    const r = normalizeAIDesign(components, wires, 12);
    // ac-load's line terminal is literally named "hot"
    expect(r.wires[0].toTerminal).toBe('hot');
  });

  it('drops a wire when no compatible terminal exists', () => {
    // A solar panel has no ground terminal, so a ground wire cannot be placed.
    const components = [comp('s1', 'solar-panel', { watts: 300, voltage: 18 }), comp('m1', 'mppt', { model: '150|60' })];
    const wires = [wire('w1', 's1', 'earth', 'm1', 'chassis', 'ground')];

    const r = normalizeAIDesign(components, wires, 12);
    expect(r.wires).toHaveLength(0);
    expect(r.repairs.some(x => x.kind === 'wire-dropped')).toBe(true);
  });

  it('does not touch a fully valid design', () => {
    const components = [comp('b1', 'battery', { voltage: 12, capacity: 200 }), comp('f1', 'fuse', { fuseRating: 100 })];
    const wires = [wire('w1', 'b1', 'positive', 'f1', 'in', 'positive', '2 AWG', 2)];

    const r = normalizeAIDesign(components, wires, 12);
    expect(r.repairs.filter(x => x.kind !== 'gauge-resized')).toHaveLength(0);
    expect(r.wires[0].fromTerminal).toBe('positive');
  });

  it('does not mutate the caller\'s arrays', () => {
    const components = [comp('b1', 'busbar-positive'), comp('f1', 'fuse', { fuseRating: 100 })];
    const wires = [wire('w1', 'f1', 'out', 'b1', 'main', 'positive')];

    normalizeAIDesign(components, wires, 12);
    expect(wires[0].toTerminal).toBe('main');
  });
});

describe('AI design normalizer - wire sizing', () => {
  it('upsizes a wire the model undersized', () => {
    const components = [
      comp('b1', 'battery', { voltage: 12, capacity: 400, batteryType: 'LiFePO4' }),
      comp('l1', 'dc-load', { watts: 1200, voltage: 12 }),
    ];
    // 1200W / 12V = 100A on 14 AWG is badly undersized
    const wires = [
      wire('w1', 'b1', 'positive', 'l1', 'positive', 'positive', '14 AWG', 10),
      wire('w2', 'b1', 'negative', 'l1', 'negative', 'negative', '14 AWG', 10),
    ];

    const r = normalizeAIDesign(components, wires, 12);
    expect(r.repairs.some(x => x.kind === 'gauge-resized')).toBe(true);
    expect(r.wires[0].gauge).not.toBe('14 AWG');
  });

  it('never downsizes a wire the model oversized', () => {
    const components = [
      comp('b1', 'battery', { voltage: 12, capacity: 400 }),
      comp('l1', 'dc-load', { watts: 60, voltage: 12 }),
    ];
    const wires = [wire('w1', 'b1', 'positive', 'l1', 'positive', 'positive', '2/0 AWG', 5)];

    const r = normalizeAIDesign(components, wires, 12);
    expect(r.wires[0].gauge).toBe('2/0 AWG');
  });

  it('sizes a 240V AC wire at 240V, not 120V', () => {
    // 3600W is 30A at 120V but only 15A at 240V. Over a 50ft run the 120V
    // version breaches the 3% drop limit on 14 AWG and the 240V one does not,
    // so a normalizer that assumed 120V would over-size the 240V circuit.
    const at = (acVoltage: number) => {
      const components = [
        comp('i1', 'quattro', { watts: 5000, acOutputVoltage: 'split-120-240' }),
        comp('l1', 'ac-load', { watts: 3600, acVoltage }),
      ];
      const wires = [wire('w1', 'i1', 'ac-out-hot', 'l1', 'hot', 'hot', '14 AWG', 50)];
      return normalizeAIDesign(components, wires, 48).wires[0].gauge;
    };

    expect(at(240)).toBe('14 AWG');       // adequate at 240V, left alone
    expect(at(120)).not.toBe('14 AWG');   // upsized at 120V
  });
});

describe('AI design normalizer - battery side vs system side', () => {
  it('sends a wire from the battery to the BMS battery side', () => {
    const components = [
      comp('b1', 'battery', { voltage: 24, capacity: 600, batteryType: 'LiFePO4' }),
      comp('bms', 'lynx-smart-bms', { amps: 500 }),
    ];
    const wires = [wire('w1', 'b1', 'positive', 'bms', 'dc-positive', 'positive', '4/0 AWG', 2)];

    const r = normalizeAIDesign(components, wires, 24);
    expect(r.wires[0].toTerminal).toBe('batt-positive');
  });

  it('sends a wire from distribution to the BMS system side', () => {
    const components = [
      comp('bus', 'busbar-positive'),
      comp('bms', 'lynx-smart-bms', { amps: 500 }),
    ];
    const wires = [wire('w1', 'bms', 'dc-positive', 'bus', 'pos-1', 'positive', '4/0 AWG', 2)];

    const r = normalizeAIDesign(components, wires, 24);
    expect(r.wires[0].fromTerminal).toBe('system-positive');
  });

  it('does not swap the battery and system sides of a Lynx Shunt', () => {
    const components = [
      comp('b1', 'battery', { voltage: 24, capacity: 600 }),
      comp('sh', 'lynx-shunt', {}),
      comp('bus', 'busbar-positive'),
    ];
    const wires = [
      wire('w1', 'b1', 'positive', 'sh', 'dc-positive', 'positive', '4/0 AWG', 2),
      wire('w2', 'sh', 'dc-positive', 'bus', 'pos-1', 'positive', '4/0 AWG', 2),
    ];

    const r = normalizeAIDesign(components, wires, 24);
    expect(r.wires[0].toTerminal).toBe('batt-positive');
    expect(r.wires[1].fromTerminal).toBe('bus-out-positive');
  });

  it('still spreads interchangeable bus bar slots', () => {
    const components = [
      comp('bus', 'busbar-negative'),
      comp('l1', 'dc-load', { watts: 60, voltage: 12 }),
      comp('l2', 'dc-load', { watts: 60, voltage: 12 }),
    ];
    const wires = [
      wire('w1', 'l1', 'negative', 'bus', 'common', 'negative'),
      wire('w2', 'l2', 'negative', 'bus', 'common', 'negative'),
    ];

    const r = normalizeAIDesign(components, wires, 12);
    expect(r.wires[0].toTerminal).not.toBe(r.wires[1].toTerminal);
  });
});

describe('orientation normalization', () => {
  const comp = (properties: any) =>
    ({ id: 'c1', type: 'battery', name: 'Battery', x: 200, y: 200, properties }) as any;

  it('keeps a valid quarter turn untouched', () => {
    const out = normalizeAIDesign([comp({ rotation: 90 })], [], 12);
    expect(out.components[0].properties.rotation).toBe(90);
    expect(out.repairs.filter(r => r.kind === 'orientation')).toHaveLength(0);
  });

  it('snaps an off-grid angle to the nearest quarter turn', () => {
    // Terminal positions derive from rotation, so 45 would put terminals
    // somewhere the orthogonal router cannot reach.
    const out = normalizeAIDesign([comp({ rotation: 45 })], [], 12);
    expect([0, 90]).toContain(out.components[0].properties.rotation);
    expect(out.repairs.some(r => r.kind === 'orientation')).toBe(true);
  });

  it('wraps angles past a full turn', () => {
    expect(normalizeAIDesign([comp({ rotation: 450 })], [], 12).components[0].properties.rotation).toBe(90);
    expect(normalizeAIDesign([comp({ rotation: -90 })], [], 12).components[0].properties.rotation).toBe(270);
  });

  it('drops a non-numeric rotation rather than passing it through', () => {
    const out = normalizeAIDesign([comp({ rotation: 'sideways' })], [], 12);
    expect(out.components[0].properties.rotation).toBe(0);
    expect(out.repairs.some(r => r.kind === 'orientation')).toBe(true);
  });

  it('leaves components with no rotation alone', () => {
    const out = normalizeAIDesign([comp({ voltage: 12 })], [], 12);
    expect(out.components[0].properties.rotation).toBeUndefined();
    expect(out.repairs.filter(r => r.kind === 'orientation')).toHaveLength(0);
  });
});
