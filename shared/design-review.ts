import type { ValidationIssue, ValidationResult } from './schema';
import { designRequirementsSchema, checkDesignRequirements, type RequirementCheck } from './design-requirements';
import { analyzeElectricalDesign, electricalFingerprint, type AnalysisResult, type AnalysisOptions, type AnalysisComponent, type AnalysisWire } from './electrical-analysis';

export type ReviewStatus = 'unchecked' | 'stale' | 'checking' | 'current' | 'failed';
export interface ReviewIssue extends ValidationIssue { id: string; ruleId: string }
export interface DesignReviewResult extends ValidationResult { issues: ReviewIssue[]; analysis: AnalysisResult; checkedFingerprint: string; requirementCheck?: RequirementCheck; layoutMetrics?: {avgComponentSpacing?: number; layoutEfficiency?: number} }
export function reviewFingerprint(input: { components: AnalysisComponent[]; wires: AnalysisWire[]; systemVoltage: number; options?: AnalysisOptions; requirements?: unknown }): string {
  // Match the JSON actually sent to the server: undefined object properties
  // are omitted by fetch's JSON.stringify, including optional panel ratings.
  const payload = { components: input.components, wires: input.wires, systemVoltage: input.systemVoltage,
    options: input.options ?? {}, ...(input.requirements === undefined ? {} : { requirements: input.requirements }) };
  return electricalFingerprint(JSON.parse(JSON.stringify(payload)));
}

/** Legacy structural rules remain useful; sizing is exclusively the shared engine's supported analysis. */
export function buildDesignReview(input: {components: AnalysisComponent[]; wires: AnalysisWire[]; systemVoltage: number; options?: AnalysisOptions; requirements?: unknown}, legacy: Pick<ValidationResult, "valid" | "score" | "issues"> & {metrics?: {avgComponentSpacing?: number; layoutEfficiency?: number}}): DesignReviewResult {
  const analysis = analyzeElectricalDesign(input, input.options);
  const issues: ValidationIssue[] = legacy.issues.flatMap(issue => {
    if (issue.category !== 'wire-sizing') return [issue];
    if (/cannot determine current/i.test(issue.message)) return [];
    // Keep protection, missing gauges, grounding and parallel-conductor constraints.
    const currentEstimate = /insufficient for|running at|voltage drop:|Parallel wire runs used for/i.test(issue.message);
    if (!currentEstimate) return [issue];
    const value = issue.wireId ? analysis.wires[issue.wireId] : undefined;
    if (value?.status === 'known') return [];
    return [{...issue, message: `Legacy estimate (unverified): ${issue.message}`, suggestion: 'The shared analyzer cannot resolve this circuit. Review this estimate independently before relying on it.'}];
  });
  const add = (ruleId: string, issue: ValidationIssue) => issues.push(Object.assign(issue, { ruleId }));
  let requirementCheck: RequirementCheck | undefined;
  if (input.requirements !== undefined) {
    const parsed = designRequirementsSchema.safeParse(input.requirements);
    if (parsed.success) {
      requirementCheck = checkDesignRequirements(parsed.data, input.components as any[], input.wires as any[], input.systemVoltage);
      for (const issue of requirementCheck.issues) add(issue.ruleId, issue);
    } else add('requirement.invalid', {severity:'warning', category:'unresolved', message:'The saved requirements checklist could not be checked.'});
  }
  for (const value of Object.values(analysis.wires)) {
    if (value.reason === 'Data cables are not sized as power conductors.') continue;
    if (value.status !== 'known') add(`analysis.${value.status}`, { severity: 'warning', category: 'unresolved', wireId: value.wireId, message: value.reason ?? 'Wire analysis is unresolved.', suggestion: 'Review the connected equipment and declared values. This wire has no verified sizing result.' });
    else for (const message of value.issues) add('analysis.wire-sizing', {severity: 'error', category: 'wire-sizing', wireId: value.wireId, message});
  }
  for (const [id, value] of Object.entries(analysis.components)) if (value.status === 'unsupported') add('analysis.component-unsupported', {severity:'warning', category:'unresolved', componentIds:[id], message:value.reason ?? 'Component analysis is unsupported.'});
  const enriched = issues.map(issue => {
    const ruleId = (issue as ReviewIssue).ruleId ?? `legacy.${issue.category}.${electricalFingerprint(issue.message.replace(/\d+(\.\d+)?/g, '#').replace(/"[^"]*"/g, '#'))}`;
    const id = electricalFingerprint({ruleId, components: issue.componentIds ?? [], wires: issue.wireIds ?? [issue.wireId], message: issue.message});
    return {...issue, ruleId, id};
  });
  return {score: legacy.score, layoutMetrics: legacy.metrics, valid: !enriched.some(i => i.severity === 'error'), issues: enriched, analysis, requirementCheck, checkedFingerprint: reviewFingerprint(input)};
}
export function reviewHeadline(result: ValidationResult | null, status: ReviewStatus): string {
  if (status === 'failed') return 'Review failed — retry to check this design';
  if (status === 'checking') return 'Checking current design…';
  if (status === 'stale') return 'Design changed — previous review is out of date';
  if (status !== 'current' || !result) return 'Design has not been checked';
  const errors = result.issues.filter(i => i.severity === 'error').length;
  const unresolved = result.issues.filter(i => i.category === 'unresolved').length;
  if (errors) return `${errors} error${errors === 1 ? '' : 's'} ${errors === 1 ? 'needs' : 'need'} attention`;
  if (unresolved) return `${unresolved} unresolved calculation${unresolved === 1 ? '' : 's'}`;
  return result.issues.some(i => i.severity === 'warning') ? 'Review warnings before proceeding' : 'No errors found in supported checks';
}
