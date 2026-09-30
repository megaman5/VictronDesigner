import type { SchematicComponent, Wire } from '@shared/schema';
import { getComponentDimensions, getComponentTerminals } from './terminal-config';
import { computeBusbarTerminalOverrides } from './busbar-ordering';
import { wireGaugeAreaMm2 } from './wire-calculator';
import { calculateRoute, type WireRoutingOptions } from './wire-routing';

export function componentDepth(type: string) {
  if (type.startsWith('busbar') || type === 'fuse' || type === 'solar-panel') return 12;
  if (['battery', 'multiplus', 'quattro', 'inverter'].includes(type)) return 48;
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
  const parts = components.map(component => ({
    component, ...getComponentDimensions(component.type, component.properties),
    depth: componentDepth(component.type),
    terminals: getComponentTerminals(component.type, component.properties),
  }));
  const byId = new Map(parts.map(part => [part.component.id, part]));
  const overrides = computeBusbarTerminalOverrides(components, wires);
  const minX = Math.min(0, ...parts.map(p => p.component.x - 60));
  const minY = Math.min(0, ...parts.map(p => p.component.y - 60));
  const maxX = Math.max(400, ...parts.map(p => p.component.x + p.width + 60));
  const maxY = Math.max(300, ...parts.map(p => p.component.y + p.height + 60));
  // Stable ordering makes lane/height assignment independent of array order.
  const orderedWires = [...wires].sort((a, b) => a.id.localeCompare(b.id));
  const usage = new Map<string, string[]>();
  for (const wire of orderedWires) {
    const override = overrides.get(wire.id);
    for (const key of [`${wire.fromComponentId}:${override?.from ?? wire.fromTerminal}`,
      `${wire.toComponentId}:${override?.to ?? wire.toTerminal}`]) {
      usage.set(key, [...(usage.get(key) ?? []), wire.id]);
    }
  }
  const occupied = new Set<string>();
  const obstacles = parts.map(p => ({ x: p.component.x, y: p.component.y, width: p.width, height: p.height }));
  const assigned: Array<{ points: Point[]; level: number; radius: number }> = [];
  const step = Math.max(8, ...wires.map(w => cableRadius(w.gauge) * 2 + 5));
  const baseHeight = Math.max(...parts.map(p => p.depth), 30) + 18;
  const paths = orderedWires.flatMap(wire => {
    const from = byId.get(wire.fromComponentId), to = byId.get(wire.toComponentId);
    if (!from || !to) return [];
    const override = overrides.get(wire.id);
    const a = from.terminals.find(t => t.id === (override?.from ?? wire.fromTerminal));
    const b = to.terminals.find(t => t.id === (override?.to ?? wire.toTerminal));
    // Old/invalid terminal IDs must not invent a physical connection.
    if (!a || !b) return [];
    const start = { x: from.component.x + a.x, y: from.component.y + a.y };
    const end = { x: to.component.x + b.x, y: to.component.y + b.y };
    const offset = (key: string) => {
      const ids = usage.get(key) ?? [wire.id];
      return Math.round(ids.indexOf(wire.id) - (ids.length - 1) / 2) * Math.max(20, options.laneOffset);
    };
    const laneOffsets = { start: offset(`${from.component.id}:${a.id}`), end: offset(`${to.component.id}:${b.id}`) };
    const waypoints = [start, ...(wire.waypoints ?? []).map(p => ({ x: from.component.x + p.x, y: from.component.y + p.y })), end];
    const points = waypoints.slice(1).flatMap((point, index) => {
      const previous = waypoints[index];
      const route = calculateRoute(previous.x, previous.y, point.x, point.y, obstacles, maxX, maxY,
        occupied, index === 0 ? a.orientation : undefined,
        index === waypoints.length - 2 ? b.orientation : undefined, options,
        { start: index === 0 ? laneOffsets.start : 0, end: index === waypoints.length - 2 ? laneOffsets.end : 0 });
      route.pathNodes.forEach(node => occupied.add(node));
      return index === 0 ? route.pathPoints : route.pathPoints.slice(1);
    });
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
    return [{ wire, radius, level, points: [
      { ...start, z: from.depth + 5 }, ...interior.map(p => ({ ...p, z: height })),
      { ...end, z: to.depth + 5 },
    ] }];
  });
  return { parts, paths, bounds: { minX, minY, maxX, maxY }, omittedWires: wires.length - paths.length };
}
