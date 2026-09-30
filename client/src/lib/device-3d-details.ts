import * as THREE from 'three';

/** Lightweight recognizable housings; connection positions stay owned by terminal-config. */
export function deviceDetails(type: string, width: number, height: number, depth: number): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: string, metalness = 0.2) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.6 }));
    mesh.position.set(x, -y, z); meshes.push(mesh);
  };
  const cylinder = (x: number, y: number, z: number, radius: number, length: number, color: string) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.35 }));
    mesh.rotation.x = Math.PI / 2; mesh.position.set(x, -y, z); meshes.push(mesh);
  };
  const rim = (color: string) => {
    box(width / 2, 2, depth + 1, width, 4, 3, color);
    box(width / 2, height - 2, depth + 1, width, 4, 3, color);
    box(2, height / 2, depth + 1, 4, height, 3, color);
    box(width - 2, height / 2, depth + 1, 4, height, 3, color);
  };
  if (type === 'solar-panel') {
    rim('#bac5ce');
    for (let col = 0; col < 6; col++) for (let row = 0; row < 2; row++) {
      const w = (width - 20) / 6, h = height * 0.18;
      box(10 + w * (col + 0.5), height * 0.58 + row * (h + 2), depth + 1, w - 2, h, 1.5, '#163568', 0.4);
      box(10 + w * (col + 0.5), height * 0.58 + row * (h + 2), depth + 2, 0.6, h, 0.3, '#91acc4');
    }
  } else if (type === 'battery') {
    rim('#152534');
    // Reinforced case ribs and recessed carrying handles.
    for (const x of [width * 0.18, width * 0.82]) {
      box(x, height + 1, depth * 0.45, 5, 3, depth * 0.8, '#1b2b39');
      box(x, height * 0.18, depth + 3, width * 0.15, 6, 6, '#111e2b');
    }
  } else if (type.startsWith('busbar')) {
    box(width / 2, height * 0.76, depth + 1.5, width * 0.9, height * 0.16, 3, type.endsWith('positive') ? '#c58a48' : '#9eabb5', 0.85);
    for (let i = 0; i < 6; i++) cylinder(width * (0.1 + i * 0.16), height * 0.76, depth + 4, 3, 4, '#d8dce1');
  } else if (type === 'fuse') {
    box(width / 2, height * 0.72, depth + 3, width * 0.48, height * 0.15, 6, '#e1cba4');
    cylinder(width * 0.2, height * 0.72, depth + 4, 4, 4, '#bdc4ca');
    cylinder(width * 0.8, height * 0.72, depth + 4, 4, 4, '#bdc4ca');
  } else if (type === 'ac-panel' || type === 'dc-panel') {
    rim('#a7b8c7');
    for (let i = 0; i < 4; i++) {
      box(width * (0.22 + i * 0.18), height * 0.7, depth + 3, width * 0.12, height * 0.22, 6, '#dce3e8');
      box(width * (0.22 + i * 0.18), height * 0.68, depth + 7, width * 0.07, height * 0.09, 4, '#203043');
    }
  } else if (type === 'ac-load' || type === 'dc-load') {
    cylinder(width / 2, height * 0.72, depth + 2, Math.min(width, height) * 0.13, 4, '#c5d3db');
    cylinder(width / 2, height * 0.72, depth + 5, Math.min(width, height) * 0.08, 3, '#25384b');
  } else {
    // Blue electronics: cooling fins, lower ventilation grille, status display.
    for (let i = 1; i <= 6; i++) {
      box(1, height * i / 7, depth / 2, 4, 3, depth * 0.8, '#075278');
      box(width - 1, height * i / 7, depth / 2, 4, 3, depth * 0.8, '#075278');
      box(width * (0.2 + i * 0.085), height * 0.84, depth + 0.8, 3, height * 0.08, 1.6, '#092c43');
    }
    box(width / 2, height * 0.62, depth + 1, width * 0.25, height * 0.1, 2, '#102c40');
    box(width / 2, height * 0.62, depth + 2.1, width * 0.14, 2, 0.3, '#55d8b2');
  }
  return meshes;
}
