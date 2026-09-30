import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Box, Focus, ArrowUp, RotateCcw, RotateCw, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SchematicComponent, Wire } from '@shared/schema';
import type { WireRoutingOptions } from '@/lib/wire-routing';
import { build3DLayout } from '@/lib/design-3d';

interface Props {
  components: SchematicComponent[];
  wires: Wire[];
  routingOptions: WireRoutingOptions;
  onComponentSelect: (component: SchematicComponent) => void;
  onWireSelect: (wire: Wire) => void;
  onBack: () => void;
}

const wireColor = (polarity: string) => ({ positive: '#ff535b', negative: '#90a4b8',
  hot: '#ffad49', 'ac-hot': '#ffad49', neutral: '#e8edf5', ground: '#53df99',
}[polarity] ?? '#93a5ff');
const bodyColor = (type: string) => type.startsWith('busbar') ? (type.endsWith('positive') ? '#bb7541' : '#394658')
  : type === 'battery' ? '#354352' : type === 'solar-panel' ? '#14375c'
  : ['fuse', 'switch', 'dc-load', 'ac-load'].includes(type) ? '#495c70' : '#007dbb';

function labelTexture(component: SchematicComponent, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color; ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = '#ffffff18'; ctx.fillRect(20, 20, 472, 3);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
  ctx.font = '600 38px Inter, sans-serif';
  const name = component.name || component.type;
  const words = name.split(' '); const lines: string[] = []; let line = '';
  for (const word of words) {
    if (ctx.measureText(`${line} ${word}`).width > 440 && line) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((text, i) => ctx.fillText(text, 256, 100 + i * 45, 440));
  ctx.font = '22px Inter, sans-serif'; ctx.fillStyle = '#c4dfef';
  ctx.fillText(component.type.replaceAll('-', ' ').toUpperCase(), 256, 255, 440);
  ctx.fillStyle = '#4aeca4'; ctx.beginPath(); ctx.arc(256, 285, 5, 0, Math.PI * 2); ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function Design3DView({ components, wires, routingOptions, onComponentSelect, onWireSelect, onBack }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{ fit: (top?: boolean) => void; rotate: (angle: number) => void; zoom: (factor: number) => void }>();
  const callbacks = useRef({ onComponentSelect, onWireSelect });
  callbacks.current = { onComponentSelect, onWireSelect };
  const cameraState = useRef<{ position: THREE.Vector3; target: THREE.Vector3 }>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [omitted, setOmitted] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element || !components.length) { setError(''); return; }
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { setError('3D is unavailable in this browser. You can continue editing in 2D.'); return; }
    setError('');
    const layout = build3DLayout(components, wires, routingOptions);
    setOmitted(layout.omittedWires);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#0a1322');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100000);
    camera.up.set(0, 0, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', '3D system layout. Drag to orbit, scroll to zoom, right-drag to pan.');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.dataset.testid = 'canvas-3d';
    renderer.domElement.style.touchAction = 'none';
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 40; controls.maxDistance = 50000;
    const ambient = new THREE.HemisphereLight(0xd9edff, 0x26344b, 2.6); scene.add(ambient);
    const light = new THREE.DirectionalLight(0xffffff, 3.2); light.position.set(-300, 300, 900); scene.add(light);
    const { minX, minY, maxX, maxY } = layout.bounds;
    const center = new THREE.Vector3((minX + maxX) / 2, -(minY + maxY) / 2, 0);
    const width = maxX - minX, height = maxY - minY;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width, height, 6),
      new THREE.MeshStandardMaterial({ color: '#142238', roughness: 0.95 }));
    floor.position.copy(center); floor.position.z = -6; scene.add(floor);
    const gridPoints: number[] = [];
    const spacing = Math.max(40, Math.ceil(Math.max(width, height) / 100 / 20) * 20);
    for (let x = minX; x <= maxX; x += spacing) gridPoints.push(x, -minY, -2, x, -maxY, -2);
    for (let y = minY; y <= maxY; y += spacing) gridPoints.push(minX, -y, -2, maxX, -y, -2);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
    scene.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x31465f })));
    const clickable: THREE.Object3D[] = [];
    for (const part of layout.parts) {
      const { component: c, width: w, height: h, depth, terminals } = part;
      const color = bodyColor(c.type);
      const side = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.25 });
      const face = new THREE.MeshStandardMaterial({ map: labelTexture(c, color), roughness: 0.65 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [side, side, side, side, face, side]);
      box.position.set(c.x + w / 2, -(c.y + h / 2), depth / 2);
      box.userData.component = c; scene.add(box); clickable.push(box);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: '#86badd', transparent: true, opacity: 0.35 }));
      edges.position.copy(box.position); scene.add(edges);
      for (const t of terminals) {
        const color = t.type.includes('negative') ? '#9bafc2' : t.type === 'ground' ? '#53df99'
          : t.type.includes('positive') ? '#ff535b' : '#ffad49';
        const terminal = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 8),
          new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 }));
        terminal.position.set(c.x + t.x, -(c.y + t.y), depth + 5);
        terminal.userData.component = c; scene.add(terminal); clickable.push(terminal);
      }
    }
    for (const { wire, points } of layout.paths) {
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
        curve.add(new THREE.LineCurve3(new THREE.Vector3(a.x, -a.y, a.z), new THREE.Vector3(b.x, -b.y, b.z)));
      }
      if (!curve.curves.length) continue;
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(500, Math.max(24, points.length * 10)), 2.3, 6, false),
        new THREE.MeshStandardMaterial({ color: wireColor(wire.polarity), roughness: 0.4, metalness: 0.15 }));
      cable.userData.wire = wire; scene.add(cable); clickable.push(cable);
    }
    let frame = 0, disposed = false;
    const render = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; renderer.render(scene, camera); });
    };
    const fit = (top = false) => {
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const direction = (top ? new THREE.Vector3(0, -0.001, 1)
        : new THREE.Vector3(0.30, -0.50, 0.86)).normalize();
      const right = camera.up.clone().cross(direction).normalize();
      const up = direction.clone().cross(right).normalize();
      let distance = 100;
      for (const x of [minX, maxX]) for (const y of [-minY, -maxY]) for (const z of [0, 80]) {
        const corner = new THREE.Vector3(x, y, z).sub(center);
        distance = Math.max(distance,
          Math.abs(corner.dot(right)) / Math.tan(hFov / 2) + corner.dot(direction),
          Math.abs(corner.dot(up)) / Math.tan(vFov / 2) + corner.dot(direction));
      }
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance * 1.18);
      controls.update(); render();
    };
    actions.current = { fit, rotate: angle => {
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      camera.position.copy(controls.target).add(offset); controls.update(); render();
    }, zoom: factor => { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); render(); } };
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
    const down = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
    const up = (event: PointerEvent) => {
      if (event.button !== 0 || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObjects(clickable)[0]?.object;
      if (hit?.userData.component) { setSelected(hit.userData.component.name); callbacks.current.onComponentSelect(hit.userData.component); }
      else if (hit?.userData.wire) { setSelected(`${hit.userData.wire.gauge} cable`); callbacks.current.onWireSelect(hit.userData.wire); }
    };
    const contextLost = (event: Event) => { event.preventDefault(); setError('The 3D graphics connection was lost. Switch to 2D, then reopen 3D to retry.'); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointerup', up);
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      cameraState.current = { position: camera.position.clone(), target: controls.target.clone() };
      observer.disconnect(); controls.dispose(); actions.current = undefined;
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', up);
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => materials.add(m));
      });
      materials.forEach(material => { (material as THREE.MeshStandardMaterial).map?.dispose(); material.dispose(); });
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [components, wires, routingOptions]);

  return <div className="flex-1 min-h-0 relative bg-[#0a1322] text-slate-100" data-testid="view-3d">
    <div ref={host} className="absolute inset-0" />
    <div className="absolute top-4 left-4 right-4 flex flex-wrap items-start justify-between gap-3 pointer-events-none">
      <div className="rounded-xl border border-white/10 bg-slate-950/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-sm font-semibold"><Box className="h-4 w-4 text-sky-400" /> System in 3D</div>
        <p className="mt-1 text-xs text-slate-400">{components.length} components · {wires.length} wires · Illustrative depth</p>
        {selected && <p className="mt-2 text-xs text-sky-300" aria-live="polite">Selected: {selected}</p>}
      </div>
      <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-slate-950/80 p-1.5 pointer-events-auto">
        {[
          { label: 'Fit system', icon: Focus, run: () => actions.current?.fit() },
          { label: 'Top view', icon: ArrowUp, run: () => actions.current?.fit(true) },
          { label: 'Rotate left', icon: RotateCcw, run: () => actions.current?.rotate(-Math.PI / 8) },
          { label: 'Rotate right', icon: RotateCw, run: () => actions.current?.rotate(Math.PI / 8) },
          { label: 'Zoom in', icon: Plus, run: () => actions.current?.zoom(0.8) },
          { label: 'Zoom out', icon: Minus, run: () => actions.current?.zoom(1.25) },
        ].map(({ label, icon: Icon, run }) => <Button key={label} variant="ghost" size="icon" aria-label={label} title={label} onClick={run} className="h-8 w-8 hover:bg-white/10 hover:text-white"><Icon className="h-4 w-4" /></Button>)}
      </div>
    </div>
    {(error || !components.length) && <div className="absolute inset-0 flex items-center justify-center bg-[#0a1322]/95 p-6">
      <div className="max-w-sm text-center"><Box className="mx-auto mb-4 h-10 w-10 text-sky-400" />
        <h2 className="font-semibold text-lg">{error ? '3D view unavailable' : 'Your system, in a new dimension'}</h2>
        <p className="my-3 text-sm text-slate-400" role={error ? 'alert' : undefined}>{error || 'Add components to your 2D design, then explore them here.'}</p>
        <Button onClick={onBack}>Back to 2D editor</Button>
      </div>
    </div>}
    {!!components.length && !error && <div className="absolute bottom-4 left-4 right-4 flex flex-wrap justify-between gap-2 text-xs text-slate-400 pointer-events-none">
      <span className="rounded-lg bg-slate-950/80 px-3 py-2">Drag to orbit · Scroll / pinch to zoom · Right-drag / two fingers to pan · Click a part to inspect</span>
      {omitted > 0 && <span className="rounded-lg bg-slate-950/80 px-3 py-2">{omitted} wire connections need valid terminals in 2D</span>}
    </div>}
  </div>;
}
