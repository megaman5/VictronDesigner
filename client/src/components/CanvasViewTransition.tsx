import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Keep the editor mounted and wait for the first WebGL frame before blending. */
export function CanvasViewTransition({ mode, editor, render3D }: {
  mode: '2d' | '3d'; editor: ReactNode; render3D: (onReady: () => void) => ReactNode;
}) {
  const [mounted, setMounted] = useState(mode === '3d');
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (mode === '3d') { setMounted(true); return; }
    const timer = window.setTimeout(() => { setMounted(false); setReady(false); }, 2140);
    return () => window.clearTimeout(timer);
  }, [mode]);
  const show3D = mode === '3d' && ready;
  const previous = useRef(show3D);
  const [sweep, setSweep] = useState<{ id: number; reverse: boolean } | null>(null);
  useEffect(() => {
    if (previous.current === show3D) return;
    previous.current = show3D;
    setSweep(current => ({ id: (current?.id ?? 0) + 1, reverse: !show3D }));
    const timer = window.setTimeout(() => setSweep(null), 2100);
    return () => window.clearTimeout(timer);
  }, [show3D]);
  return <div className="canvas-view-transition" data-testid="canvas-view-transition" data-mode={show3D ? '3d' : '2d'}>
    <div className="canvas-view-layer canvas-view-editor" aria-hidden={show3D}
      ref={element => { if (element) element.inert = mode !== '2d'; }}>
      {editor}
    </div>
    {mounted && <div className="canvas-view-layer canvas-view-model" aria-hidden={!show3D}
      ref={element => { if (element) element.inert = !show3D; }}>
      {render3D(onReady)}
    </div>}
    {sweep && <div key={sweep.id} className={`canvas-view-flourish${sweep.reverse ? ' is-reversed' : ''}`} aria-hidden="true"><div className="canvas-view-sweep" /><div className="canvas-view-halo" /></div>}
    {mode === '3d' && !ready && <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border bg-background/95 px-4 py-2 text-sm shadow-lg" role="status">Preparing 3D view…</div>}
  </div>;
}

export function View3DLoadError({ onReady }: { onReady?: () => void }) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return <div className="flex-1 flex items-center justify-center bg-background p-6 text-sm" role="alert">
    The 3D view could not load. Switch to the 2D editor and refresh to try again.
  </div>;
}
