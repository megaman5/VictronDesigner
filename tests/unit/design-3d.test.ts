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

import { cableRadius, cableRoutesConflict } from '@/lib/design-3d';
import { wireDisplayLabel, componentLoadLabel } from '@/lib/design-display';

describe('3D cable clearance and size', () => {
  it('scales cable thickness by actual gauge rather than one fixed radius', () => {
    const radii = ['18 AWG', '10 AWG', '2 AWG', '2/0 AWG', '4/0 AWG'].map(cableRadius);
    radii.slice(1).forEach((radius, i) => expect(radius).toBeGreaterThan(radii[i]));
    expect(cableRadius('2\\0 AWG')).toBe(cableRadius('2/0 AWG'));
    expect(cableRadius(undefined)).toBeGreaterThan(0);
  });
  it('detects overlapping, close parallel and crossing segments', () => {
    const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(cableRoutesConflict(line, [{ x: 20, y: 0 }, { x: 80, y: 0 }], 5)).toBe(true);
    expect(cableRoutesConflict(line, [{ x: 0, y: 4 }, { x: 100, y: 4 }], 5)).toBe(true);
    expect(cableRoutesConflict(line, [{ x: 50, y: -50 }, { x: 50, y: 50 }], 5)).toBe(true);
    expect(cableRoutesConflict(line, [{ x: 0, y: 20 }, { x: 100, y: 20 }], 5)).toBe(false);
  });
  it('gives crossing cables enough vertical clearance for their radii, deterministically', () => {
    const parts = [[0, 0], [400, 400], [0, 400], [400, 0]].map(([x, y], i) => ({
      id: `${i}`, name: `${i}`, type: 'custom', x, y,
      properties: { width: 40, height: 40, terminals: [{ id: 't', type: 'positive', x: 20, y: 20, orientation: 'right' }] },
    }));
    const cables = [
      { ...wire, id: 'one', fromComponentId: '0', toComponentId: '1', fromTerminal: 't', toTerminal: 't', gauge: '4/0 AWG' },
      { ...wire, id: 'two', fromComponentId: '2', toComponentId: '3', fromTerminal: 't', toTerminal: 't', gauge: '18 AWG' },
    ];
    const options = { ...DEFAULT_WIRE_ROUTING_OPTIONS, style: 'straight' as const };
    const layout = build3DLayout(parts, cables, options);
    const [a, b] = layout.paths;
    expect(Math.abs(a.points[1].z - b.points[1].z)).toBeGreaterThan(a.radius + b.radius + 4);
    expect(build3DLayout(parts, [...cables].reverse(), options).paths).toEqual(layout.paths);
    expect(a.points[0]).toMatchObject({ x: 20, y: 20 });
    expect(a.points.at(-1)).toMatchObject({ x: 420, y: 420 });
  });
  it('fans shared terminals into separate elevated routes without moving anchors', () => {
    const layout = build3DLayout(components, [wire, { ...wire, id: 'second' }], DEFAULT_WIRE_ROUTING_OPTIONS);
    expect(layout.paths[0].points[0]).toEqual(layout.paths[1].points[0]);
    expect(layout.paths[0].points.at(-1)).toEqual(layout.paths[1].points.at(-1));
    expect(layout.paths[0].level).not.toBe(layout.paths[1].level);
    expect(layout.paths[0].points).not.toEqual(layout.paths[1].points);
  });
});

describe('3D labels follow existing display settings', () => {
  const sample = { ...wire, gauge: '10 AWG', length: 10 };
  it('formats gauge and length without changing stored wire data', () => {
    expect(wireDisplayLabel(sample, 'standard', 'awg', 'ft')).toBe('− 10 AWG · 10.0ft');
    expect(wireDisplayLabel(sample, 'standard', 'metric', 'm')).toBe('− 5.26 mm² · 3.0m');
    expect(sample.gauge).toBe('10 AWG');
    expect(sample.length).toBe(10);
  });
  it('uses calculated current including legitimate zero, and marks unavailable values', () => {
    expect(wireDisplayLabel(sample, 'load', 'awg', 'ft', { current: 12.34 })).toBe('12.3A');
    expect(wireDisplayLabel(sample, 'load', 'awg', 'ft', { current: 0 })).toBe('0.0A');
    expect(wireDisplayLabel(sample, 'load', 'awg', 'ft')).toBe('— A');
  });
  it('shares component load labels with the 2D editor', () => {
    expect(componentLoadLabel('battery', { capacity: 300 })).toBe('300Ah');
    expect(componentLoadLabel('dc-load', { watts: 120 })).toBe('120W');
    expect(componentLoadLabel('mppt', { maxCurrent: 50 })).toBe('50A');
    expect(componentLoadLabel('busbar-positive', {})).toBeNull();
  });
});
