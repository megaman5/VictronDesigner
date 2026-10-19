import type { SchematicComponent } from '@shared/schema';
import { getComponentDimensions } from './terminal-config';

export function isLayoutOnlyRequest(prompt: string): boolean {
  const layout = /\b(?:align|line\s+up|straighten|tidy|clean\s+up|neaten|space\s+out|arrange|organize|reorganize)\b/i.test(prompt) && /\b(?:icons?|components?|layout|diagram|spacing)\b/i.test(prompt);
  const electricalChange = /\b(?:add|remove|replace|upgrade|rewire|connect|disconnect|size|design|generate|voltage|capacity|watts?|amps?|fuse|battery|batteries|solar)\b/i.test(prompt);
  return layout && !electricalChange;
}

/** Align nearby rows, retaining their order and every equipment property. */
export function tidyComponentLayout(components: SchematicComponent[]): SchematicComponent[] {
  const snap = (n: number) => Math.round(n / 20) * 20;
  const rows: SchematicComponent[][] = [];
  for (const component of [...components].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(component.y - row[0].y) <= 100) row.push(component);
    else rows.push([component]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  let bottom = 0;
  for (const row of rows) {
    const y = Math.max(20, snap(row[0].y), bottom);
    let right = 20;
    let height = 0;
    for (const component of row.sort((a, b) => a.x - b.x)) {
      const size = getComponentDimensions(component.type, component.properties);
      const width = size.width;
      height = Math.max(height, size.height);
      const x = Math.max(right, snap(component.x));
      positions.set(component.id, { x, y });
      right = Math.ceil((x + width + 60) / 20) * 20;
    }
    bottom = Math.ceil((y + height + 80) / 20) * 20;
  }
  return components.map(component => ({ ...component, ...positions.get(component.id)! }));
}
