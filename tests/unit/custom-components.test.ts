import { describe, it, expect } from 'vitest';
import { toPlacedProperties } from '@/lib/custom-components';
import type { CustomComponentDefinition } from '@/lib/custom-components';

const definition = (over: Partial<CustomComponentDefinition> = {}): CustomComponentDefinition => ({
  id: 'def-1',
  ownerId: 'owner-1',
  name: 'Water maker',
  subtitle: '12V, 8A',
  category: 'custom',
  width: 160,
  height: 120,
  terminals: [
    { id: 'in-positive', type: 'positive', label: '+', x: 0, y: 40, color: 'red', orientation: 'left' },
  ],
  appearance: null,
  supportedVoltages: null,
  visibility: 'private',
  version: 1,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('toPlacedProperties', () => {
  it('does not freeze a voltage onto the placed instance', () => {
    // A custom part has no voltage field in the properties panel, so a frozen
    // snapshot could never be corrected and would feed stale numbers into wire
    // sizing and inferSystemVoltage(). It must fall back to the live value.
    expect(toPlacedProperties(definition())).not.toHaveProperty('voltage');
  });

  it('snapshots terminals and dimensions so edits to the definition do not alter placed parts', () => {
    const props = toPlacedProperties(definition());
    expect(props.terminals).toHaveLength(1);
    expect(props.width).toBe(160);
    expect(props.height).toBe(120);
    expect(props.definitionId).toBe('def-1');
    expect(props.definitionVersion).toBe(1);
  });

  it('carries declared supported voltages through to the instance', () => {
    expect(toPlacedProperties(definition({ supportedVoltages: [12, 24] })).supportedVoltages).toEqual([12, 24]);
  });

  it('omits supportedVoltages when none are declared', () => {
    expect(toPlacedProperties(definition({ supportedVoltages: [] })).supportedVoltages).toBeUndefined();
    expect(toPlacedProperties(definition({ supportedVoltages: null })).supportedVoltages).toBeUndefined();
  });
});

describe('editor preview geometry', () => {
  // Mirrors CustomComponentEditor: viewBox is padded so terminals sitting ON
  // the body edge render whole instead of being sliced in half, and the
  // click->svg mapping has to subtract that same padding back out.
  const PREVIEW_PAD = 18;

  const toSvgPoint = (clientOffset: number, rectSize: number, boxSize: number) =>
    clientOffset * ((boxSize + PREVIEW_PAD * 2) / rectSize) - PREVIEW_PAD;

  it('keeps an edge terminal fully inside the padded viewBox', () => {
    const width = 400, height = 40, r = 8;
    const minX = -PREVIEW_PAD, maxX = width + PREVIEW_PAD;
    const minY = -PREVIEW_PAD, maxY = height + PREVIEW_PAD;
    // A terminal on the bottom edge: its dot spans y +/- r around y=height.
    expect(height + r).toBeLessThanOrEqual(maxY);
    expect(0 - r).toBeGreaterThanOrEqual(minY);
    // And one on the left edge spans x +/- r around x=0.
    expect(0 - r).toBeGreaterThanOrEqual(minX);
    expect(width + r).toBeLessThanOrEqual(maxX);
  });

  it('maps a click at the top-left of the rendered box back to the padded origin', () => {
    const width = 400;
    const rectW = width + PREVIEW_PAD * 2; // rendered 1:1
    expect(toSvgPoint(0, rectW, width)).toBeCloseTo(-PREVIEW_PAD);
  });

  it('maps a click at the body origin back to 0,0', () => {
    const width = 400;
    const rectW = width + PREVIEW_PAD * 2;
    expect(toSvgPoint(PREVIEW_PAD, rectW, width)).toBeCloseTo(0);
  });

  it('maps a click at the far body edge back to the body width', () => {
    const width = 400;
    const rectW = width + PREVIEW_PAD * 2;
    expect(toSvgPoint(PREVIEW_PAD + width, rectW, width)).toBeCloseTo(width);
  });

  it('scales a long thin busbar up to a usable preview height', () => {
    // 400x40 previously rendered 40px tall, too small to place terminals on.
    const boxW = 400 + PREVIEW_PAD * 2;
    const boxH = 40 + PREVIEW_PAD * 2;
    const scale = Math.min(560 / boxW, 260 / boxH, 2);
    expect(Math.round(boxH * scale)).toBeGreaterThan(60);
    expect(Math.round(boxW * scale)).toBeLessThanOrEqual(560);
  });
});
