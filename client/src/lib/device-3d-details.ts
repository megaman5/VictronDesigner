import * as THREE from 'three';
import type { FuseType } from '@shared/protection-devices';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Complete housings, in local schematic coordinates. Terminal anchors are added by the viewer. */
export function deviceDetails(type: string, w: number, h: number, d: number, terminals: ReadonlyArray<{ x: number; y: number }> = [], fuseType: FuseType = 'class-t'): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const material = (color: string, metal = 0.15) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: metal > 0.5 ? 0.3 : 0.48 });
  const add = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, color: string, metal = 0.15) => {
    const mesh = new THREE.Mesh(geometry, material(color, metal)); mesh.position.set(x, -y, z);
    mesh.castShadow = true; mesh.receiveShadow = true; meshes.push(mesh); return mesh;
  };
  const box = (x: number, y: number, z: number, a: number, b: number, c: number, color: string, radius = 1.5, metal = 0.15) =>
    add(new RoundedBoxGeometry(a, b, c, 2, Math.min(radius, a / 3, b / 3, c / 3)), x, y, z, color, metal);
  const stud = (x: number, y: number, z: number, radius: number, height: number, color: string, segments = 24) => {
    const mesh = add(new THREE.CylinderGeometry(radius, radius, height, segments), x, y, z, color, 0.75); mesh.rotation.x = Math.PI / 2; return mesh;
  };
  const screw = (x: number, y: number, z: number) => {
    stud(x, y, z, 1.7, 1, '#b6c2ca'); box(x, y, z + 0.55, 2.2, 0.4, 0.2, '#38434d', 0.1);
  };
  const feet = () => { for (const x of [w * 0.13, w * 0.87]) for (const y of [h * 0.1, h * 0.9]) {
    box(x, y, 2, w * 0.16, h * 0.13, 4, '#26323b'); screw(x, y, 4.6);
  } };
  const panel = type === 'ac-panel' || type === 'dc-panel';
  if (type === 'switch') {
    // Molded rotary isolator, with supported terminal bosses at the real wire anchors.
    for (const t of terminals) {
      const x = Math.max(10, Math.min(w - 10, t.x)), y = Math.max(10, Math.min(h - 10, t.y));
      const mount = box((x + t.x) / 2, (y + t.y) / 2, d / 2,
        Math.hypot(x - t.x, y - t.y) + 12, 15, d - 2, '#242a2e', 3);
      mount.rotation.z = -Math.atan2(y - t.y, x - t.x);
      stud(t.x, t.y, d - 0.3, 6, 1.4, '#ac7844');
    }
    box(w / 2, h / 2, d * 0.45, w * 0.92, h * 0.92, d * 0.9, '#242a2e', 7);
    box(w / 2, h / 2, d - 1, w * 0.9, h * 0.9, 5, '#e0ded5', 5);
    const radius = Math.min(w, h) * 0.33, cy = h * 0.55;
    stud(w / 2, cy, d + 1.8, radius, 2, '#252a2d', 64);
    stud(w / 2, cy, d + 3.5, radius * 0.55, 3, '#851c1b', 64);
    stud(w / 2, cy, d + 5.5, radius * 0.43, 4, '#c72b25', 64);
    box(w / 2, cy, d + 8, radius * 1.36, radius * 0.4, 8, '#dd3029', 2);
    box(w / 2 + radius * 0.48, cy, d + 12.2, 3, radius * 0.24, 0.5, '#fff1dc', 0.2);
    for (const x of [w * 0.12, w * 0.88]) for (const y of [h * 0.12, h * 0.88]) screw(x, y, d + 2);
  } else if (type === 'fuse') {
    box(w / 2, h / 2, d * 0.28, w, h * 0.9, d * 0.56, '#172028', 3);
    for (const x of [w * 0.15, w * 0.85]) box(x, h * 0.5, d * 0.7, w * 0.28, h * 0.24, d * 0.25, '#b97635', 1, 0.85);
    const cy = h * 0.6;
    if (fuseType === 'class-t') {
      const radius = Math.min(h * 0.15, d * 0.7), z = d * 0.56 + radius;
      const cartridge = stud(w / 2, cy, z, radius, w * 0.46, '#eee5ca', 48);
      cartridge.rotation.set(0, 0, Math.PI / 2); (cartridge.material as THREE.MeshStandardMaterial).metalness = 0;
      for (const x of [w * 0.27, w * 0.73]) {
        const cap = stud(x, cy, z, radius * 1.05, w * 0.075, '#c7c4b5', 48); cap.rotation.set(0, 0, Math.PI / 2);
      }
    } else if (fuseType === 'mrbf') {
      box(w / 2, cy, d + 2, w * 0.31, h * 0.4, d * 1.1, '#dfd9c5', 2);
      stud(w / 2, cy, d * 1.55 + 2.7, 6, 1.4, '#b79253');
      stud(w / 2, cy, d * 1.55 + 4.4, 3, 3, '#bcc5c8', 6);
    } else if (fuseType === 'anl') {
      box(w / 2, cy, d * 0.8, w * 0.66, h * 0.22, 2, '#c6a36c', 0.5, 0.8);
      box(w / 2, cy, d + 1, w * 0.38, h * 0.34, 5, '#d4bc89', 2);
      box(w / 2, cy, d + 3.7, w * 0.24, h * 0.15, 0.4, '#544c33', 0.3);
      box(w / 2, cy, d + 4.1, w * 0.18, 1.4, 0.3, '#d7b86a', 0.1, 0.8);
    } else if (fuseType === 'blade') {
      box(w / 2, cy + h * 0.07, d * 0.6, w * 0.42, h * 0.36, 5, '#252c31', 2);
      for (const x of [w * 0.43, w * 0.57]) box(x, cy, d + 3, w * 0.055, 3, d * 0.75, '#c6c5b6', 0.3, 0.8);
      box(w / 2, cy, d + 10, w * 0.32, h * 0.14, 10, '#b46a29', 1.2);
      box(w / 2, cy - h * 0.073, d + 10, w * 0.2, 0.3, 5, '#f0d29a', 0.2);
    } else {
      const midi = fuseType === 'midi';
      box(w / 2, cy, d * 0.78, w * 0.65, h * 0.18, 2, '#b6bdbd', 0.7, 0.8);
      box(w / 2, cy, d + 1, w * (midi ? 0.28 : 0.48), h * (midi ? 0.22 : 0.32), midi ? 5 : 7,
        midi ? '#b67838' : '#8f3430', 2);
      for (const x of [w * 0.46, w * 0.54]) box(x, cy, d + (midi ? 3.7 : 4.7), 2, h * 0.08, 0.4, '#e5dbc4', 0.2);
    }
  } else if (type.startsWith('busbar') || type === 'smartshunt') {
    const positive = type.endsWith('positive');
    box(w / 2, h / 2, d * 0.28, w, h * 0.9, d * 0.56, '#172028', 3);
    box(w / 2, h * 0.55, d * 0.72, w * 0.9, h * 0.34, d * 0.34, type === 'smartshunt' ? '#adb6b7' : '#b97635', 1, 0.85);
    for (const x of [w * 0.06, w * 0.94]) screw(x, h * 0.18, d * 0.58);
    if (type === 'smartshunt') box(w / 2, h * 0.25, d * 0.8, w * 0.35, h * 0.36, d * 0.5, '#0879aa', 2);
    if (positive) box(w / 2, h * 0.84, d * 0.5, w * 0.9, 3, 3, '#a62c2d');
  } else if (type === 'solar-panel') {
    // An open frame, not a solid silver slab coplanar with the dark backing.
    // Keep every exposed layer physically separated; draw order cannot fix it.
    for (const x of [1.25, w - 1.25]) box(x, h / 2, d / 2, 2.5, h, d, '#9facb7', 0.5, 0.8);
    for (const y of [1.25, h - 1.25]) box(w / 2, y, d / 2, w - 5, 2.5, d, '#9facb7', 0.5, 0.8);
    box(w / 2, h / 2, (d - 2) / 2, w - 5, h - 5, d - 2, '#081525', 0.5);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) {
      const cw = (w - 12) / 6, ch = (h - 12) / 4;
      const x = 6 + (col + 0.5) * cw, y = 6 + (row + 0.5) * ch;
      box(x, y, d + 0.3, cw - 1.3, ch - 1.3, 0.8, '#142c50', 1, 0.45);
      for (const offset of [-0.25, 0.25]) box(x + offset * cw, y, d + 1, 0.35, ch - 2, 0.15, '#7d93a9', 0.05, 0.7);
    }
  } else if (type === 'battery') {
    box(w / 2, h / 2, d * 0.45, w * 0.96, h * 0.95, d * 0.9, '#29363d', 5);
    box(w / 2, h / 2, d - 2, w, h, 6, '#17232d', 3);
    for (const x of [w * 0.22, w * 0.78]) {
      box(x, h * 0.15, d + 1, w * 0.19, h * 0.12, 2, '#080e14', 2);
      box(x, h * 0.15, d + 4, w * 0.15, 3, 5, '#4c5a60', 1);
      for (const y of [h * 0.04, h * 0.96]) box(x, y, d * 0.43, 4, 4, d * 0.72, '#17232b', 1);
    }
  } else if (panel) {
    feet();
    box(w / 2, h / 2, d * 0.48, w * 0.96, h * 0.96, d * 0.9, '#9ba6ab', 4, 0.55);
    box(w / 2, h / 2, d - 2, w * 0.94, h * 0.94, 5, '#d5dbdc', 3, 0.35);
    box(w / 2, h * 0.62, d + 0.5, w * 0.72, h * 0.48, 2, '#26323a', 2);
    for (let i = 0; i < 4; i++) {
      const x = w * (0.245 + i * 0.17);
      box(x, h * 0.62, d + 3, w * 0.145, h * 0.39, 5, '#e6e5de', 1);
      box(x, h * 0.59, d + 6, w * 0.095, h * 0.13, 3, '#17252e', 0.5);
      box(x, h * 0.575, d + 8, w * 0.085, h * 0.04, 4, '#333d44', 0.7);
      box(x, h * 0.47, d + 6, w * 0.055, 2, 0.5, '#ca4631', 0.1);
      screw(x, h * 0.77, d + 6);
    }
    for (const x of [w * 0.07, w * 0.93]) for (const y of [h * 0.07, h * 0.93]) screw(x, y, d + 1);
  } else if (type === 'ac-load' || type === 'dc-load') {
    box(w / 2, h / 2, d / 2, w, h, d, '#d0d5d5', 6);
    stud(w / 2, h * 0.65, d + 1, Math.min(w, h) * 0.25, 2, '#34414b');
    for (let i = -3; i <= 3; i++) box(w / 2, h * 0.65 + i * 3, d + 2.5, Math.min(w, h) * 0.35, 1.2, 1, '#a7b2b7', 0.3);
  } else {
    feet();
    const mppt = type === 'mppt';
    box(w / 2, h / 2, d * 0.45, w * 0.95, h * 0.93, d * 0.86, '#133548', 4);
    // Extruded aluminum heat sink beneath a separate powder-coated cover.
    for (let i = 0; i < 11; i++) for (const x of [w * 0.035, w * 0.965])
      box(x, h * (0.18 + i * 0.058), d * 0.47, 5, 2.3, d * 0.66, '#173f51', 0.5, 0.55);
    box(w / 2, h * 0.44, d * 0.62, w * 0.88, h * 0.79, d * 0.74, '#087bac', 4, 0.3);
    box(w / 2, h * 0.9, d * 0.65, w * 0.84, h * 0.15, d * 0.4, '#182b38', 2);
    if (mppt) {
      box(w / 2, h * 0.53, d + 0.6, w * 0.56, h * 0.18, 2, '#153141', 1);
      box(w / 2, h * 0.53, d + 1.7, w * 0.46, h * 0.11, 0.5, '#7ca09c', 0.5);
    } else {
      box(w / 2, h * 0.55, d + 0.6, w * 0.45, h * 0.22, 2, '#1b4054', 1);
      for (let i = 0; i < 3; i++) stud(w * (0.39 + i * 0.11), h * 0.55, d + 2, 1.7, 1, i === 0 ? '#6fc58a' : '#576b70');
    }
    for (let i = 0; i < 9; i++) box(w * (0.22 + i * 0.07), h * 0.74, d + 0.2, 2.2, h * 0.075, 0.8, '#153a50', 0.5);
    for (const x of [w * 0.11, w * 0.89]) for (const y of [h * 0.12, h * 0.78]) screw(x, y, d);
  }
  return meshes;
}

/** The fuse nameplate sits on the rear base strip, outside every cartridge footprint. */
export function fuseNameplate(w: number, h: number, d: number) {
  return { x: w / 2, y: h * 0.12, z: d * 0.56 + 0.35, width: w * 0.7, height: h * 0.16 };
}
