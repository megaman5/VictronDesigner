import { describe, expect, it } from 'vitest';
import { parseStreamingDesign } from '../../client/src/lib/streaming-design';

const battery = { id: 'b', type: 'battery', name: 'Battery "{bank}"', x: 20, y: 40, properties: { voltage: 48, nested: ['braces }', { a: 1 }] } };
const fuse = { id: 'f', type: 'fuse', x: 400, y: 40 };
const wire = { fromComponentId: 'b', toComponentId: 'f', polarity: 'positive' };
describe('streaming draft parser', () => {
  it('displays only completed equipment and wires at every cut in the stream', () => {
    const text = JSON.stringify({ components: [battery, fuse], wires: [wire] });
    const end = (value: unknown) => text.indexOf(JSON.stringify(value)) + JSON.stringify(value).length;
    for (let cut = 0; cut <= text.length; cut++) {
      const draft = parseStreamingDesign(text.slice(0, cut));
      expect(draft.components.length).toBe(Number(cut >= end(battery)) + Number(cut >= end(fuse)));
      expect(draft.wires.length).toBe(Number(cut >= end(wire)));
    }
  });
  it('ignores array names inside strings and nested properties', () => {
    const draft = parseStreamingDesign(JSON.stringify({ description: '"components": [{fake}]', nested: { components: [fuse] }, components: [battery], wires: [wire] }));
    expect(draft.components.map(c => c.id)).toEqual(['b']);
    expect(draft.wires).toHaveLength(1);
    expect(draft.components[0].name).toBe(battery.name);
  });
  it('accepts fenced JSON and skips unusable or duplicate equipment', () => {
    const draft = parseStreamingDesign('```json\n' + JSON.stringify({ wires: [wire], components: [null, { id: 'bad' }, battery, battery, fuse] }) + '\n```');
    expect(draft.components.map(c => c.id)).toEqual(['b', 'f']);
    expect(draft.wires).toHaveLength(1);
  });
});
