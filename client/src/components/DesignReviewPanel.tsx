import { useState } from 'react';
import { AlertCircle, CheckCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { reviewHeadline, type DesignReviewResult, type ReviewIssue, type ReviewStatus } from '@shared/design-review';
import type { ValidationResult, ValidationIssue } from '@shared/schema';

interface DesignReviewPanelProps {
  components: any[]; wires: any[]; systemVoltage: number;
  validationResult?: ValidationResult | null; status?: ReviewStatus; error?: string;
  onValidate?: () => void | Promise<void>; onIssueClick?: (issue: ValidationIssue) => void;
  onApplyGaugeFix?: (wireId: string, gauge: string) => void;
}
export function DesignReviewPanel({components, wires, systemVoltage, validationResult = null, status = 'unchecked', error, onValidate, onIssueClick, onApplyGaugeFix}: DesignReviewPanelProps) {
  const [filter, setFilter] = useState('all');
  const [objectFilter, setObjectFilter] = useState('');
  const [fix, setFix] = useState<{wireId: string; previous: string; gauge: string} | null>(null);
  const issues = validationResult?.issues ?? [];
  const errors = issues.filter(i => i.severity === 'error').length;
  const unresolved = issues.filter(i => i.category === 'unresolved').length;
  const current = status === 'current';
  const visible = issues.filter(i => filter === 'all' || (filter === 'electrical' ? !['layout','ai-quality'].includes(i.category) : filter === i.category || filter === i.severity))
    .filter(i => !objectFilter || [...(i.componentIds ?? []), ...(i.wireIds ?? []), i.wireId ?? ''].some(id => id.includes(objectFilter)))
    .sort((a,b) => ({error:0,warning:1,info:2}[a.severity] - {error:0,warning:1,info:2}[b.severity]));
  const analysis = (validationResult as DesignReviewResult | null)?.analysis;
  const assumptions = Array.from(new Set([...(analysis?.assumptions ?? []), ...Object.values(analysis?.wires ?? {}).flatMap(w => w.assumptions)]));
  return <div className="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle className="flex gap-2 items-center">{current && errors === 0 && unresolved === 0 ? <CheckCircle className="h-5 w-5"/> : <AlertCircle className="h-5 w-5"/>}Design Review</CardTitle>
        <CardDescription role="status" aria-live="polite">{reviewHeadline(validationResult, status)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && status === 'failed' && <p className="text-sm text-destructive">{error}</p>}
        {current && <div className="flex flex-wrap gap-2"><Badge variant="destructive">{errors} errors</Badge><Badge variant="outline">{unresolved} unresolved</Badge><Badge variant="outline">{issues.filter(i => i.severity === 'warning').length} warnings</Badge></div>}
        <p className="text-sm text-muted-foreground">{components.length} components · {wires.length} wires · {systemVoltage} V DC</p>
        {wires.some(w => w.lengthEstimated) && <p className="text-sm text-muted-foreground">AI-estimated wire lengths: {wires.filter(w => w.lengthEstimated).length}. Calculations use these values. Edit a wire's length or ask AI Iterate to change it.</p>}
        {!current && validationResult && <p className="text-sm text-muted-foreground">Previous review results are hidden. Check the current design to see its issues.</p>}
        <Button variant="outline" disabled={status === 'checking'} onClick={() => void onValidate?.()}>{status === 'checking' ? 'Checking…' : status === 'failed' ? 'Retry review' : 'Check current design'}</Button>
      </CardContent>
    </Card>
    {current && validationResult && <Card><CardHeader><CardTitle>Issues and unresolved calculations</CardTitle><CardDescription>Select an issue to locate the affected equipment or wire.</CardDescription></CardHeader><CardContent className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <select aria-label="Filter review issues" className="rounded border bg-background p-2 text-sm" value={filter} onChange={e => setFilter(e.target.value)}>{[['all','All issues'],['error','Errors'],['warning','Warnings'],['electrical','Electrical and connections'],['unresolved','Unresolved calculations'],['layout','Layout']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
        <input aria-label="Filter by component or wire ID" className="rounded border bg-background p-2 text-sm" placeholder="Component or wire ID" value={objectFilter} onChange={e => setObjectFilter(e.target.value)}/>
      </div>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {visible.map((issue,index) => {
          const wire = issue.wireId ? analysis?.wires[issue.wireId] : undefined;
          const recommendation = wire?.status === 'known' && wire.calculation?.status !== 'error' ? wire?.calculation?.recommendedGauge : undefined;
          return <div key={(issue as ReviewIssue).id ?? index}>
          <button type="button" onClick={() => onIssueClick?.(issue)} disabled={!current} className={`w-full text-left border rounded p-3 space-y-1 ${issue.severity === 'error' ? 'border-red-500' : 'border-border'} disabled:opacity-60`}>
          <div className="flex gap-2 text-sm font-medium"><Info className="h-4 w-4 shrink-0"/>{issue.message}</div>
          <p className="text-xs text-muted-foreground">{issue.category} · {issue.severity}</p>
          {issue.suggestion && <p className="text-xs">{issue.suggestion}</p>}
          <p className="text-xs text-muted-foreground">{[...(issue.componentIds ?? []), ...(issue.wireIds ?? []), issue.wireId].filter(Boolean).join(' · ')}</p>
          </button>
          {onApplyGaugeFix && issue.category === 'wire-sizing' && issue.severity === 'error' && wire && recommendation && recommendation !== wire.selectedGauge && <Button variant="outline" size="sm" disabled={!current} className="mt-1" onClick={() => setFix({wireId: wire.wireId, previous: wire.selectedGauge || 'Not specified', gauge: recommendation})}>Preview gauge change</Button>}
          </div>;
        })}
        {!visible.length && <p className="text-sm text-muted-foreground">{issues.length ? 'No issues match these filters.' : 'No issues found in supported checks. Unmodeled scenarios still require review.'}</p>}
      </div>
    </CardContent></Card>}
    {current && analysis && <Card><CardHeader><CardTitle>Calculation assumptions and limits</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{assumptions.map(a => <p key={a}>{a}</p>)}<p className="text-muted-foreground">Analysis version {analysis.engineVersion}. Unknown and unsupported currents are not verified sizing results.</p></CardContent></Card>}
    {validationResult && <details className="text-sm border rounded p-3"><summary>Layout and legacy quality metrics</summary><p className="mt-2">Legacy combined score: {validationResult.score}/100. This score includes layout and does not establish electrical readiness.</p><p>Average spacing: {(validationResult as DesignReviewResult).layoutMetrics?.avgComponentSpacing?.toFixed(0) ?? 'Unresolved'} px · Layout efficiency: {(validationResult as DesignReviewResult).layoutMetrics?.layoutEfficiency?.toFixed(0) ?? 'Unresolved'}%</p></details>}
    <Dialog open={!!fix} onOpenChange={open => { if (!open) setFix(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Review wire gauge change</DialogTitle><DialogDescription>This changes one conductor using the current supported calculation. Connections and physical length stay the same.</DialogDescription></DialogHeader>
        <p>{fix?.wireId}: {fix?.previous} → {fix?.gauge}</p>
        <p className="text-sm text-muted-foreground">You can reverse this change with Undo. Other electrical issues still need review.</p>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setFix(null)}>Cancel</Button><Button disabled={!current} onClick={() => { if (fix && current) onApplyGaugeFix?.(fix.wireId, fix.gauge); setFix(null); }}>Apply gauge change</Button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
