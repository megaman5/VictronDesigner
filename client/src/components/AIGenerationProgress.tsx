import { useEffect, useId, useMemo, useState } from 'react';
import { Check, Loader2, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ComponentIcon } from '@/components/component-icons';
import { parseStreamingDesign } from '@/lib/streaming-design';

export interface AIGenerationProgressState {
  iteration: number;
  maxIterations: number;
  phase: 'waiting' | 'planning' | 'drawing' | 'checking' | 'refining';
  startedAt: number;
  lastActivityAt?: number;
  streamingText?: string;
  receivedCharacters?: number;
  score?: number;
  errorCount?: number;
  warningCount?: number;
  isBest?: boolean;
  usedFallback?: boolean;
}

const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const labels = { waiting: 'Waiting for the AI', planning: 'Planning your system', drawing: 'Drawing equipment and wiring', checking: 'Checking electrical connections', refining: 'Improving the design' };

export function AIGenerationProgress({ progress, onStop }: { progress: AIGenerationProgressState; onStop: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const draft = useMemo(() => parseStreamingDesign(progress.streamingText ?? ''), [progress.streamingText]);
  const patternId = useId().replaceAll(':', '');
  const positions = new Map(draft.components.map(c => [c.id, c]));
  const visibleWires = draft.wires.filter(w => positions.has(w.fromComponentId) && positions.has(w.toComponentId));
  const minX = Math.min(...draft.components.map(c => c.x)) - 30;
  const minY = Math.min(...draft.components.map(c => c.y)) - 30;
  const width = Math.max(...draft.components.map(c => c.x)) - minX + 170;
  const height = Math.max(...draft.components.map(c => c.y)) - minY + 110;
  const activeStep = progress.phase === 'checking' ? 2 : progress.phase === 'drawing' ? 1 : 0;
  return <div className="space-y-4 py-2" data-testid="ai-generating-state">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-2 text-base font-semibold" role="status"><Loader2 className="h-4 w-4 animate-spin text-primary" />{labels[progress.phase]}</p>
        <p className="mt-1 text-xs text-muted-foreground">Pass {progress.iteration} of up to {progress.maxIterations}{progress.usedFallback ? ' · Using backup AI' : ''}</p>
      </div>
      <span className="font-mono text-sm tabular-nums text-muted-foreground" aria-label="Elapsed time">{duration(now - progress.startedAt)}</span>
    </div>
    <div className="grid grid-cols-3 gap-2" aria-label="Generation stages">
      {['Plan', 'Draw', 'Check'].map((label, index) => <div key={label} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${index === activeStep ? 'bg-primary/10 text-primary font-semibold' : 'bg-muted/50 text-muted-foreground'}`}>
        {index < activeStep ? <Check className="h-3 w-3" /> : <span className={`h-1.5 w-1.5 rounded-full ${index === activeStep ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40'}`} />}{label}
      </div>)}
    </div>
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs"><span className="font-medium">Live draft</span><span className="text-muted-foreground">{draft.components.length} equipment · {visibleWires.length} wires</span></div>
      {draft.components.length ? <svg role="img" aria-label="AI draft schematic" className="h-64 w-full" viewBox={`${minX} ${minY} ${width} ${height}`}>
        <defs><pattern id={patternId} width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" className="fill-muted-foreground/20" /></pattern></defs>
        <rect x={minX} y={minY} width={width} height={height} fill={`url(#${patternId})`} />
        {visibleWires.map((w, i) => {
          const from = positions.get(w.fromComponentId)!, to = positions.get(w.toComponentId)!;
          const x1 = from.x + 140, y1 = from.y + 40, x2 = to.x, y2 = to.y + 40, mid = (x1 + x2) / 2;
          return <path data-testid="ai-draft-wire" key={i} d={`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`} fill="none" stroke={{ positive: '#ef4444', negative: '#64748b', hot: '#f97316', neutral: '#3b82f6', ground: '#22c55e' }[w.polarity ?? ''] ?? '#94a3b8'} strokeWidth="2" vectorEffect="non-scaling-stroke" />;
        })}
        {draft.components.map(c => <g key={c.id} data-testid="ai-draft-component">
          <rect x={c.x} y={c.y} width="140" height="80" rx="8" className="fill-background stroke-primary/50" strokeWidth="1.5" />
          <svg x={c.x + 10} y={c.y + 12} width="28" height="28" className="text-primary"><ComponentIcon type={c.type} className="h-full w-full" /></svg>
          <text x={c.x + 10} y={c.y + 59} fontSize="11" className="fill-foreground">{c.name.slice(0, 21)}{c.name.length > 21 ? '…' : ''}</text>
          <text x={c.x + 45} y={c.y + 30} fontSize="9" className="fill-muted-foreground">{c.type.replaceAll('-', ' ').slice(0, 16)}</text>
        </g>)}
      </svg> : <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center">
        <Sparkles className="h-7 w-7 animate-pulse text-primary" />
        <p className="text-sm text-muted-foreground">Equipment will appear here as the AI sends the design.</p>
        <p className="text-xs text-muted-foreground">Planning can take a few minutes.</p>
      </div>}
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">Draft preview · Electrical checks are still in progress.</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{progress.lastActivityAt ? `Last response ${duration(now - progress.lastActivityAt)} ago` : 'Waiting for response data'}{progress.receivedCharacters ? ` · ${progress.receivedCharacters.toLocaleString()} characters received` : ''}</span>
      {progress.errorCount !== undefined && <span>{progress.errorCount} errors · {progress.warningCount ?? 0} warnings in last check</span>}
    </div>
    <div className="flex justify-end"><Button type="button" variant="outline" onClick={onStop} className="gap-2"><Square className="h-3 w-3" />Stop generation</Button></div>
  </div>;
}
