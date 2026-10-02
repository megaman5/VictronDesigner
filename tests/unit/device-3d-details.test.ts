import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { FUSE_TYPES, type FuseType } from '../../shared/protection-devices';
import { deviceDetails, fuseNameplate } from '../../client/src/lib/device-3d-details';

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

describe('rotary disconnect', () => {
  it.each([
    [{ x: -8, y: 40 }, { x: 88, y: 40 }],
    [{ x: 40, y: -8 }, { x: 40, y: 88 }],
  ])('supports terminal hardware in either orientation', (...terminals) => {
    const before = JSON.stringify(terminals);
    const meshes = deviceDetails('switch', 80, 80, 28, terminals);
    const mounts = meshes.filter(m => (m.material as any).color.getHexString() === '242a2e')
      .map(m => new Box3().setFromObject(m));
    for (const terminal of terminals) {
      expect(mounts.some(b => b.min.x < terminal.x && b.max.x > terminal.x &&
        b.min.y < -terminal.y && b.max.y > -terminal.y && b.max.z >= 27)).toBe(true);
    }
    expect(JSON.stringify(terminals)).toBe(before);
    for (const mesh of meshes) { mesh.geometry.dispose(); (mesh.material as any).dispose(); }
  });
});


describe('fuse family nameplate clearance', () => {
  it.each(Object.keys(FUSE_TYPES) as FuseType[])('%s never intersects the nameplate', family => {
    const meshes = deviceDetails('fuse', 80, 60, 12, [], family);
    const p = fuseNameplate(80, 60, 12);
    const plate = new Box3(new Vector3(p.x - p.width / 2, -p.y - p.height / 2, p.z - 0.1),
      new Vector3(p.x + p.width / 2, -p.y + p.height / 2, p.z + 0.1));
    for (const mesh of meshes) {
      expect(new Box3().setFromObject(mesh).intersectsBox(plate)).toBe(false);
      mesh.geometry.dispose(); (mesh.material as any).dispose();
    }
  });
});
