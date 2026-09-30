import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { deviceDetails } from '../../client/src/lib/device-3d-details';

describe('solar panel surface separation', () => {
  it('leaves the cell field clear of metal and separates the backing, cells and conductors', () => {
    const meshes = deviceDetails('solar-panel', 140, 100, 12);
    const bounds = (color: string) => meshes.filter(m => (m.material as any).color.getHexString() === color)
      .map(m => new Box3().setFromObject(m));
    const frame = bounds('9facb7'), backing = bounds('081525'), cells = bounds('142c50'), strips = bounds('7d93a9');
    expect(frame).toHaveLength(4); expect(backing).toHaveLength(1); expect(cells).toHaveLength(24);
    for (const cell of cells) {
      expect(cell.min.z - backing[0].max.z).toBeGreaterThan(1);
      expect(frame.some(rail => rail.intersectsBox(cell))).toBe(false);
    }
    const cellTop = Math.max(...cells.map(c => c.max.z));
    for (const strip of strips) expect(strip.min.z - cellTop).toBeGreaterThan(0.2);
    for (const mesh of meshes) { mesh.geometry.dispose(); (mesh.material as any).dispose(); }
  });
});
