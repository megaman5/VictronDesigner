import { annotateCandidate, createRequirementContext, preserveRepairEquipment, repairFeedback, requirementFeedback } from "../requirements";
import { candidateDecision, prefersAICandidate, AICorrectionTracker, wirePreflight, AI_POLICY_VERSION } from "../../../shared/ai-policy";
import { ELECTRICAL_ENGINE_VERSION } from "../../../shared/electrical-analysis";
import { getSuite, type BenchmarkCase, type BenchmarkSuite } from "./cases";
import { getSkill, type Skill } from "../skills";
import { resolveTarget, type ProviderCredentials, type ProviderId } from "../providers";
import { estimateCostUsd } from "../pricing";
import { validateDesign } from "../../design-validator";
import { normalizeAIDesign } from "../../ai-design-normalizer";
import { judgeDesign, type JudgePanelResult } from "./judge";

/**
 * Executes a benchmark suite against one (skill, provider, model) target.
 *
 * The harness is deterministic even though the model is not: fixed cases,
 * fixed scoring, and N repeats so variance is reported instead of hidden.
 */

export interface RunOptions {
  suiteId: string;
  model: string;
  providerId?: ProviderId;
  /** Run only these cases from the suite. Empty/undefined = all. */
  caseIds?: string[];
  repeats?: number;
  /**
   * Vision models that grade each best design from its rendered PNG.
   * Empty/undefined = no judging (it costs extra model calls).
   */
  judges?: string[];
  /** Known-good designs by caseId, shown to judges as calibration anchors. */
  exemplars?: Record<string, { components: any[]; wires: any[] }>;
  /**
   * Refinement passes per case, matching what the production streaming
   * endpoint does. 1 means single-shot. Later passes receive the previous
   * validation errors as feedback, and the best-scoring design wins.
   */
  iterations?: number;
  /** Stop iterating once a design reaches this score. */
  targetScore?: number;
  temperature?: number;
  seed?: number;
  credentials?: ProviderCredentials | null;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  /** Called after each case execution so callers can stream progress. */
  onResult?: (result: CaseResult) => void | Promise<void>;
}

export interface CaseResult {
  caseId: string;
  repeat: number;
  success: boolean;
  score: number | null;
  errorCount: number | null;
  warningCount: number | null;
  componentCount: number | null;
  wireCount: number | null;
  repairCount: number | null;
  /** How many model calls this case actually needed. */
  iterationsUsed: number;
  /** Score after each pass, so convergence (or divergence) is visible. */
  scorePath: number[];
  expectationsMet: boolean | null;
  failedExpectations: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
  /** Panel median from the vision judges, when judging was requested. */
  judgeScore: number | null;
  judgeStdDev: number | null;
  judgeCostUsd: number | null;
  judgeDetails: unknown | null;
  errorMessage?: string;
  issues?: unknown;
  output?: unknown;
  electricalPassed?: boolean;
  electricalErrorCount?: number;
  requirementsComplete?: boolean;
  unresolvedCount?: number;
  firstAcceptableDurationMs?: number | null;
  diagnostics?: unknown[];
  stopReason?: string;
  provenance?: unknown;
}

export interface RunSummary {
  suite: BenchmarkSuite;
  skill: Skill;
  model: string;
  providerId: ProviderId;
  usingPlatformKey: boolean;
  samplingApplied: boolean | null;
  results: CaseResult[];
  stats: RunStats;
}

export interface RunStats {
  caseCount: number;
  completedCount: number;
  meanScore: number | null;
  medianScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  /** Standard deviation of scores - the honest measure of run-to-run noise. */
  scoreStdDev: number | null;
  passRate: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
  meanDurationMs: number | null;
  totalRepairs: number;
  meanIterations: number | null;
  meanJudgeScore: number | null;
  totalJudgeCostUsd: number | null;
  noElectricalErrorRate?: number | null;
  electricalPassedRate?: number | null;
  requirementCompleteRate?: number | null;
  unresolvedRate?: number | null;
  acceptableRate?: number | null;
  latencyP50Ms?: number | null;
  latencyP95Ms?: number | null;
  costPerAcceptableUsd?: number | null;
  requestCompletedCount?: number;
}

import { extractJson } from "./extract-json";
export { extractJson };

export async function runBenchmark(opts: RunOptions): Promise<RunSummary> {
  const suite = getSuite(opts.suiteId);
  const skill = getSkill(suite.skillId);
  const repeats = Math.min(10, Math.max(1, Math.floor(opts.repeats ?? 1)));

  const target = resolveTarget({
    model: opts.model,
    providerId: opts.providerId,
    userCredentials: opts.credentials ?? null,
  });

  if (opts.reasoningEffort && !['low', 'medium', 'high'].includes(opts.reasoningEffort)) throw new Error("Unsupported reasoning effort.");
  if (opts.reasoningEffort && target.provider.id === 'anthropic') throw new Error("This benchmark does not map reasoning effort to Anthropic; use a supported provider/profile.");
  const results: CaseResult[] = [];
  let samplingApplied: boolean | null = null;

  const cases = opts.caseIds?.length
    ? suite.cases.filter(c => opts.caseIds!.includes(c.id))
    : suite.cases;
  if (!cases.length) {
    throw new Error(
      `No matching cases in suite "${suite.id}". Known: ${suite.cases.map(c => c.id).join(", ")}`
    );
  }

  for (const testCase of cases) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      if (opts.signal?.aborted) throw new Error("Benchmark aborted");

      const result = await runCase({
        testCase,
        skill,
        target,
        model: opts.model,
        repeat,
        iterations: Math.min(6, Math.max(1, Math.floor(opts.iterations ?? 1))),
        targetScore: opts.targetScore ?? 70,
        temperature: opts.temperature,
        seed: opts.seed,
        maxOutputTokens: opts.maxOutputTokens,
        reasoningEffort: opts.reasoningEffort,
        judges: opts.judges,
        exemplar: opts.exemplars?.[testCase.id] ?? null,
        credentials: opts.credentials ?? null,
        signal: opts.signal,
        onSampling: applied => {
          samplingApplied = samplingApplied === null ? applied : samplingApplied && applied;
        },
      });

      results.push(result);
      await opts.onResult?.(result);
    }
  }

  return {
    suite,
    skill,
    model: opts.model,
    providerId: target.provider.id,
    usingPlatformKey: target.usingPlatformKey,
    samplingApplied,
    results,
    stats: summarize(results, cases),
  };
}

async function runCase(args: {
  testCase: BenchmarkCase;
  skill: Skill;
  target: ReturnType<typeof resolveTarget>;
  model: string;
  repeat: number;
  iterations: number;
  targetScore: number;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  judges?: string[];
  exemplar?: { components: any[]; wires: any[] } | null;
  credentials?: ProviderCredentials | null;
  signal?: AbortSignal;
  onSampling: (applied: boolean) => void;
}): Promise<CaseResult> {
  const { testCase, skill, target, repeat } = args;
  const started = Date.now();

  const base: CaseResult = {
    caseId: testCase.id,
    repeat,
    success: false,
    score: null,
    errorCount: null,
    warningCount: null,
    componentCount: null,
    wireCount: null,
    repairCount: null,
    iterationsUsed: 0,
    scorePath: [],
    expectationsMet: null,
    failedExpectations: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    durationMs: 0,
    judgeScore: null,
    judgeStdDev: null,
    judgeCostUsd: null,
    judgeDetails: null,
  };

  try {
    let inputTokens = 0;
    let outputTokens = 0;
    let feedback: string | undefined;
    const scorePath: number[] = [];
    let best: {
      score: number;
      design: { components: any[]; wires: any[] };
      validation: any;
      repairs: number;
    } | null = null;
    let used = 0;
    const tracker = new AICorrectionTracker();
    const context = createRequirementContext({ prompt: testCase.prompt, systemVoltage: testCase.systemVoltage, requirements: testCase.requirements, components: testCase.existingComponents, wires: testCase.existingWires });
    const diagnostics: any[] = [];
    base.provenance = { policyVersion: AI_POLICY_VERSION, analysisVersion: ELECTRICAL_ENGINE_VERSION, inputHash: context.inputHash, settings: { reasoningEffort: args.reasoningEffort ?? "default", maxOutputTokens: args.maxOutputTokens ?? 32000, iterations: args.iterations } };
    if (testCase.existingComponents) {
      const blockers = wirePreflight(testCase.existingComponents, context.requirements);
      if (blockers.length) return { ...base, durationMs: Date.now() - started, stopReason: "preflight-blocked", errorMessage: blockers.map(b => b.message).join(" "), diagnostics: blockers };
    }

    for (let pass = 1; pass <= args.iterations; pass++) {
      if (args.signal?.aborted) throw new Error("Benchmark aborted");
      used = pass; base.iterationsUsed = used;
      const passStarted = Date.now();

      const ctx = {
        systemVoltage: testCase.systemVoltage,
        feedback: (feedback ?? "") + requirementFeedback(context, best?.design),
        // Wiring skills score against a fixed starting canvas
        existingDesign: testCase.existingComponents
          ? { components: testCase.existingComponents, wires: best?.design.wires ?? testCase.existingWires ?? [] }
          : undefined,
      };
      const response = await target.provider.chat(
        {
          model: args.model,
          json: skill.json,
          temperature: args.temperature,
          seed: args.seed,
          maxOutputTokens: args.maxOutputTokens ?? 32000,
          reasoningEffort: args.reasoningEffort,
          signal: args.signal ? AbortSignal.any([args.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
          messages: [
            { role: "system", content: skill.buildSystemPrompt(ctx) },
            { role: "user", content: skill.buildUserPrompt(testCase.prompt, ctx) },
          ],
        },
        target.credentials
      );

      args.onSampling(response.samplingApplied);
      inputTokens += response.usage.inputTokens;
      outputTokens += response.usage.outputTokens;
      base.inputTokens = inputTokens; base.outputTokens = outputTokens; base.costUsd = estimateCostUsd(args.model, { inputTokens, outputTokens });

      const parsed = extractJson(response.text);
      // A wiring skill returns wires only - the components are the fixed input
      const rawComponents = testCase.existingComponents ?? (Array.isArray(parsed.components) && parsed.components.length
        ? parsed.components
        : []);
      const rawWires = (Array.isArray(parsed.wires) ? parsed.wires : []).map(
        (w: any, i: number) => ({ ...w, id: w.id ?? `bench-wire-${pass}-${i}` })
      );

      const repairCandidate = { components: rawComponents, wires: rawWires };
      preserveRepairEquipment(repairCandidate, best?.design, testCase.existingComponents ?? []);
      // Same repair pass production uses, so scores reflect what a user gets.
      const normalized = normalizeAIDesign(repairCandidate.components, repairCandidate.wires, testCase.systemVoltage, { existingWires: testCase.existingWires ?? [] });
      const design: any = { components: normalized.components, wires: normalized.wires };

      const validation = validateDesign(
        design.components as any,
        design.wires as any,
        testCase.systemVoltage
      );

      design.validation = validation;
      annotateCandidate(design, context);
      const failedExpectations = testCase.expectations.map(e => e.check(design)).filter(Boolean);
      const decision = candidateDecision(design, args.targetScore);
      const progress = tracker.observe(design);
      diagnostics.push({ pass, durationMs: Date.now() - passStarted, servedModel: response.servedModel, finishReason: (response.raw as any)?.choices?.[0]?.finish_reason ?? (response.raw as any)?.candidates?.[0]?.finishReason, usage: response.usage, runStatus: design.runStatus, continuationReasons: decision.continuationReasons, failedExpectations });
      base.diagnostics = diagnostics;
      if (design.runStatus.electricalCheck === 'passed' && design.requirementCheck.complete && !failedExpectations.length && base.firstAcceptableDurationMs == null) base.firstAcceptableDurationMs = Date.now() - started;
      scorePath.push(validation.score); base.scorePath = [...scorePath];
      if (!best || prefersAICandidate(design, best.design)) {
        best = {
          score: validation.score,
          design: design as any,
          validation,
          repairs: normalized.repairs.length,
        };
      }

      if (decision.stop || progress.stop) { base.stopReason = progress.stop ? progress.reason : decision.reason; break; }
      base.stopReason = "iteration-budget";

      feedback = `Previous best design: ${JSON.stringify(best.design)}${repairFeedback(best.design)}\nUnmet fixture expectations: ${failedExpectations.join("; ")}`;
    }

    if (!best) throw new Error("No design produced");

    const usage = { inputTokens, outputTokens };
    base.inputTokens = inputTokens;
    base.outputTokens = outputTokens;
    base.costUsd = estimateCostUsd(args.model, usage);

    const failed = testCase.expectations
      .map(e => {
        const reason = e.check(best!.design as any);
        return reason ? `${e.id}: ${reason}` : null;
      })
      .filter((x): x is string => x !== null);

    // Judge the winning design, not every pass - the panel exists to grade
    // what a user would have received.
    let judged: JudgePanelResult | null = null;
    if (args.judges?.length) {
      try {
        judged = await judgeDesign({
          design: best.design,
          prompt: testCase.prompt,
          systemVoltage: testCase.systemVoltage,
          exemplar: args.exemplar,
          judges: args.judges,
          credentials: args.credentials,
          signal: args.signal,
        });
      } catch (err: any) {
        // Grading failure should not void a completed generation.
        console.warn(`[benchmark] judging failed for ${testCase.id}:`, err?.message);
      }
    }

    return {
      ...base,
      success: true,
      electricalPassed: (best.design as any).runStatus.electricalCheck === 'passed',
      electricalErrorCount: (best.design as any).runStatus.electricalErrorCount,
      requirementsComplete: (best.design as any).requirementCheck.complete,
      unresolvedCount: (best.design as any).runStatus.unresolvedCount,
      score: best.score,
      errorCount: best.validation.issues.filter((i: any) => i.severity === "error").length,
      warningCount: best.validation.issues.filter((i: any) => i.severity === "warning").length,
      componentCount: best.design.components.length,
      wireCount: best.design.wires.length,
      repairCount: best.repairs,
      iterationsUsed: used,
      scorePath,
      expectationsMet: failed.length === 0,
      failedExpectations: failed,
      durationMs: Date.now() - started,
      judgeScore: judged?.score ?? null,
      judgeStdDev: judged?.stdDev ?? null,
      judgeCostUsd: judged?.costUsd ?? null,
      judgeDetails: judged
        ? { verdicts: judged.verdicts, lowConfidence: judged.lowConfidence, usedExemplar: judged.usedExemplar }
        : null,
      issues: best.validation.issues,
      output: best.design,
    };
  } catch (err: any) {
    return {
      ...base,
      success: false,
      costUsd: null, // A failed request may have unreported billable usage.
      durationMs: Date.now() - started,
      errorMessage: err?.message ?? String(err),
    };
  }
}

function summarize(results: CaseResult[], cases: BenchmarkCase[]): RunStats {
  const scores = results
    .map(r => r.score)
    .filter((s): s is number => typeof s === "number");

  const minScoreByCase = new Map(cases.map(c => [c.id, c.minScore]));
  const passes = results.filter(
    r =>
      r.success &&
      typeof r.score === "number" &&
      r.score >= (minScoreByCase.get(r.caseId) ?? 70) &&
      r.expectationsMet !== false && r.electricalPassed === true && r.requirementsComplete === true
  );

  const costs = results.map(r => r.costUsd).filter((c): c is number => typeof c === "number");
  const durations = results.map(r => r.durationMs);

  const judgeScores = results
    .map(r => r.judgeScore)
    .filter((s): s is number => typeof s === "number");
  const judgeCosts = results
    .map(r => r.judgeCostUsd)
    .filter((c): c is number => typeof c === "number");

  return {
    caseCount: results.length,
    completedCount: results.length,
    requestCompletedCount: results.filter(r => r.success).length,
    acceptableRate: results.length ? passes.length / results.length * 100 : null,
    noElectricalErrorRate: results.length ? results.filter(r => r.success && r.electricalErrorCount === 0).length / results.length * 100 : null,
    electricalPassedRate: results.length ? results.filter(r => r.electricalPassed).length / results.length * 100 : null,
    requirementCompleteRate: results.length ? results.filter(r => r.requirementsComplete).length / results.length * 100 : null,
    unresolvedRate: results.length ? results.filter(r => (r.unresolvedCount ?? 0) > 0).length / results.length * 100 : null,
    latencyP50Ms: percentile(durations, 0.5),
    latencyP95Ms: percentile(durations, 0.95),
    costPerAcceptableUsd: passes.length && costs.length === results.length ? costs.reduce((a, c) => a + c, 0) / passes.length : null,
    meanScore: mean(scores),
    medianScore: median(scores),
    minScore: scores.length ? Math.min(...scores) : null,
    maxScore: scores.length ? Math.max(...scores) : null,
    scoreStdDev: stdDev(scores),
    passRate: results.length ? (passes.length / results.length) * 100 : null,
    totalInputTokens: results.reduce((a, r) => a + r.inputTokens, 0),
    totalOutputTokens: results.reduce((a, r) => a + r.outputTokens, 0),
    // Null when no model in the run was priced, rather than a misleading 0
    totalCostUsd: costs.length === results.length && costs.length ? costs.reduce((a, c) => a + c, 0) : null,
    meanDurationMs: durations.length ? Math.round(mean(durations)!) : null,
    totalRepairs: results.reduce((a, r) => a + (r.repairCount ?? 0), 0),
    meanIterations: mean(results.filter(r => r.success).map(r => r.iterationsUsed)),
    meanJudgeScore: mean(judgeScores),
    totalJudgeCostUsd: judgeCosts.length ? judgeCosts.reduce((a, c) => a + c, 0) : null,
  };
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stdDev(xs: number[]): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(p * ordered.length) - 1)];
}
