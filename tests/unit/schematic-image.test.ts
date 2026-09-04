import { describe, it, expect } from 'vitest';
import { fitText, renderSchematicPng } from '../../server/ai/schematic-image';

const comp = (id: string, x: number, y: number, type = 'battery') =>
  ({ id, type, name: `${type}-${id}`, x, y, properties: { voltage: 12 } }) as any;

describe('renderSchematicPng', () => {
  it('produces a real PNG', () => {
    const r = renderSchematicPng([comp('a', 200, 200)], []);
    expect(r.png.subarray(1, 4).toString()).toBe('PNG');
    expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it('crops to the content so a corner design is not a stamp in white space', () => {
    // Two components close together should render a tighter box than two far apart.
    const tight = renderSchematicPng([comp('a', 200, 200), comp('b', 400, 200)], []);
    const wide = renderSchematicPng([comp('a', 200, 200), comp('b', 1800, 1200)], []);
    expect(tight.width / tight.height).not.toBeCloseTo(wide.width / wide.height, 1);
  });

  it('never exceeds the requested max dimension', () => {
    const r = renderSchematicPng([comp('a', 0, 0), comp('b', 1900, 1400)], [], { maxDimension: 512 });
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(512);
  });

  it('renders wires between components', () => {
    const wires = [
      { id: 'w', fromComponentId: 'a', toComponentId: 'b', fromTerminal: 'positive', toTerminal: 'positive', polarity: 'positive' },
    ] as any;
    const withWire = renderSchematicPng([comp('a', 200, 200), comp('b', 700, 400)], wires);
    const without = renderSchematicPng([comp('a', 200, 200), comp('b', 700, 400)], []);
    // The wire adds pixels, so the encoded images differ.
    expect(withWire.png.equals(without.png)).toBe(false);
  });

  it('survives a wire referencing a missing component', () => {
    const wires = [
      { id: 'w', fromComponentId: 'a', toComponentId: 'ghost', fromTerminal: 'positive', toTerminal: 'positive', polarity: 'positive' },
    ] as any;
    expect(() => renderSchematicPng([comp('a', 200, 200)], wires)).not.toThrow();
  });

  it('handles an empty design without throwing', () => {
    expect(() => renderSchematicPng([], [])).not.toThrow();
  });

  it('reflects rotation in the drawn footprint', () => {
    const upright = renderSchematicPng(
      [{ id: 'c', type: 'custom', name: 'Bar', x: 200, y: 200, properties: { width: 400, height: 40, terminals: [] } } as any],
      []
    );
    const turned = renderSchematicPng(
      [{ id: 'c', type: 'custom', name: 'Bar', x: 200, y: 200, properties: { width: 400, height: 40, rotation: 90, terminals: [] } } as any],
      []
    );
    // A long-thin bar turned upright swaps the aspect ratio of the crop.
    expect(upright.width > upright.height).toBe(true);
    expect(turned.height > turned.width).toBe(true);
  });
});

describe('modelSupportsVision', () => {
  it('accepts the model families actually in use', async () => {
    const { modelSupportsVision } = await import('../../server/ai/schematic-image');
    for (const m of ['gpt-5.5', 'gpt-5.2-chat-latest', 'gpt-5.6-luna', 'gpt-4o', 'o3-mini']) {
      expect(modelSupportsVision(m)).toBe(true);
    }
  });

  it('rejects text-only and non-chat models', async () => {
    const { modelSupportsVision } = await import('../../server/ai/schematic-image');
    for (const m of ['gpt-5-audio', 'gpt-4o-realtime', 'text-embedding-3-large', 'llama-2', '']) {
      expect(modelSupportsVision(m)).toBe(false);
    }
  });
});

describe('buildIterationUserMessage', () => {
  const design = {
    components: [{ id: 'a', type: 'battery', name: 'B', x: 200, y: 200, properties: {} }],
    wires: [],
  };

  it('attaches the layout image for a vision model', async () => {
    const { buildIterationUserMessage } = await import('../../server/ai/schematic-image');
    const msg = buildIterationUserMessage('fix it', design, 'gpt-5.5');
    expect(Array.isArray(msg)).toBe(true);
    const parts = msg as any[];
    expect(parts[0].type).toBe('text');
    expect(parts[1].type).toBe('image_url');
    expect(parts[1].image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('stays text-only on the first pass, when there is nothing built yet', async () => {
    const { buildIterationUserMessage } = await import('../../server/ai/schematic-image');
    expect(buildIterationUserMessage('start', null, 'gpt-5.5')).toBe('start');
    expect(buildIterationUserMessage('start', { components: [] }, 'gpt-5.5')).toBe('start');
  });

  it('stays text-only for a model that cannot see, rather than erroring', async () => {
    const { buildIterationUserMessage } = await import('../../server/ai/schematic-image');
    expect(buildIterationUserMessage('fix it', design, 'text-embedding-3-large')).toBe('fix it');
  });

  it('keeps the original instruction text in the image message', async () => {
    const { buildIterationUserMessage } = await import('../../server/ai/schematic-image');
    const parts = buildIterationUserMessage('SPECIFIC FEEDBACK HERE', design, 'gpt-5.5') as any[];
    expect(parts[0].text).toContain('SPECIFIC FEEDBACK HERE');
  });
});

describe('Component labels', () => {
  // A fake 2d context: text width is proportional to length x font size, which
  // is enough to exercise the fitting loop without a real canvas.
  const fakeCtx = () => ({
    font: '',
    measureText(t: string) {
      const px = Number(/(\d+)px/.exec(this.font)?.[1] ?? 15);
      return { width: t.length * px * 0.55 };
    },
  });

  it('keeps a preferred size when the label already fits', () => {
    const ctx = fakeCtx();
    fitText(ctx as any, 'Battery', 200, 15, true);
    expect(ctx.font).toBe('bold 15px sans-serif');
  });

  it('shrinks a long label instead of clipping it', () => {
    // "300A Positive Distribution Bus" used to render as "300A Posit...",
    // which the vision judges scored as a design fault rather than a
    // rendering limit.
    const ctx = fakeCtx();
    fitText(ctx as any, '300A Positive Distribution Bus', 200, 15, true);
    const px = Number(/(\d+)px/.exec(ctx.font)![1]);
    expect(px).toBeLessThan(15);
    expect(ctx.measureText('300A Positive Distribution Bus').width).toBeLessThanOrEqual(200);
  });

  it('stops shrinking at a readable floor', () => {
    const ctx = fakeCtx();
    fitText(ctx as any, 'x'.repeat(400), 100, 15, false);
    expect(ctx.font).toBe('8px sans-serif');
  });

  it('still renders a schematic containing a very long name', () => {
    const out = renderSchematicPng(
      [{ id: 'bus1', type: 'busbar-positive', name: '300A Positive Distribution Bus', x: 200, y: 200, properties: {} } as any],
      [],
      { maxDimension: 900 }
    );
    expect(out.png.length).toBeGreaterThan(0);
  });
});

describe('Canvas headroom for large designs', () => {
  // Regression for the 2000x1500 clamp cutting off designs that legitimately
  // sprawl past it - the validator no longer nags about that boundary (there
  // is no real one), so this renderer's clamp must not silently reintroduce
  // it by cropping the model's own view of the design.
  it('does not clamp content to the old 2000x1500 box', () => {
    // Right edge at 2350+160=2510 - past the old 2000px limit, inside the
    // current 2560px one. Content is ~350px tall regardless (both components
    // at y=200), so at maxDimension=1024 the rendered height is purely a
    // function of how wide the renderer thinks the content is: ~145px if it
    // correctly sees ~2480px of width, ~187px if a reintroduced 2000px clamp
    // shrinks that to ~1920px. The two are far enough apart that this is a
    // real regression check, not a rounding coin flip.
    const r = renderSchematicPng([comp('a', 200, 200), comp('b', 2350, 200)], []);
    expect(r.height).toBeLessThan(165);
  });
});
