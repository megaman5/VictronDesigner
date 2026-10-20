import { createHash } from 'node:crypto';
import { restoreWireLengths } from './wire-lengths';
import type { Response } from 'express';
import { buildDesignReview } from '../../shared/design-review';
import { checkDesignRequirements, designRequirementsSchema, extractDesignRequirements, type RequirementCheck } from '../../shared/design-requirements';
import { AI_POLICY_VERSION, isRepairableAIIssue } from '../../shared/ai-policy';
import { ELECTRICAL_ENGINE_VERSION } from '../../shared/electrical-analysis';

export function createRequirementContext(body: any) {
  const systemVoltage = Number(body.systemVoltage ?? 12);
  const parsed = designRequirementsSchema.safeParse(body.requirements || extractDesignRequirements(String(body.prompt || ''), systemVoltage));
  if (!parsed.success) throw Object.assign(new Error(`Invalid design requirements: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`), { status: 400 });
  const requirements = parsed.data;
  if (requirements.dcVoltage !== systemVoltage) throw Object.assign(new Error(`Requested DC voltage ${requirements.dcVoltage}V contradicts system voltage ${systemVoltage}V. Update the saved requirements or system voltage.`), { status: 422, field: 'requirements.dcVoltage' });
  if (Array.isArray(body.components)) requirements.fixedEquipment = body.components.map((c: any) => ({ id: c.id, type: c.type, properties: c.properties }));
  const existing = body.components ?? body.existingDesign?.components ?? [];
  for (const connection of requirements.connections) {
    const a = existing.find((c: any) => c.id === connection.fromComponentId), b = existing.find((c: any) => c.id === connection.toComponentId);
    const battery = a?.type === 'battery' ? a : b?.type === 'battery' ? b : null;
    const other = battery === a ? b : a;
    if (connection.polarity === 'positive' && battery && other && !['fuse', 'dc-breaker', 'lynx-distributor'].includes(other.type)) throw Object.assign(new Error('A required direct battery-positive connection conflicts with battery overcurrent protection. Require a protected path through a fuse or DC breaker instead.'), { status: 422, field: `requirements.connections.${connection.id}` });
  }
  const inputSnapshot = { prompt: body.prompt || '', systemVoltage, settings: { maxIterations: body.maxIterations ?? 6, minQualityScore: body.minQualityScore ?? 70, validationFeedback: body.validationFeedback ?? null, wireCalculationIssues: body.wireCalculationIssues ?? [] }, existingDesign: body.existingDesign || (body.components ? { components: body.components, wires: body.wires || [] } : null), requirements };
  const inputHash = createHash('sha256').update(JSON.stringify(inputSnapshot)).digest('hex');
  const allowWireLengthChanges = /\blengths?\b|\blonger\b|\bshorter\b|\b\d+(?:\.\d+)?\s*(?:ft|feet|foot|meters?|metres?|m)\b/i.test(String(body.prompt || ''));
  return { requirements, inputHash, inputSnapshot, allowWireLengthChanges };
}
export function annotateCandidate(candidate: any, context: ReturnType<typeof createRequirementContext>) {
  restoreWireLengths(candidate.wires ?? [], context.inputSnapshot.existingDesign?.wires ?? [], context.allowWireLengthChanges);
  candidate.requirements = context.requirements;
  candidate.inputHash = context.inputHash;
  candidate.requirementCheck = checkDesignRequirements(context.requirements, candidate.components || [], candidate.wires || [], context.inputSnapshot.systemVoltage);
  if (candidate.validation) candidate.review = buildDesignReview({ components: candidate.components || [], wires: candidate.wires || [], systemVoltage: context.inputSnapshot.systemVoltage }, candidate.validation);
  const issues = candidate.review?.issues ?? [];
  const errors = issues.filter((issue: any) => issue.severity === 'error' && issue.category !== 'layout');
  const unresolved = issues.filter((issue: any) => issue.category === 'unresolved');
  candidate.runStatus = { requestCompleted: true, usableCandidate: Boolean(candidate.components?.length), electricalCheck: errors.length ? 'failed' : unresolved.length ? 'incomplete' : candidate.review ? 'passed' : 'not-checked', requirementsCheck: candidate.requirementCheck.status, electricalErrorCount: errors.length, unresolvedCount: unresolved.length, checkedRequirementCount: candidate.requirementCheck.checkedCount, policyVersion: AI_POLICY_VERSION, analysisVersion: ELECTRICAL_ENGINE_VERSION };
  return candidate;
}
export function prefersRequirementCandidate(candidate: RequirementCheck, best: RequirementCheck | undefined) {
  if (!best) return true;
  return candidate.issues.length < best.issues.length;
}
export function requirementFeedback(context: ReturnType<typeof createRequirementContext>, best?: any) {
  return `\n\nREVIEWED REQUIREMENTS:\n${JSON.stringify(context.requirements)}\nUNMET REQUIREMENTS:\n${best?.requirementCheck?.issues.map((issue: any) => issue.message).join('\n') || 'None detected; preserve all requested equipment and circuits.'}\nPreserve unaffected component IDs, properties, names, and positions. Repair only equipment and connections affected by the listed issues.`;
}
export function repairFeedback(candidate: any) {
  const issues = (candidate?.review?.issues ?? candidate?.validation?.issues ?? []).filter(isRepairableAIIssue);
  return `\n\nSUPPORTED REPAIR FEEDBACK:\n${issues.map((issue: any) => `${issue.message}${issue.suggestion ? ` — ${issue.suggestion}` : ''} (equipment: ${(issue.componentIds ?? []).join(', ')}, wire: ${issue.wireId ?? ''})`).join('\n') || 'No repairable electrical issues.'}\nUse practical estimated one-way wire lengths in feet, with routing and service slack, when lengths are not supplied. Size conductors using those values. Honor requested length changes. Preserve other existing lengths. Do not invent manufacturer ratings or current sharing to resolve unsupported checks. Preserve unaffected connections and equipment.`;
}
export function reviewFeedback(candidate: any) {
  const review = candidate?.review ?? candidate?.validation;
  return { score: review?.score ?? 0, errors: (review?.issues ?? []).filter((i: any) => i.severity === 'error').map((i: any) => i.message), warnings: (review?.issues ?? []).filter((i: any) => i.severity === 'warning').map((i: any) => i.message), wireSizingIssues: (review?.issues ?? []).filter((i: any) => i.category === 'wire-sizing').map((i: any) => i.message), suggestions: (review?.issues ?? []).map((i: any) => i.suggestion).filter(Boolean) };
}

// Repairs preserve equipment outside the explicitly affected subgraph. Existing
// manually supplied components are always fixed, even when their wiring is wrong.
export function preserveRepairEquipment(candidate: any, best: any, fixed: any[] = [], allowWireLengthChanges = false) {
  const repairIssues = (best?.review?.issues ?? best?.validation?.issues ?? []).filter(isRepairableAIIssue);
  const affected = new Set<string>(repairIssues.flatMap((issue: any) => issue.componentIds || []));
  for (const issue of best?.requirementCheck?.issues || []) for (const id of issue.componentIds) affected.add(id);
  const preserve = new Map<string, any>();
  for (const component of best?.components || []) if (!affected.has(component.id)) preserve.set(component.id, component);
  for (const component of fixed) preserve.set(component.id, component);
  candidate.components = (candidate.components || []).map((component: any) => preserve.get(component.id) || component);
  const present = new Set(candidate.components.map((component: any) => component.id));
  for (const component of Array.from(preserve.values())) if (!present.has(component.id)) candidate.components.push(component);
  const affectedWires = new Set<string>(repairIssues.flatMap((issue: any) => [issue.wireId, ...(issue.wireIds || [])].filter(Boolean)));
  const connectionKey = (wire: any) => [ `${wire.fromComponentId}:${wire.fromTerminal}`, `${wire.toComponentId}:${wire.toTerminal}` ].sort().join('|');
  const stableWires = new Map<string, any[]>();
  for (const wire of best?.wires || []) {
    if (!affectedWires.has(wire.id) && !affected.has(wire.fromComponentId) && !affected.has(wire.toComponentId)) {
      const key = connectionKey(wire); stableWires.set(key, [...(stableWires.get(key) ?? []), wire]);
    }
  }
  candidate.wires = (candidate.wires || []).map((wire: any) => {
    const original = stableWires.get(connectionKey(wire))?.shift();
    if (!original) return wire;
    if (allowWireLengthChanges && Number(wire.length) > 0 && Number(wire.length) !== Number(original.length)) return { ...original, length: wire.length, gauge: wire.gauge ?? original.gauge, lengthEstimated: true };
    return original;
  });
  for (const remaining of Array.from(stableWires.values())) candidate.wires.push(...remaining);
}
// nginx closes proxied requests at 300s and non-streaming AI Wire sends no
// bytes until it finishes, so the whole run must end comfortably before that.
export const AI_RUN_TIMEOUT_MS = 280_000;

export function createAIRunBudget(res: Response, requestedIterations: unknown, timeoutMs = AI_RUN_TIMEOUT_MS) {
  const controller = new AbortController();
  const abort = (cause: string) => controller.abort(Object.assign(new Error(cause === 'run-deadline' ? 'AI reached the time limit (about 4.5 minutes). Review the best draft or try a smaller request.' : 'AI request disconnected or cancelled.'), { name: 'AbortError', abortCause: cause, status: cause === 'run-deadline' ? 504 : undefined }));
  const timer = setTimeout(() => abort('run-deadline'), timeoutMs);
  timer.unref?.();
  const cleanup = () => { clearTimeout(timer); res.off('close', close); res.off('finish', cleanup); };
  const close = () => { if (!res.writableEnded) abort('client-disconnected'); cleanup(); };
  res.once('close', close);
  res.once('finish', cleanup);
  const requested = Number(requestedIterations);
  const maxIterations = Number.isFinite(requested) ? Math.min(6, Math.max(1, Math.floor(requested))) : 6;
  return { signal: controller.signal, deadline: Date.now() + timeoutMs, maxIterations, abortCause: () => controller.signal.reason?.abortCause, exhausted: () => controller.signal.aborted };
}
