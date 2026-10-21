import type { SchematicComponent, Wire } from '@shared/schema';
import { getComponentDimensions, getComponentTerminals } from './terminal-config';
import { buildSchematicRoutes } from './schematic-routing';
import { wireGaugeAreaMm2 } from './wire-calculator';
import { calculateRoute, type WireRoutingOptions } from './wire-routing';

export function componentDepth(type: string) {
  if (type === 'cerbo') return 16;
  if (type === 'multiplus') return 64;
  if (type === 'quattro') return 82;
  if (type.startsWith('busbar') || type === 'fuse' || type === 'solar-panel') return 12;
  if (['battery', 'inverter'].includes(type)) return 48;
  return 28;
}

/** Visual radius follows conductor area; added jacket thickness keeps fine wires readable. */
export function cableRadius(gauge: string | undefined) {
  return 0.6 + Math.sqrt((wireGaugeAreaMm2(gauge) ?? 5.26) / Math.PI) * 0.65;
}

type Point = { x: number; y: number };
function pointSegmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
export function cableRoutesConflict(a: Point[], b: Point[], clearance: number) {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    if (segmentDistance(a[i - 1], a[i], b[j - 1], b[j]) < clearance) return true;
  }
  return false;
}

export function build3DLayout(components: SchematicComponent[], wires: Wire[], options: WireRoutingOptions) {
  const parts = components.map(component => {
    const dimensions = getComponentDimensions(component.type, component.properties);
    // Family silhouettes are illustrative, while IDs and the 2D layout stay intact.
    const heightScale = component.type === 'cerbo' ? 0.65 : component.type === 'multiplus' ? 1.55 : component.type === 'quattro' ? 1.5 : 1;
    return { component, width: dimensions.width, height: dimensions.height * heightScale,
      depth: componentDepth(component.type),
      terminals: getComponentTerminals(component.type, component.properties).map(terminal => ({ ...terminal, y: terminal.y * heightScale })),
    };
  });
  const byId = new Map(parts.map(part => [part.component.id, part]));
  const minX = Math.min(0, ...parts.map(p => p.component.x - 60));
  const minY = Math.min(0, ...parts.map(p => p.component.y - 60));
  const maxX = Math.max(400, ...parts.map(p => p.component.x + p.width + 60));
  const maxY = Math.max(300, ...parts.map(p => p.component.y + p.height + 60));
  const assigned: Array<{ points: Point[]; level: number; radius: number }> = [];
  const step = Math.max(8, ...wires.map(w => cableRadius(w.gauge) * 2 + 5));
  const baseHeight = Math.max(...parts.map(p => p.depth), 30) + 18;
  const paths = buildSchematicRoutes(parts, wires, options).map(({wire, pathPoints: points}) => {
    const from = byId.get(wire.fromComponentId)!, to = byId.get(wire.toComponentId)!;
    const start = points[0], end = points[points.length - 1];
    const radius = cableRadius(wire.gauge);
    let level = 0;
    while (assigned.some(other => other.level === level && cableRoutesConflict(points, other.points, radius + other.radius + 4))) level++;
    assigned.push({ points, level, radius });
    const height = baseHeight + level * step;
    // Fan out from the actual terminals instead of stacking vertical risers.
    // A direct wire still needs an elevated span to separate crossings.
    const interior = points.length > 2 ? points.slice(1, -1) : [0.15, 0.85].map(t => ({
      x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t,
    }));
    return { wire, radius, level, points: [
      { ...start, z: from.depth + 5 }, ...interior.map(p => ({ ...p, z: height })),
      { ...end, z: to.depth + 5 },
    ] };
  });
  return { parts, paths, bounds: { minX, minY, maxX, maxY }, omittedWires: wires.length - paths.length };
}
