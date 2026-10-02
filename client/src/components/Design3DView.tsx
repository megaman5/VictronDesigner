import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Box, Focus, ArrowUp, RotateCcw, RotateCw, Plus, Minus, Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme-provider';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { componentLoadLabel, wireDisplayLabel } from '@/lib/design-display';
import type { WireGaugeFormat, LengthUnit } from '@/lib/wire-calculator';
import type { SchematicComponent, Wire, WireCalculation } from '@shared/schema';
import type { WireRoutingOptions } from '@/lib/wire-routing';
import { snapToGrid } from '@/lib/wire-routing';
import { getFuseType } from '@shared/protection-devices';
import { deviceDetails, fuseNameplate } from '@/lib/device-3d-details';
import { build3DLayout } from '@/lib/design-3d';

interface Props {
  components: SchematicComponent[];
  wires: Wire[];
  routingOptions: WireRoutingOptions;
  onComponentSelect: (component: SchematicComponent) => void;
  onWireSelect: (wire: Wire) => void;
  onBack: () => void;
  onReady?: () => void;
  onComponentMove?: (id: string, dx: number, dy: number) => void;
  selectedComponentId?: string;
  selectedWireId?: string;
  showWireLabels?: boolean;
  wireGaugeFormat?: WireGaugeFormat;
  lengthUnit?: LengthUnit;
  viewMode?: 'standard' | 'load';
  wireCalculations?: Record<string, WireCalculation>;

}

const wireColor = (polarity: string) => ({ positive: '#ff535b', negative: '#90a4b8',
  hot: '#ffad49', 'ac-hot': '#ffad49', neutral: '#e8edf5', ground: '#53df99',
}[polarity] ?? '#93a5ff');
/** Subtle, seamless wood grain drawn locally; no external texture download. */
function plywoodTexture(width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c9a570'; ctx.fillRect(0, 0, 1024, 512);
  for (let row = -20; row < 540; row += 2) {
    ctx.beginPath();
    for (let x = 0; x <= 1024; x += 4) {
      const y = row + 3 * Math.sin(x * Math.PI / 256 + row * 0.09) + 1.5 * Math.sin(x * Math.PI / 128 + row * 0.21);
      if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = row % 6 === 0 ? '#80552320' : '#f5d6a725';
    ctx.lineWidth = row % 6 === 0 ? 0.7 : 1.2; ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / 1100, height / 550);
  return texture;
}

function labelTexture(component: SchematicComponent, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = color === '#24333d' ? '#ffffff' : '#193a50'; ctx.textAlign = 'center';
  ctx.font = '600 42px Inter, sans-serif';
  const words = (component.name || component.type).split(' '); const lines: string[] = []; let line = '';
  for (const word of words) {
    if (ctx.measureText(`${line} ${word}`).width > 465 && line) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  lines.slice(0, 2).forEach((text, i) => ctx.fillText(text, 256, lines.length > 1 ? 48 + i * 48 : 80, 465));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function Design3DView({ components, wires, routingOptions, onComponentSelect, onWireSelect, onBack, onReady, onComponentMove, selectedComponentId, selectedWireId,
  showWireLabels = true, wireGaugeFormat = 'awg', lengthUnit = 'ft', viewMode = 'standard', wireCalculations = {},
}: Props) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{ fit: (top?: boolean) => void; rotate: (angle: number) => void; zoom: (factor: number) => void; refreshLabels: () => void; refreshSelection: () => void }>();
  const callbacks = useRef({ onComponentSelect, onWireSelect, onComponentMove, onReady });
  callbacks.current = { onComponentSelect, onWireSelect, onComponentMove, onReady };
  const cameraState = useRef<{ position: THREE.Vector3; target: THREE.Vector3 }>();
  const display = useRef({ showWireLabels, wireGaugeFormat, lengthUnit, viewMode, wireCalculations });
  display.current = { showWireLabels, wireGaugeFormat, lengthUnit, viewMode, wireCalculations };
  const [editing, setEditing] = useState(false);
  const editMode = useRef(false); editMode.current = editing;
  const selection = useRef({ selectedComponentId, selectedWireId });
  selection.current = { selectedComponentId, selectedWireId };
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [omitted, setOmitted] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element || !components.length) { setError(''); callbacks.current.onReady?.(); return; }
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: true }); }
    catch { setError('3D is unavailable in this browser. You can continue editing in 2D.'); callbacks.current.onReady?.(); return; }
    setError('');
    const layout = build3DLayout(components, wires, routingOptions);
    setOmitted(layout.omittedWires);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(dark ? '#0a1322' : '#edf0f3');
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 100000);
    camera.up.set(0, 0, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.domElement.setAttribute('aria-label', '3D system layout. Drag to orbit, scroll to zoom, right-drag to pan.');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.dataset.testid = 'canvas-3d';
    renderer.domElement.style.touchAction = 'none';
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 40; controls.maxDistance = 50000;
    const ambient = new THREE.HemisphereLight(0xd9edff, 0x697078, 2.1); scene.add(ambient);
    const light = new THREE.DirectionalLight(0xfff1de, 3); light.position.set(-300, 300, 900); scene.add(light);
    const { minX, minY, maxX, maxY } = layout.bounds;
    const center = new THREE.Vector3((minX + maxX) / 2, -(minY + maxY) / 2, 0);
    const width = maxX - minX, height = maxY - minY;
    light.position.copy(center).add(new THREE.Vector3(-width * 0.3, height * 0.2, 1200));
    light.target.position.copy(center); scene.add(light.target); light.castShadow = true;
    const span = Math.max(width, height) * 0.7;
    Object.assign(light.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 10000 });
    light.shadow.mapSize.set(2048, 2048); light.shadow.normalBias = 0.6; light.shadow.bias = -0.0001;
    const wood = new THREE.MeshStandardMaterial({ map: plywoodTexture(width, height), color: dark ? '#655446' : '#ffffff', roughness: 0.95 });
    const edge = new THREE.MeshStandardMaterial({ color: dark ? '#4e3926' : '#ab8051', roughness: 0.95 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width, height, 10), [edge, edge, edge, edge, wood, edge]);
    floor.receiveShadow = true; floor.position.copy(center); floor.position.z = -8; scene.add(floor);
    const gridPoints: number[] = [];
    const spacing = Math.max(40, Math.ceil(Math.max(width, height) / 100 / 20) * 20);
    for (let x = minX; x <= maxX; x += spacing) gridPoints.push(x, -minY, -2, x, -maxY, -2);
    for (let y = minY; y <= maxY; y += spacing) gridPoints.push(minX, -y, -2, maxX, -y, -2);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
    scene.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: dark ? '#ddc09a' : '#805e34', transparent: true, opacity: dark ? 0.09 : 0.12 })));
    const clickable: THREE.Object3D[] = [];
    const outlines = new Map<string, THREE.LineSegments>();
    for (const part of layout.parts) {
      const { component: c, width: w, height: h, depth, terminals } = part;
      const outlineGeometry = new THREE.BoxGeometry(w, h, depth);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(outlineGeometry), new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0 }));
      outlineGeometry.dispose(); edges.position.set(c.x + w / 2, -(c.y + h / 2), depth / 2);
      scene.add(edges); outlines.set(c.id, edges);
      const small = c.type.startsWith('busbar') || c.type === 'fuse' || c.type === 'smartshunt';
      const fusePlate = c.type === 'fuse' ? fuseNameplate(w, h, depth) : undefined;
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(fusePlate?.width ?? w * 0.7, fusePlate?.height ?? h * (c.type === 'switch' ? 0.13 : small ? 0.18 : 0.2)),
        new THREE.MeshBasicMaterial({ map: labelTexture(c, ['ac-panel', 'dc-panel'].includes(c.type) ? '#d5dbdc' : '#24333d'), toneMapped: false }));
      plaque.position.set(c.x + (fusePlate?.x ?? w / 2), -(c.y + (fusePlate?.y ?? h * (c.type === 'switch' ? 0.13 : c.type === 'solar-panel' ? 0.13 : 0.27))), fusePlate?.z ?? depth + 2.5);
      plaque.userData.component = c; scene.add(plaque); clickable.push(plaque);
      for (const detail of deviceDetails(c.type, w, h, depth, terminals, getFuseType(c))) {
        detail.position.x += c.x; detail.position.y -= c.y;
        detail.userData.component = c; scene.add(detail); clickable.push(detail);
      }
      if (c.type === 'switch') {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#f4f1e7'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'bold 23px Inter, sans-serif'; ctx.fillText('OFF', 128, 28);
        ctx.font = 'bold 20px Inter, sans-serif'; ctx.fillText('ON', 200, 57);
        ctx.strokeStyle = '#aab1ac'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(128, 128, 88, -Math.PI * 0.4, -0.23); ctx.stroke();
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const diameter = Math.min(w, h) * 0.66;
        const markings = new THREE.Mesh(new THREE.PlaneGeometry(diameter, diameter),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
        markings.position.set(c.x + w / 2, -(c.y + h * 0.55), depth + 2.9);
        markings.userData.component = c; scene.add(markings); clickable.push(markings);
      }
      for (const t of terminals) {
        const color = t.type.includes('negative') ? '#9bafc2' : t.type === 'ground' ? '#53df99'
          : t.type.includes('positive') ? '#ff535b' : '#ffad49';
        for (const [radius, thickness, z, tint, sides] of [[5.3, 2, depth + 1, color, 24], [4, 1, depth + 2.5, '#b4bdc2', 24], [2.7, 3, depth + 4.5, '#d6dade', 6]] as const) {
          const terminal = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, sides),
            new THREE.MeshStandardMaterial({ color: tint, metalness: 0.7, roughness: 0.3 }));
          terminal.rotation.x = Math.PI / 2; terminal.position.set(c.x + t.x, -(c.y + t.y), z);
          terminal.castShadow = true; terminal.userData.component = c; scene.add(terminal); clickable.push(terminal);
        }
      }
    }
    const cableMeshes = new Map<string, THREE.Mesh>();
    for (const { wire, points, radius } of layout.paths) {
      // Exact segment geometry avoids TubeGeometry sampling cutting across
      // short bends, which can make neighboring cables appear intertwined.
      const sections: THREE.BufferGeometry[] = [];
      for (let i = 1; i < points.length; i++) {
        const a = new THREE.Vector3(points[i - 1].x, -points[i - 1].y, points[i - 1].z);
        const b = new THREE.Vector3(points[i].x, -points[i].y, points[i].z);
        const direction = b.clone().sub(a), length = direction.length();
        if (length < 0.001) continue;
        const segment = new THREE.CylinderGeometry(radius, radius, length, 10);
        segment.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
        segment.translate(...a.add(b).multiplyScalar(0.5).toArray()); sections.push(segment);
      }
      for (const point of points.slice(1, -1)) {
        const bend = new THREE.SphereGeometry(radius, 10, 6);
        bend.translate(point.x, -point.y, point.z); sections.push(bend);
      }
      if (!sections.length) continue;
      const geometry = mergeGeometries(sections);
      sections.forEach(section => section.dispose());
      const cable = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: !dark && wire.polarity === 'negative' ? '#253444' : wireColor(wire.polarity), roughness: 0.4, metalness: 0.15,
      }));
      cable.userData.wire = wire; scene.add(cable); clickable.push(cable); cableMeshes.set(wire.id, cable);
    }
    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    labelLayer.dataset.testid = 'labels-3d'; element.appendChild(labelLayer);
    const labels: Array<{ element: HTMLButtonElement; position: THREE.Vector3 }> = [];
    const addLabel = (text: string, id: string, position: THREE.Vector3, onClick: () => void) => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = text; button.title = text; button.dataset.testid = id;
      button.style.cssText = 'position:absolute;pointer-events:auto;white-space:nowrap;border:1px solid #55738f;border-radius:5px;background:#0b172beb;color:#e5f2ff;font:600 11px Inter,sans-serif;padding:4px 7px;box-shadow:0 2px 5px #0005';
      if (!dark) { button.style.background = '#fffffff0'; button.style.color = '#172b40'; button.style.borderColor = '#9aaabc'; }
      button.addEventListener('click', onClick); labelLayer.appendChild(button); labels.push({ element: button, position });
      return button;
    };
    const highlight = () => {
      for (const object of clickable) {
        const mesh = object as THREE.Mesh;
        const active = !!selection.current.selectedComponentId && object.userData.component?.id === selection.current.selectedComponentId || !!selection.current.selectedWireId && object.userData.wire?.id === selection.current.selectedWireId;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(m => (m as THREE.MeshStandardMaterial).emissive?.set(active ? '#245b86' : '#000000'));
      }
      outlines.forEach((line, id) => {
        const material = line.material as THREE.LineBasicMaterial;
        const active = id === selection.current.selectedComponentId;
        material.color.set(active ? '#38bdf8' : '#86badd'); material.opacity = active ? 1 : 0;
        line.scale.setScalar(active ? 1.035 : 1);
      });
    };
    const rebuildLabels = () => {
      labelLayer.replaceChildren(); labels.length = 0;
      highlight();
      const settings = display.current;
      if (settings.showWireLabels) for (const { wire, points, radius } of layout.paths) {
        let a = points[0], b = points[points.length - 1], longest = -1;
        for (let i = 1; i < points.length; i++) {
          if (points[i].z !== points[i - 1].z) continue;
          const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
          if (length > longest) { longest = length; a = points[i - 1]; b = points[i]; }
        }
        const button = addLabel(wireDisplayLabel(wire, settings.viewMode, settings.wireGaugeFormat, settings.lengthUnit, settings.wireCalculations[wire.id]),
          `label-3d-wire-${wire.id}`, new THREE.Vector3((a.x + b.x) / 2, -(a.y + b.y) / 2, (a.z + b.z) / 2 + radius + 7),
          () => { setSelected(`${wire.gauge} cable`); callbacks.current.onWireSelect(wire); });
        const material = cableMeshes.get(wire.id)?.material as THREE.MeshStandardMaterial;
        button.addEventListener('mouseenter', () => { material?.emissive.set('#536779'); render(); });
        button.addEventListener('mouseleave', () => { highlight(); render(); });
      }
      if (settings.viewMode === 'load') for (const part of layout.parts) {
        const value = componentLoadLabel(part.component.type, part.component.properties);
        if (value) addLabel(`${part.component.name}: ${value}`, `label-3d-component-${part.component.id}`,
          new THREE.Vector3(part.component.x + part.width / 2, -(part.component.y + part.height / 2), part.depth + 9),
          () => callbacks.current.onComponentSelect(part.component));
      }
    };
    const positionLabels = () => {
      const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (const label of labels) {
        const p = label.position.clone().project(camera);
        const el = label.element; el.style.display = '';
        const w = el.offsetWidth, h = el.offsetHeight;
        const x = (p.x + 1) * element.clientWidth / 2 - w / 2;
        const y = (1 - p.y) * element.clientHeight / 2 - h / 2;
        const placement = [0, -28, 28, -56, 56, -84, 84].map(offset => ({ x, y: y + offset, w, h }))
          .find(r => r.x >= 0 && r.x + w <= element.clientWidth && r.y >= 90 && r.y + h < element.clientHeight - 50 &&
            !occupied.some(o => r.x < o.x + o.w + 4 && r.x + w + 4 > o.x && r.y < o.y + o.h + 4 && r.y + h + 4 > o.y));
        if (p.z < -1 || p.z > 1 || !placement) { el.style.display = 'none'; continue; }
        occupied.push(placement); el.style.transform = `translate(${placement.x}px, ${placement.y}px)`;
      }
    };
    let frame = 0, disposed = false, announcedReady = false;
    const render = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); positionLabels();
        if (!announcedReady) { announcedReady = true; callbacks.current.onReady?.(); } });
    };
    const fit = (top = false) => {
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const direction = (top ? new THREE.Vector3(0, -0.001, 1)
        : new THREE.Vector3(0, -0.50, 0.86)).normalize();
      const right = camera.up.clone().cross(direction).normalize();
      const up = direction.clone().cross(right).normalize();
      let distance = 100;
      for (const x of [minX, maxX]) for (const y of [-minY, -maxY]) for (const z of [0, Math.max(80, ...layout.paths.flatMap(p => p.points.map(v => v.z + p.radius)))]) {
        const corner = new THREE.Vector3(x, y, z).sub(center);
        distance = Math.max(distance,
          Math.abs(corner.dot(right)) / Math.tan(hFov / 2) + corner.dot(direction),
          Math.abs(corner.dot(up)) / Math.tan(vFov / 2) + corner.dot(direction));
      }
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance * 1.18);
      controls.update(); render();
    };
    actions.current = { fit, refreshSelection: () => { highlight(); render(); }, refreshLabels: () => { rebuildLabels(); render(); }, rotate: angle => {
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      camera.position.copy(controls.target).add(offset); controls.update(); render();
    }, zoom: factor => { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); render(); } };
    rebuildLabels();
    let initial = true, lastWidth = 0, lastHeight = 0;
    const resize = () => {
      const w = element.clientWidth, h = element.clientHeight;
      if (!w || !h || (w === lastWidth && h === lastHeight)) return;
      lastWidth = w; lastHeight = h;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (initial) {
        initial = false;
        if (cameraState.current) { camera.position.copy(cameraState.current.position); controls.target.copy(cameraState.current.target); controls.update(); }
        else fit();
      } else fit();
      render();
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    controls.addEventListener('change', render);
    let pointer = { x: 0, y: 0 };
    const ray = new THREE.Raycaster();
    const setRay = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    };
    let drag: { component: SchematicComponent; start: THREE.Vector3; plane: THREE.Plane; ghost: THREE.Mesh; dx: number; dy: number; pointerId: number } | undefined;
    const clearDrag = () => {
      if (!drag) return;
      scene.remove(drag.ghost); drag.ghost.geometry.dispose(); (drag.ghost.material as THREE.Material).dispose();
      if (renderer.domElement.hasPointerCapture(drag.pointerId)) renderer.domElement.releasePointerCapture(drag.pointerId);
      drag = undefined; controls.enabled = true; renderer.domElement.style.cursor = ''; render();
    };
    const down = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (event.button !== 0 || !editMode.current || !callbacks.current.onComponentMove) return;
      setRay(event);
      const hit = ray.intersectObjects(clickable).find(h => h.object.userData.component)?.object;
      const component = hit?.userData.component as SchematicComponent | undefined;
      if (!component) return;
      const part = layout.parts.find(p => p.component.id === component.id)!;
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -part.depth);
      const start = ray.ray.intersectPlane(plane, new THREE.Vector3()); if (!start) return;
      const ghost = new THREE.Mesh(new THREE.BoxGeometry(part.width, part.height, part.depth),
        new THREE.MeshBasicMaterial({ color: '#0ea5e9', transparent: true, opacity: 0.4, depthTest: false }));
      ghost.position.set(component.x + part.width / 2, -(component.y + part.height / 2), part.depth / 2); ghost.renderOrder = 10;
      scene.add(ghost); drag = { component, start, plane, ghost, dx: 0, dy: 0, pointerId: event.pointerId };
      controls.enabled = false; event.stopImmediatePropagation();
      renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = 'grabbing'; render();
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      setRay(event); const point = ray.ray.intersectPlane(drag.plane, new THREE.Vector3()); if (!point) return;
      const dx = snapToGrid(drag.component.x + point.x - drag.start.x) - drag.component.x;
      const dy = snapToGrid(drag.component.y - point.y + drag.start.y) - drag.component.y;
      drag.ghost.position.x += dx - drag.dx; drag.ghost.position.y -= dy - drag.dy;
      drag.dx = dx; drag.dy = dy; render();
    };
    const up = (event: PointerEvent) => {
      if (drag) {
        if (event.pointerId !== drag.pointerId) return;
        const { component, dx, dy } = drag; const moved = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5;
        clearDrag();
        if (moved && (dx || dy)) callbacks.current.onComponentMove?.(component.id, dx, dy);
        setSelected(component.name); callbacks.current.onComponentSelect(moved ? { ...component, x: component.x + dx, y: component.y + dy } : component);
        return;
      }
      if (event.button !== 0 || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) return;
      setRay(event); const hit = ray.intersectObjects(clickable)[0]?.object;
      if (hit?.userData.component) { setSelected(hit.userData.component.name); callbacks.current.onComponentSelect(hit.userData.component); }
      else if (hit?.userData.wire) { setSelected(`${hit.userData.wire.gauge} cable`); callbacks.current.onWireSelect(hit.userData.wire); }
    };
    const cancel = () => clearDrag();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clearDrag(); };
    window.addEventListener('keydown', key);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointercancel', cancel);
    renderer.domElement.addEventListener('lostpointercapture', cancel);
    const contextLost = (event: Event) => { event.preventDefault(); setError('The 3D graphics connection was lost. Switch to 2D, then reopen 3D to retry.'); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('pointerdown', down, true);
    renderer.domElement.addEventListener('pointerup', up);
    return () => {
      clearDrag(); window.removeEventListener('keydown', key);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointercancel', cancel);
      renderer.domElement.removeEventListener('lostpointercapture', cancel);
      disposed = true; cancelAnimationFrame(frame);
      cameraState.current = { position: camera.position.clone(), target: controls.target.clone() };
      observer.disconnect(); controls.dispose(); actions.current = undefined;
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('pointerdown', down, true); renderer.domElement.removeEventListener('pointerup', up);
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => materials.add(m));
      });
      materials.forEach(material => { (material as THREE.MeshStandardMaterial).map?.dispose(); material.dispose(); });
      light.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); labelLayer.remove();
    };
  }, [components, wires, routingOptions, dark]);

  useEffect(() => { actions.current?.refreshSelection(); }, [selectedComponentId, selectedWireId]);

  useEffect(() => { actions.current?.refreshLabels(); }, [showWireLabels, wireGaugeFormat, lengthUnit, viewMode, wireCalculations]);

  return <div className="flex-1 min-h-0 relative bg-slate-100 text-slate-900 dark:bg-[#0a1322] dark:text-slate-100" data-testid="view-3d" data-theme={theme}>
    <div ref={host} className="absolute inset-0" />
    <div className="absolute top-4 left-4 right-4 flex flex-wrap items-start justify-between gap-3 pointer-events-none">
      <div className="rounded-xl border border-slate-300 bg-white/90 dark:border-white/10 dark:bg-slate-950/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-sm font-semibold"><Box className="h-4 w-4 text-sky-600 dark:text-sky-400" /> System in 3D</div>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{components.length} components · {wires.length} wires · Illustrative depth</p>
        {selected && <p className="mt-2 text-xs text-sky-700 dark:text-sky-300" aria-live="polite">Selected: {selected}</p>}
      </div>
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-300 bg-white/90 dark:border-white/10 dark:bg-slate-950/80 p-1.5 pointer-events-auto">
        {onComponentMove && <Button size="sm" variant={editing ? 'default' : 'ghost'} aria-pressed={editing}
          data-testid="button-edit-3d" onClick={() => setEditing(value => !value)} className="h-8 gap-1.5"><Move className="h-4 w-4" />{editing ? 'Editing layout' : 'Edit layout'}</Button>}
        {[
          { label: 'Fit system', icon: Focus, run: () => actions.current?.fit() },
          { label: 'Top view', icon: ArrowUp, run: () => actions.current?.fit(true) },
          { label: 'Rotate left', icon: RotateCcw, run: () => actions.current?.rotate(-Math.PI / 8) },
          { label: 'Rotate right', icon: RotateCw, run: () => actions.current?.rotate(Math.PI / 8) },
          { label: 'Zoom in', icon: Plus, run: () => actions.current?.zoom(0.8) },
          { label: 'Zoom out', icon: Minus, run: () => actions.current?.zoom(1.25) },
        ].map(({ label, icon: Icon, run }) => <Button key={label} variant="ghost" size="icon" aria-label={label} title={label} onClick={run} className="h-8 w-8 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white"><Icon className="h-4 w-4" /></Button>)}
      </div>
    </div>
    {(error || !components.length) && <div className="absolute inset-0 flex items-center justify-center bg-slate-100/95 dark:bg-[#0a1322]/95 p-6">
      <div className="max-w-sm text-center"><Box className="mx-auto mb-4 h-10 w-10 text-sky-600 dark:text-sky-400" />
        <h2 className="font-semibold text-lg">{error ? '3D view unavailable' : 'Your system, in a new dimension'}</h2>
        <p className="my-3 text-sm text-slate-600 dark:text-slate-400" role={error ? 'alert' : undefined}>{error || 'Add components to your 2D design, then explore them here.'}</p>
        <Button onClick={onBack}>Back to 2D editor</Button>
      </div>
    </div>}
    {!!components.length && !error && <div className="absolute bottom-4 left-4 right-4 flex flex-wrap justify-between gap-2 text-xs text-slate-600 dark:text-slate-400 pointer-events-none">
      <span className="rounded-lg bg-white/90 dark:bg-slate-950/80 px-3 py-2">{editing ? 'Drag a part to preview placement · Release to move · Esc to cancel · Drag empty space to orbit' : 'Drag to orbit · Scroll / pinch to zoom · Right-drag / two fingers to pan · Click a part to inspect'}</span>
      {omitted > 0 && <span className="rounded-lg bg-white/90 dark:bg-slate-950/80 px-3 py-2">{omitted} wire connections need valid terminals in 2D</span>}
    </div>}
  </div>;
}
