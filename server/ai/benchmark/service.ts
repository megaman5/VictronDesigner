import { execSync } from "child_process";
import { runBenchmark, type CaseResult, type RunOptions, type RunSummary } from "./runner";
import { benchmarkStorage } from "./storage";
import { getSuite } from "./cases";
import { getSkill, skillFingerprint } from "../skills";
import { availableJudges, DEFAULT_JUDGE_MODELS } from "./judge";
import { inferProvider, type ProviderId } from "../providers";

/**
 * Ties the runner to persistence and tracks in-flight runs.
 *
 * The admin API starts runs in the background (a suite can take minutes;
 * callers poll). The CLI awaits the same execution path so results land in
 * the terminal - both go through prepare + execute so every run row carries
 * the same provenance (prompt hash, git state, judge panel).
 */

interface ActiveRun {
  id: string;
  controller: AbortController;
  startedAt: number;
}

const active = new Map<string, ActiveRun>();

export interface StartRunInput extends Omit<RunOptions, "onResult" | "signal" | "exemplars"> {
  label?: string;
  triggeredBy?: string;
  /**
   * True = judge with the default panel (filtered to available keys);
   * an explicit judges array in RunOptions wins over this flag.
   */
  judge?: boolean;
}

/** Where this run's prompt actually came from - recorded, never trusted from input. */
function gitState(): { rev: string | null; dirty: boolean | null } {
  try {
    // safe.directory: the CLI often runs under sudo, and git refuses a repo
    // owned by another user without it.
    const git = (args: string) =>
      execSync(`git -c safe.directory='*' ${args}`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    const rev = git("rev-parse --short HEAD");
    const dirty = git("status --porcelain").length > 0;
    return { rev, dirty };
  } catch {
    // Production runs from dist without git context - provenance is just absent.
    return { rev: null, dirty: null };
  }
}

export function resolveJudgePanel(input: StartRunInput): string[] {
  if (input.judges?.length) return input.judges;
  if (!input.judge) return [];
  const panel = availableJudges();
  if (!panel.length) {
    throw new Error(
      `No judge model is callable - none of [${DEFAULT_JUDGE_MODELS.join(", ")}] has a platform key set.`
    );
  }
  return panel;
}

async function prepareRun(input: StartRunInput): Promise<{
  runId: string;
  options: Omit<RunOptions, "onResult" | "signal">;
}> {
  const suite = getSuite(input.suiteId);
  const skill = getSkill(suite.skillId);
  const providerId: ProviderId = input.providerId ?? inferProvider(input.model);
  const repeats = Math.max(1, input.repeats ?? 1);
  const judges = resolveJudgePanel(input);
  const git = gitState();

  const caseCount =
    (input.caseIds?.length
      ? suite.cases.filter(c => input.caseIds!.includes(c.id)).length
      : suite.cases.length) * repeats;

  const runId = await benchmarkStorage.createRun({
    suiteId: suite.id,
    skillId: skill.id,
    skillVersion: skill.version,
    provider: providerId,
    model: input.model,
    repeats,
    temperature: input.temperature,
    seed: input.seed,
    label: input.label,
    triggeredBy: input.triggeredBy,
    caseCount,
    promptHash: skillFingerprint(skill),
    gitRev: git.rev,
    gitDirty: git.dirty,
    judges,
  });

  const exemplars = judges.length ? await benchmarkStorage.exemplarsByCase() : undefined;

  const { label, triggeredBy, judge, ...runOptions } = input;
  return {
    runId,
    options: { ...runOptions, providerId, repeats, judges, exemplars },
  };
}

async function executeRun(
  runId: string,
  options: Omit<RunOptions, "onResult" | "signal">,
  onResult?: (result: CaseResult) => void | Promise<void>
): Promise<RunSummary> {
  const controller = new AbortController();
  active.set(runId, { id: runId, controller, startedAt: Date.now() });

  try {
    const summary = await runBenchmark({
      ...options,
      signal: controller.signal,
      onResult: async result => {
        await benchmarkStorage.recordResult(runId, result);
        await onResult?.(result);
      },
    });
    await benchmarkStorage.finishRun(runId, summary.stats, summary.samplingApplied);
    return summary;
  } catch (err: any) {
    console.error(`[benchmark] run ${runId} failed:`, err);
    await benchmarkStorage.failRun(runId, err?.message ?? String(err));
    throw err;
  } finally {
    active.delete(runId);
  }
}

/** Fire-and-forget, for the admin API - the caller polls for results. */
export async function startBenchmarkRun(input: StartRunInput): Promise<{ runId: string }> {
  const { runId, options } = await prepareRun(input);
  void executeRun(runId, options).catch(() => {
    /* recorded on the run row */
  });
  return { runId };
}

/** Await the whole run, for the CLI. */
export async function runBenchmarkToCompletion(
  input: StartRunInput,
  onResult?: (result: CaseResult) => void | Promise<void>
): Promise<{ runId: string; summary: RunSummary }> {
  const { runId, options } = await prepareRun(input);
  const summary = await executeRun(runId, options, onResult);
  return { runId, summary };
}

export function cancelBenchmarkRun(runId: string): boolean {
  const run = active.get(runId);
  if (!run) return false;
  run.controller.abort();
  return true;
}

export function listActiveRuns() {
  return Array.from(active.values()).map(r => ({
    runId: r.id,
    startedAt: new Date(r.startedAt).toISOString(),
    elapsedMs: Date.now() - r.startedAt,
  }));
}
