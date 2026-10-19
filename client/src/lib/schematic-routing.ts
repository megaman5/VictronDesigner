import type { SchematicComponent, Wire } from '@shared/schema';
import { getComponentDimensions, getComponentTerminals, type Terminal } from './terminal-config';
import { computeBusbarTerminalOverrides } from './busbar-ordering';
import { calculateRoute, GRID_SIZE, type WireRoutingOptions } from './wire-routing';

type Point = { x: number; y: number };
export interface RoutingPart { component: SchematicComponent; width: number; height: number; terminals: Terminal[] }
export interface RoutePreview { from?: Point; to?: Point; waypoints?: Point[] }
export function schematicRoutingParts(components: SchematicComponent[]): RoutingPart[] {
  return components.map(component => ({component, ...getComponentDimensions(component.type, component.properties),
    terminals: getComponentTerminals(component.type, component.properties)}));
}
/** Both views use the same geometry, terminal ordering and occupied lanes. */
export function buildSchematicRoutes(parts: RoutingPart[], wires: Wire[], options: WireRoutingOptions, previews = new Map<string, RoutePreview>()) {
  const byId = new Map(parts.map(p => [p.component.id, p]));
  const overrides = computeBusbarTerminalOverrides(parts.map(p => p.component), wires);
  const ordered = [...wires].sort((a,b) => a.id.localeCompare(b.id));
  const key = (id: string, terminal: string | undefined) => JSON.stringify([id, terminal]);
  const usage = new Map<string, string[]>();
  for (const w of ordered) {
    const o = overrides.get(w.id);
    for (const k of [key(w.fromComponentId, o?.from ?? w.fromTerminal), key(w.toComponentId, o?.to ?? w.toTerminal)])
      usage.set(k, [...(usage.get(k) ?? []), w.id]);
  }
  const busbar = (type: string) => type === 'busbar-positive' || type === 'busbar-negative';
  const obstacles = parts.map(p => busbar(p.component.type)
    ? {x:p.component.x+10,y:p.component.y+24,width:180,height:12}
    : {x:p.component.x,y:p.component.y,width:p.width,height:p.height});
  const maxX = Math.max(2400, ...parts.map(p=>p.component.x+p.width+100));
  const maxY = Math.max(1600, ...parts.map(p=>p.component.y+p.height+100));
  const occupied = new Set<string>();
  return ordered.flatMap(wire => {
    const from = byId.get(wire.fromComponentId), to = byId.get(wire.toComponentId);
    if (!from || !to) return [];
    const o = overrides.get(wire.id), preview = previews.get(wire.id);
    const a = from.terminals.find(t=>t.id === (o?.from ?? wire.fromTerminal));
    const b = to.terminals.find(t=>t.id === (o?.to ?? wire.toTerminal));
    if (!a || !b) return [];
    const start = preview?.from ?? {x:from.component.x+a.x,y:from.component.y+a.y};
    const end = preview?.to ?? {x:to.component.x+b.x,y:to.component.y+b.y};
    const fromOri = busbar(from.component.type) ? (to.component.y+to.height/2 < from.component.y+from.height/2 ? 'top' : 'bottom') : a.orientation;
    const toOri = busbar(to.component.type) ? (from.component.y+from.height/2 < to.component.y+to.height/2 ? 'top' : 'bottom') : b.orientation;
    const offset = (k: string) => {
      const ids = usage.get(k) ?? [wire.id];
      return Math.round((ids.indexOf(wire.id)-(ids.length-1)/2)*options.laneOffset/GRID_SIZE)*GRID_SIZE;
    };
    const anchors = [start, ...(preview?.waypoints ?? (wire.waypoints ?? []).map(p=>({x:from.component.x+p.x,y:from.component.y+p.y}))), end];
    let path = '';
    const pathPoints: Point[] = [];
    anchors.slice(1).forEach((p,i) => {
      const previous = anchors[i];
      const route = calculateRoute(previous.x,previous.y,p.x,p.y,obstacles,maxX,maxY,occupied,
        i===0 ? fromOri : undefined,i===anchors.length-2 ? toOri : undefined,options,
        {start:i===0 ? offset(key(from.component.id,a.id)) : 0,end:i===anchors.length-2 ? offset(key(to.component.id,b.id)) : 0});
      route.pathNodes.forEach(n=>occupied.add(n));
      path += i===0 ? route.path : ' '+route.path.replace(/^M/,'L');
      pathPoints.push(...(i===0 ? route.pathPoints : route.pathPoints.slice(1)));
    });
    let labelX=start.x,labelY=start.y,labelRotation=0,longest=-1;
    pathPoints.slice(1).forEach((p,i)=>{const q=pathPoints[i],len=Math.hypot(p.x-q.x,p.y-q.y);
      if(len>longest){longest=len;labelX=(p.x+q.x)/2;labelY=(p.y+q.y)/2;labelRotation=Math.abs(p.x-q.x)>=Math.abs(p.y-q.y)?0:90;}});
    return [{wire,path,pathPoints,labelX,labelY,labelRotation}];
  });
}
