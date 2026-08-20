import { getSuite, type BenchmarkCase, type BenchmarkSuite } from "./cases";
import { getSkill, type Skill } from "../skills";
import { resolveTarget, type ProviderCredentials, type ProviderId } from "../providers";
import { estimateCostUsd } from "../pricing";
import { validateDesign } from "../../design-validator";
import { normalizeAIDesign } from "../../ai-design-normalizer";

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
  repeats?: number;
  temperature?: number;
  seed?: number;
  credentials?: ProviderCredentials | null;
  maxOutputTokens?: number;
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
  expectationsMet: boolean | null;
  failedExpectations: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  durationMs: number;
  errorMessage?: string;
  issues?: unknown;
  output?: unknown;
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
}

/** Pull the first JSON object out of a model response. */
export function extractJson(text: string): any {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(body.slice(start, end + 1));
}

export async function runBenchmark(opts: RunOptions): Promise<RunSummary> {
  const suite = getSuite(opts.suiteId);
  const skill = getSkill(suite.skillId);
  const repeats = Math.max(1, opts.repeats ?? 1);

  const target = resolveTarget({
    model: opts.model,
    providerId: opts.providerId,
    userCredentials: opts.credentials ?? null,
  });

  const results: CaseResult[] = [];
  let samplingApplied: boolean | null = null;

  for (const testCase of suite.cases) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      if (opts.signal?.aborted) throw new Error("Benchmark aborted");

      const result = await runCase({
        testCase,
        skill,
        target,
        model: opts.model,
        repeat,
        temperature: opts.temperature,
        seed: opts.seed,
        maxOutputTokens: opts.maxOutputTokens,
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
    stats: summarize(results, suite, repeats),
  };
}

async function runCase(args: {
  testCase: BenchmarkCase;
  skill: Skill;
  target: ReturnType<typeof resolveTarget>;
  model: string;
  repeat: number;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
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
    expectationsMet: null,
    failedExpectations: [],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    durationMs: 0,
  };

  try {
    const ctx = { systemVoltage: testCase.systemVoltage };
    const response = await target.provider.chat(
      {
        model: args.model,
        json: skill.json,
        temperature: args.temperature,
        seed: args.seed,
        maxOutputTokens: args.maxOutputTokens ?? 32000,
        signal: args.signal,
        messages: [
          { role: "system", content: skill.buildSystemPrompt(ctx) },
          { role: "user", content: skill.buildUserPrompt(testCase.prompt, ctx) },
        ],
      },
      target.credentials
    );

    args.onSampling(response.samplingApplied);

    const usage = response.usage;
    base.inputTokens = usage.inputTokens;
    base.outputTokens = usage.outputTokens;
    base.costUsd = estimateCostUsd(args.model, usage);

    const parsed = extractJson(response.text);
    const rawComponents = Array.isArray(parsed.components) ? parsed.components : [];
    const rawWires = (Array.isArray(parsed.wires) ? parsed.wires : []).map(
      (w: any, i: number) => ({ ...w, id: w.id ?? `bench-wire-${i}` })
    );

    // Same repair pass production uses, so benchmark scores reflect what a
    // user would actually get - and repairCount shows how much the prompt
    // needed rescuing.
    const normalized = normalizeAIDesign(rawComponents, rawWires, testCase.systemVoltage);
    const design = { components: normalized.components, wires: normalized.wires };

    const validation = validateDesign(
      design.components as any,
      design.wires as any,
      testCase.systemVoltage
    );

    const failed = testCase.expectations
      .map(e => {
        const reason = e.check(design as any);
        return reason ? `${e.id}: ${reason}` : null;
      })
      .filter((x): x is string => x !== null);

    return {
      ...base,
      success: true,
      score: validation.score,
      errorCount: validation.issues.filter(i => i.severity === "error").length,
      warningCount: validation.issues.filter(i => i.severity === "warning").length,
      componentCount: design.components.length,
      wireCount: design.wires.length,
      repairCount: normalized.repairs.length,
      expectationsMet: failed.length === 0,
      failedExpectations: failed,
      durationMs: Date.now() - started,
      issues: validation.issues,
      output: { ...design, repairs: normalized.repairs },
    };
  } catch (err: any) {
    return {
      ...base,
      success: false,
      durationMs: Date.now() - started,
      errorMessage: err?.message ?? String(err),
    };
  }
}

function summarize(results: CaseResult[], suite: BenchmarkSuite, repeats: number): RunStats {
  const scores = results
    .map(r => r.score)
    .filter((s): s is number => typeof s === "number");

  const minScoreByCase = new Map(suite.cases.map(c => [c.id, c.minScore]));
  const passes = results.filter(
    r =>
      r.success &&
      typeof r.score === "number" &&
      r.score >= (minScoreByCase.get(r.caseId) ?? 70) &&
      r.expectationsMet !== false
  );

  const costs = results.map(r => r.costUsd).filter((c): c is number => typeof c === "number");
  const durations = results.filter(r => r.success).map(r => r.durationMs);

  return {
    caseCount: suite.cases.length * repeats,
    completedCount: results.length,
    meanScore: mean(scores),
    medianScore: median(scores),
    minScore: scores.length ? Math.min(...scores) : null,
    maxScore: scores.length ? Math.max(...scores) : null,
    scoreStdDev: stdDev(scores),
    passRate: results.length ? (passes.length / results.length) * 100 : null,
    totalInputTokens: results.reduce((a, r) => a + r.inputTokens, 0),
    totalOutputTokens: results.reduce((a, r) => a + r.outputTokens, 0),
    // Null when no model in the run was priced, rather than a misleading 0
    totalCostUsd: costs.length ? costs.reduce((a, c) => a + c, 0) : null,
    meanDurationMs: durations.length ? Math.round(mean(durations)!) : null,
    totalRepairs: results.reduce((a, r) => a + (r.repairCount ?? 0), 0),
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
