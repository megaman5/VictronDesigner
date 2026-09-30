import { describe, it, expect } from 'vitest';
import { build3DLayout } from '@/lib/design-3d';
import { DEFAULT_WIRE_ROUTING_OPTIONS } from '@/lib/wire-routing';
import { getComponentTerminals } from '@/lib/terminal-config';
import type { SchematicComponent, Wire } from '@shared/schema';

const components: SchematicComponent[] = [
  { id: 'a', type: 'smartshunt', name: 'Shunt', x: 361.6, y: 251.6, properties: {} },
  { id: 'b', type: 'multiplus', name: 'MultiPlus', x: 969.4, y: 103, properties: { mirrorX: true, rotation: 90 } },
];
const wire: Wire = { id: 'w', fromComponentId: 'a', toComponentId: 'b', fromTerminal: 'system-minus',
  toTerminal: 'dc-negative', polarity: 'negative', gauge: '2/0 AWG', length: 10 };

describe('3D design projection', () => {
  it('uses exact transformed terminals and does not mutate saved design data', () => {
    const before = JSON.stringify({ components, wire });
    const layout = build3DLayout(components, [wire], DEFAULT_WIRE_ROUTING_OPTIONS);
    const terminal = getComponentTerminals('multiplus', components[1].properties).find(t => t.id === 'dc-negative')!;
    expect(layout.paths[0].points[0]).toMatchObject({ x: 431.6, y: 341.6 });
    expect(layout.paths[0].points.at(-1)).toMatchObject({ x: 969.4 + terminal.x, y: 103 + terminal.y });
    expect(JSON.stringify({ components, wire })).toBe(before);
  });
  it('includes manual bends and projects their relative positions', () => {
    const layout = build3DLayout(components, [{ ...wire, waypoints: [{ x: 300, y: 200 }] }], DEFAULT_WIRE_ROUTING_OPTIONS);
    expect(layout.paths[0].points.some(p => p.x === 661.6 && p.y === 451.6)).toBe(true);
  });
  it('reports invalid connections instead of attaching them to arbitrary parts', () => {
    const layout = build3DLayout(components, [{ ...wire, toTerminal: 'missing' }], DEFAULT_WIRE_ROUTING_OPTIONS);
    expect(layout.paths).toHaveLength(0);
    expect(layout.omittedWires).toBe(1);
  });
  it('fits custom and negative-position components in the scene bounds', () => {
    const layout = build3DLayout([{ id: 'custom', type: 'custom', name: 'Custom', x: -1200, y: -30,
      properties: { width: 420, height: 240, terminals: [] } }], [], DEFAULT_WIRE_ROUTING_OPTIONS);
    expect(layout.bounds.minX).toBeLessThan(-1200);
    expect(layout.bounds.minY).toBeLessThan(-30);
    expect(layout.parts[0].width).toBe(420);
  });
  it('handles empty designs', () => {
    const layout = build3DLayout([], [], DEFAULT_WIRE_ROUTING_OPTIONS);
    expect(layout.parts).toEqual([]);
    expect(layout.paths).toEqual([]);
    expect(layout.bounds.maxX).toBeGreaterThan(layout.bounds.minX);
  });
});
