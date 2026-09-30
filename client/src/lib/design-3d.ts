import type { SchematicComponent, Wire } from '@shared/schema';
import { getComponentDimensions, getComponentTerminals } from './terminal-config';
import { computeBusbarTerminalOverrides } from './busbar-ordering';
import { calculateRoute, type WireRoutingOptions } from './wire-routing';

export function componentDepth(type: string) {
  if (type.startsWith('busbar') || type === 'fuse' || type === 'solar-panel') return 12;
  if (['battery', 'multiplus', 'quattro', 'inverter'].includes(type)) return 48;
  return 28;
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
  const paths = wires.flatMap(wire => {
    const from = byId.get(wire.fromComponentId), to = byId.get(wire.toComponentId);
    if (!from || !to) return [];
    const override = overrides.get(wire.id);
    const a = from.terminals.find(t => t.id === (override?.from ?? wire.fromTerminal));
    const b = to.terminals.find(t => t.id === (override?.to ?? wire.toTerminal));
    // Old/invalid terminal IDs must not invent a physical connection.
    if (!a || !b) return [];
    const start = { x: from.component.x + a.x, y: from.component.y + a.y };
    const end = { x: to.component.x + b.x, y: to.component.y + b.y };
    const waypoints = [start, ...(wire.waypoints ?? []).map(p => ({ x: from.component.x + p.x, y: from.component.y + p.y })), end];
    const points = waypoints.slice(1).flatMap((point, index) => {
      const previous = waypoints[index];
      const route = calculateRoute(previous.x, previous.y, point.x, point.y, [], maxX, maxY,
        new Set(), index === 0 ? a.orientation : undefined,
        index === waypoints.length - 2 ? b.orientation : undefined, options);
      return index === 0 ? route.pathPoints : route.pathPoints.slice(1);
    });
    const height = Math.max(...parts.map(p => p.depth), 30) + 18;
    return [{ wire, points: [
      { ...start, z: from.depth + 5 }, ...points.map(p => ({ ...p, z: height })),
      { ...end, z: to.depth + 5 },
    ] }];
  });
  return { parts, paths, bounds: { minX, minY, maxX, maxY }, omittedWires: wires.length - paths.length };
}
