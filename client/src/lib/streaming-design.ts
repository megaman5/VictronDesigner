export interface DraftComponent { id: string; type: string; name: string; x: number; y: number }
export interface DraftWire { fromComponentId: string; toComponentId: string; polarity?: string }

// Read only complete objects from the two top-level arrays. JSON strings and
// nested property objects are tracked, so a cut in any token is harmless.
export function parseStreamingDesign(text: string): { components: DraftComponent[]; wires: DraftWire[] } {
  const arrays: Record<string, any[]> = { components: [], wires: [] };
  let depth = 0;
  for (let i = text.indexOf('{'); i >= 0 && i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      if (depth !== 1) continue;
      let key: string;
      try { key = JSON.parse(text.slice(start, i + 1)); } catch { break; }
      if (!(key === 'components' || key === 'wires')) continue;
      let cursor = i + 1;
      while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
      if (text[cursor++] !== ':') continue;
      while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
      if (text[cursor] !== '[') continue;
      let nesting = 0, objectStart = -1, quoted = false;
      for (cursor++; cursor < text.length; cursor++) {
        const ch = text[cursor];
        if (quoted) { if (ch === '\\') cursor++; else if (ch === '"') quoted = false; continue; }
        if (ch === '"') { quoted = true; continue; }
        if (ch === ']' && nesting === 0) break;
        if (ch === '{' || ch === '[') { if (nesting === 0 && ch === '{') objectStart = cursor; nesting++; }
        if (ch === '}' || ch === ']') {
          nesting--;
          if (nesting === 0 && objectStart >= 0) {
            try { arrays[key].push(JSON.parse(text.slice(objectStart, cursor + 1))); } catch { /* Wait for valid objects. */ }
            objectStart = -1;
          }
        }
      }
      i = cursor;
    } else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  const ids = new Set<string>();
  const components = arrays.components.filter(c => {
    if (!c || typeof c.id !== 'string' || typeof c.type !== 'string' || !Number.isFinite(c.x) || !Number.isFinite(c.y) || ids.has(c.id)) return false;
    ids.add(c.id); return true;
  }).slice(0, 150).map(c => ({ id: c.id, type: c.type, name: typeof c.name === 'string' ? c.name : c.type.replaceAll('-', ' '), x: Math.max(-10000, Math.min(10000, c.x)), y: Math.max(-10000, Math.min(10000, c.y)) }));
  const wires = arrays.wires.filter(w => w && typeof w.fromComponentId === 'string' && typeof w.toComponentId === 'string').slice(0, 500);
  return { components, wires };
}
