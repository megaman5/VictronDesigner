import type { DesignRequirements } from './design-requirements';
import { buildDesignReview } from './design-review';
import { electricalFingerprint } from './electrical-analysis';

export const AI_POLICY_VERSION = '2026-10-07.1';
export type AIBlockerKind = 'missing-equipment' | 'missing-specification' | 'unsupported-analysis' | 'repairable-wiring' | 'layout' | 'manual-requirement';
export interface AIBlocker { kind: AIBlockerKind; message: string; componentIds: string[]; wireId?: string; field?: string; suggestedType?: string }

/** Only provably impossible equipment changes prevent a fixed-canvas wiring request. */
export function wirePreflight(components: any[], requirements?: DesignRequirements): AIBlocker[] {
  const blockers: AIBlocker[] = [];
  const batteries = components.filter(c => c.type === 'battery');
  const protection = components.some(c => ['fuse', 'dc-breaker', 'lynx-distributor'].includes(c.type));
  if (batteries.length && !protection) blockers.push({ kind: 'missing-equipment', message: 'Add battery overcurrent protection (a fuse or DC breaker), then run AI Wire. Wiring alone cannot add protection.', componentIds: batteries.map(c => c.id), suggestedType: 'fuse' });
  const mppts = components.filter(c => c.type === 'mppt');
  if (mppts.length && !components.some(c => c.type === 'solar-panel')) blockers.push({ kind: 'missing-equipment', message: 'Add the solar panels connected to your MPPT before running AI Wire.', componentIds: mppts.map(c => c.id), suggestedType: 'solar-panel' });
  for (const requirement of requirements?.equipment ?? []) {
    const count = components.filter(c => c.type === requirement.type || (requirement.type === 'inverter' && ['multiplus', 'quattro', 'phoenix-inverter'].includes(c.type))).length;
    if (count < requirement.quantity) blockers.push({ kind: 'missing-equipment', message: `Add the requested ${requirement.quantity} ${requirement.type} before AI Wire; only ${count} are on the canvas.`, componentIds: [], suggestedType: requirement.type });
  }
  const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  for (const component of components) {
    const p = component.properties ?? {};
    let field: string | undefined;
    if (['dc-load', 'ac-load'].includes(component.type) && !positive(p.watts ?? p.power) && !positive(p.amps)) field = 'watts';
    if (component.type === 'mppt' && !positive(p.maxCurrent)) field = 'maxCurrent';
    if (['inverter', 'multiplus', 'quattro', 'phoenix-inverter'].includes(component.type) && !components.some(c => c.type === 'ac-load') && !positive(p.dcInputAmps) && !positive(p.dcInputWatts)) field = 'dcInputAmps';
    if (field) blockers.push({ kind: 'missing-specification', message: field === 'dcInputAmps' ? `Add the intended AC loads or set the reviewed DC input sizing current for ${component.name ?? component.id} in Properties. AI cannot infer utilization from an inverter rating.` : `Set ${field} for ${component.name ?? component.id} in Properties before AI Wire.`, componentIds: [component.id], field });
  }
  return blockers;
}

export function classifyAIIssue(issue: any): AIBlockerKind {
  if (/^Legacy estimate \(unverified\)/i.test(issue.message)) return 'unsupported-analysis';
  if (/physical wire length|AI-estimated physical/i.test(issue.message)) return 'missing-specification';
  if (issue.category === 'layout') return 'layout';
  if (issue.category === 'requirements') return 'manual-requirement';
  if (issue.category !== 'unresolved') return 'repairable-wiring';
  if (/set |declare|physical.*length|rated.*current|power factor/i.test(issue.message)) return 'missing-specification';
  if (/connect |disconnected|missing.*terminal|no connected|single supported source/i.test(issue.message) && !/multiple.source/i.test(issue.message)) return 'repairable-wiring';
  return 'unsupported-analysis';
}

export function isRepairableAIIssue(issue: any): boolean {
  return classifyAIIssue(issue) === 'repairable-wiring' &&
    (issue.severity === 'error' || issue.category === 'unresolved' ||
      (issue.category === 'ai-quality' && /not connected to any wires|disconnected/i.test(issue.message)));
}

export function candidateReview(candidate: any, systemVoltage: number) {
  return candidate.review ?? buildDesignReview({ components: candidate.components || [], wires: candidate.wires || [], systemVoltage }, candidate.validation ?? { score: 0, issues: [] });
}
export function candidateRank(candidate: any) {
  const issues = candidate.review?.issues ?? candidate.validation?.issues ?? [];
  return [candidate.requirementCheck?.issues?.length ?? 0,
    issues.filter((i: any) => i.severity === 'error' && i.category !== 'layout').length,
    issues.filter((i: any) => i.category === 'unresolved').length,
    issues.filter((i: any) => i.severity === 'error' && i.category === 'layout').length,
    -(candidate.validation?.score ?? 0)];
}
export function prefersAICandidate(candidate: any, best: any) {
  if (!best) return true;
  const a = candidateRank(candidate), b = candidateRank(best);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
export function candidateDecision(candidate: any, minScore = 70) {
  const issues = candidate.review?.issues ?? candidate.validation?.issues ?? [];
  const repairable = issues.filter(isRepairableAIIssue);
  const unmet = candidate.requirementCheck?.issues?.length ?? 0;
  if (repairable.length || unmet) return { stop: false, reason: 'repairable-issues', continuationReasons: [...repairable.map((i: any) => i.message), ...(candidate.requirementCheck?.issues ?? []).map((i: any) => i.message)] };
  const unresolved = issues.filter((i: any) => i.category === 'unresolved');
  if (unresolved.length || issues.some((i: any) => i.severity === 'error')) return { stop: true, reason: 'unsupported-calculations', continuationReasons: [] };
  // Layout and prose requirements do not justify repeated electrical regeneration.
  return { stop: true, reason: candidate.requirementCheck?.complete && (candidate.validation?.score ?? 0) >= minScore ? 'quality-threshold' : 'supported-checks-complete', continuationReasons: [] };
}

/** Ignore drawing order, wire IDs, and endpoint direction, but retain multiplicity and specifications. */
export function semanticCandidateSignature(candidate: any) {
  const components = (candidate.components ?? []).map((c: any) => ({ id: c.id, type: c.type, properties: c.properties })).sort((a: any, b: any) => a.id.localeCompare(b.id));
  const wires = (candidate.wires ?? []).map((w: any) => ({ ends: [`${w.fromComponentId}:${w.fromTerminal}`, `${w.toComponentId}:${w.toTerminal}`].sort(), polarity: w.polarity, gauge: w.gauge, length: w.length, conductorMaterial: w.conductorMaterial })).map(electricalFingerprint).sort();
  const issues = (candidate.review?.issues ?? candidate.validation?.issues ?? []).map((i: any) => ({ rule: i.ruleId ?? i.category, message: i.message, severity: i.severity, components: [...(i.componentIds ?? [])].sort() })).map(electricalFingerprint).sort();
  return electricalFingerprint({ components, wires, issues, requirements: candidate.requirementCheck?.issues });
}

export function wiringChanges(before: any[], after: any[]) {
  const key = (w: any) => electricalFingerprint({ ends: [`${w.fromComponentId}:${w.fromTerminal}`, `${w.toComponentId}:${w.toTerminal}`].sort(), gauge: w.gauge, length: w.length, polarity: w.polarity });
  const remaining = new Map<string, any[]>();
  for (const w of before) { const k = key(w); remaining.set(k, [...(remaining.get(k) ?? []), w]); }
  const added: any[] = [];
  for (const w of after) { const group = remaining.get(key(w)); if (group?.length) group.pop(); else added.push(w); }
  return { added, removed: Array.from(remaining.values()).flat() };
}
export class AICorrectionTracker {
  private signatures = new Map<string, number>();
  private best: any;
  private unproductive = 0;
  observe(candidate: any) {
    const improved = prefersAICandidate(candidate, this.best);
    if (improved) { this.best = candidate; this.unproductive = 0; } else this.unproductive++;
    const signature = semanticCandidateSignature(candidate);
    const count = (this.signatures.get(signature) ?? 0) + 1;
    this.signatures.set(signature, count);
    return { improved, stop: count >= 3 || this.unproductive >= 2, reason: count >= 3 ? 'repeated-candidate' : 'no-progress' };
  }
}
