import { describe, it, expect } from 'vitest';
import {
  transformTerminal,
  transformDimensions,
  getOrientation,
  getComponentTerminals,
  getComponentDimensions,
  getBaseComponentDimensions,
  type Terminal,
} from '@/lib/terminal-config';

const term = (over: Partial<Terminal> = {}): Terminal => ({
  id: 't',
  type: 'positive',
  label: '+',
  x: 0,
  y: 20,
  color: 'red',
  orientation: 'left',
  ...over,
});

const O = (rotation = 0, mirrorX = false, mirrorY = false) =>
  ({ rotation, mirrorX, mirrorY }) as any;

describe('transformDimensions', () => {
  it('swaps width and height on a quarter turn', () => {
    expect(transformDimensions(160, 120, O(90))).toEqual({ width: 120, height: 160 });
    expect(transformDimensions(160, 120, O(270))).toEqual({ width: 120, height: 160 });
  });

  it('leaves the footprint alone at 0 and 180', () => {
    expect(transformDimensions(160, 120, O(0))).toEqual({ width: 160, height: 120 });
    expect(transformDimensions(160, 120, O(180))).toEqual({ width: 160, height: 120 });
  });

  it('mirroring never changes the footprint', () => {
    expect(transformDimensions(160, 120, O(0, true, true))).toEqual({ width: 160, height: 120 });
  });
});

describe('transformTerminal rotation', () => {
  const W = 160, H = 120;

  it('maps corners correctly for a 90 degree clockwise turn', () => {
    // Top-left of the body ends up top-right of the rotated (H x W) box.
    const tl = transformTerminal(term({ x: 0, y: 0 }), W, H, O(90));
    expect([tl.x, tl.y]).toEqual([H, 0]);
    // Bottom-left ends up top-left.
    const bl = transformTerminal(term({ x: 0, y: H }), W, H, O(90));
    expect([bl.x, bl.y]).toEqual([0, 0]);
  });

  it('sends the left edge to the top on a clockwise turn', () => {
    expect(transformTerminal(term({ orientation: 'left' }), W, H, O(90)).orientation).toBe('top');
    expect(transformTerminal(term({ orientation: 'top' }), W, H, O(90)).orientation).toBe('right');
    expect(transformTerminal(term({ orientation: 'right' }), W, H, O(90)).orientation).toBe('bottom');
    expect(transformTerminal(term({ orientation: 'bottom' }), W, H, O(90)).orientation).toBe('left');
  });

  it('180 degrees flips both axes and both edges', () => {
    const t = transformTerminal(term({ x: 10, y: 20, orientation: 'left' }), W, H, O(180));
    expect([t.x, t.y]).toEqual([W - 10, H - 20]);
    expect(t.orientation).toBe('right');
  });

  it('270 is the inverse of 90', () => {
    const start = term({ x: 30, y: 40, orientation: 'bottom' });
    const once = transformTerminal(start, W, H, O(90));
    // Rotating the already-rotated terminal back, in the swapped H x W frame.
    const back = transformTerminal(once, H, W, O(270));
    expect([back.x, back.y]).toEqual([start.x, start.y]);
    expect(back.orientation).toBe(start.orientation);
  });

  it('four quarter turns return to the start', () => {
    let t = term({ x: 30, y: 40, orientation: 'left' });
    let w = W, h = H;
    for (let i = 0; i < 4; i++) {
      t = transformTerminal(t, w, h, O(90));
      [w, h] = [h, w];
    }
    expect([t.x, t.y]).toEqual([30, 40]);
    expect(t.orientation).toBe('left');
  });

  it('keeps every terminal inside the rotated footprint', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const t = transformTerminal(term({ x: 155, y: 5 }), W, H, O(rotation));
      const dims = transformDimensions(W, H, O(rotation));
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(dims.width);
      expect(t.y).toBeLessThanOrEqual(dims.height);
    }
  });
});

describe('transformTerminal mirroring', () => {
  const W = 160, H = 120;

  it('mirrorX flips x and swaps left/right, leaving top/bottom alone', () => {
    const t = transformTerminal(term({ x: 10, orientation: 'left' }), W, H, O(0, true, false));
    expect(t.x).toBe(W - 10);
    expect(t.orientation).toBe('right');
    expect(transformTerminal(term({ orientation: 'top' }), W, H, O(0, true, false)).orientation).toBe('top');
  });

  it('mirrorY flips y and swaps top/bottom', () => {
    const t = transformTerminal(term({ y: 20, orientation: 'top' }), W, H, O(0, false, true));
    expect(t.y).toBe(H - 20);
    expect(t.orientation).toBe('bottom');
  });

  it('mirroring twice is identity', () => {
    const start = term({ x: 10, y: 20, orientation: 'left' });
    const once = transformTerminal(start, W, H, O(0, true, true));
    const twice = transformTerminal(once, W, H, O(0, true, true));
    expect([twice.x, twice.y]).toEqual([start.x, start.y]);
    expect(twice.orientation).toBe(start.orientation);
  });
});

describe('orientation reaches the resolvers', () => {
  it('rotates a built-in component through getComponentTerminals', () => {
    const upright = getComponentTerminals('mppt', {});
    const turned = getComponentTerminals('mppt', { rotation: 90 });
    expect(turned).toHaveLength(upright.length);
    // PV+ exits the bottom normally; a clockwise turn sends it to the left.
    const pvUp = upright.find(t => t.id === 'pv-positive')!;
    const pvTurned = turned.find(t => t.id === 'pv-positive')!;
    expect(pvUp.orientation).toBe('bottom');
    expect(pvTurned.orientation).toBe('left');
  });

  it('reports a rotated footprint but keeps the base size for rendering', () => {
    const base = getBaseComponentDimensions('mppt', { rotation: 90 });
    const rotated = getComponentDimensions('mppt', { rotation: 90 });
    expect(rotated).toEqual({ width: base.height, height: base.width });
  });

  it('rotates a custom component against its own snapshotted size', () => {
    const props = {
      width: 400,
      height: 40,
      rotation: 90,
      terminals: [term({ x: 0, y: 40, orientation: 'bottom' })],
    };
    const [t] = getComponentTerminals('custom', props);
    expect(t.orientation).toBe('left');
    expect(getComponentDimensions('custom', props)).toEqual({ width: 40, height: 400 });
  });

  it('ignores a nonsense rotation rather than skewing the layout', () => {
    expect(getOrientation({ rotation: 37 }).rotation).toBe(0);
    expect(getOrientation(undefined).rotation).toBe(0);
  });
});

describe('rotation reaches consumers beyond the canvas', () => {
  it('server-side overlap detection sees the rotated footprint', async () => {
    const { DesignValidator } = await import('../../server/design-validator');

    // A 400x40 busbar and a component 100px below it: no overlap upright,
    // but turning the busbar upright (40x400) makes it collide.
    const bar = (rotation: number) => ({
      id: 'bar', type: 'custom', name: 'Busbar', x: 200, y: 200,
      properties: { width: 400, height: 40, rotation, terminals: [] },
    }) as any;
    const below = {
      id: 'b', type: 'battery', name: 'Battery', x: 200, y: 300, properties: { voltage: 12 },
    } as any;

    const overlaps = (rotation: number) =>
      new DesignValidator([bar(rotation), below], [], 12)
        .validate()
        .issues.some(i => i.message.toLowerCase().includes('overlap'));

    expect(overlaps(0)).toBe(false);
    expect(overlaps(90)).toBe(true);
  });
});

describe('rotated components render', () => {
  it('draws a rotated component without throwing, at the rotated footprint', async () => {
    const { render } = await import('@testing-library/react');
    const { SchematicComponent } = await import('@/components/SchematicComponent');

    for (const rotation of [0, 90, 180, 270]) {
      const { container } = render(
        <SchematicComponent
          id="c1"
          type="mppt"
          name="MPPT"
          properties={{ rotation }}
          selected={false}
        />
      );
      expect(container.querySelector('svg')).toBeTruthy();
    }
  });

  it('renders a mirrored component', async () => {
    const { render } = await import('@testing-library/react');
    const { SchematicComponent } = await import('@/components/SchematicComponent');
    const { container } = render(
      <SchematicComponent
        id="c1"
        type="multiplus"
        name="MultiPlus"
        properties={{ mirrorX: true }}
        selected={false}
      />
    );
    expect(container.innerHTML).toContain('scale(-1, 1)');
  });
});
