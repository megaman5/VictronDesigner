import { describe, it, expect } from 'vitest';
import { calculateRoute, DEFAULT_WIRE_ROUTING_OPTIONS, WIRE_ROUTING_STYLES } from '@/lib/wire-routing';
import { getComponentTerminals } from '@/lib/terminal-config';
import { constrainDragDelta } from '@/lib/canvas-placement';

describe('feedback terminal anchoring', () => {
  for (const { value: style } of WIRE_ROUTING_STYLES) {
    for (const rotation of [0, 90, 180, 270]) {
      it(`${style}: exact SmartShunt and mirrored MultiPlus anchors at ${rotation} degrees`, () => {
        const terminal = getComponentTerminals('multiplus', { mirrorX: true, rotation }).find(t => t.id === 'dc-negative')!;
        const start = { x: 431.6, y: 341.6 };
        const end = { x: 969.4 + terminal.x, y: 103 + terminal.y };
        const route = calculateRoute(start.x, start.y, end.x, end.y, [], 2400, 1600,
          new Set(), 'bottom', terminal.orientation, { ...DEFAULT_WIRE_ROUTING_OPTIONS, style }, { start: 20, end: -20 });
        expect(route.pathPoints[0]).toEqual(start);
        expect(route.pathPoints.at(-1)).toEqual(end);
        expect(route.path.startsWith(`M ${start.x} ${start.y}`)).toBe(true);
        expect(route.path.endsWith(`${end.x} ${end.y}`)).toBe(true);
        if (style !== 'straight') {
          expect(route.pathPoints[1].x).toBe(start.x);
          expect(route.pathPoints[1].y).toBeGreaterThan(start.y);
          route.pathPoints.slice(1).forEach((point, i) => {
            const previous = route.pathPoints[i];
            expect(point.x === previous.x || point.y === previous.y).toBe(true);
          });
        }
      });
    }
  }
  it('keeps anchors exact when the grid route falls back outside its bounds', () => {
    const route = calculateRoute(2511.2, 1700.4, 2600.8, 1800.6, [], 100, 100);
    expect(route.pathPoints[0]).toEqual({ x: 2511.2, y: 1700.4 });
    expect(route.pathPoints.at(-1)).toEqual({ x: 2600.8, y: 1800.6 });
  });
  it('separates parallel lanes without separating terminal anchors', () => {
    const routes = [-20, 20].map(offset => calculateRoute(431.6, 341.6, 989.4, 251, [], 2400, 1600,
      new Set(), 'bottom', 'bottom', DEFAULT_WIRE_ROUTING_OPTIONS, { start: offset, end: offset }));
    expect(routes[0].pathPoints[0]).toEqual(routes[1].pathPoints[0]);
    expect(routes[0].pathPoints.at(-1)).toEqual(routes[1].pathPoints.at(-1));
    expect(routes[0].path).not.toEqual(routes[1].path);
  });
});

describe('canvas placement', () => {
  it('stops the reported edge drop at zero', () => {
    expect(constrainDragDelta([{ x: 960, y: 257 }], -1090.667, 0)).toEqual({ x: -960, y: 0 });
  });
  it('bounds a group with one delta, retaining relative positions', () => {
    expect(constrainDragDelta([{ x: 60, y: 80 }, { x: 140, y: 20 }], -200, -200)).toEqual({ x: -60, y: -20 });
  });
  it('preserves ordinary drag deltas', () => {
    expect(constrainDragDelta([{ x: 900, y: 257 }], 20, 0)).toEqual({ x: 20, y: 0 });
  });
});
