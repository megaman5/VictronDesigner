import { runBenchmark, type RunOptions, type RunSummary } from "./runner";
import { benchmarkStorage } from "./storage";
import { getSuite } from "./cases";
import { getSkill } from "../skills";
import { inferProvider, type ProviderId } from "../providers";

/**
 * Ties the runner to persistence and tracks in-flight runs.
 *
 * Runs execute in the background because a suite can take minutes; callers get
 * a run id immediately and poll for results.
 */

interface ActiveRun {
  id: string;
  controller: AbortController;
  startedAt: number;
}

const active = new Map<string, ActiveRun>();

export interface StartRunInput extends Omit<RunOptions, "onResult" | "signal"> {
  label?: string;
  triggeredBy?: string;
}

export async function startBenchmarkRun(input: StartRunInput): Promise<{ runId: string }> {
  const suite = getSuite(input.suiteId);
  const skill = getSkill(suite.skillId);
  const providerId: ProviderId = input.providerId ?? inferProvider(input.model);
  const repeats = Math.max(1, input.repeats ?? 1);

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
    caseCount: suite.cases.length * repeats,
  });

  const controller = new AbortController();
  active.set(runId, { id: runId, controller, startedAt: Date.now() });

  // Fire and forget - the caller polls. Failures are recorded on the run row.
  void (async () => {
    try {
      const summary: RunSummary = await runBenchmark({
        ...input,
        providerId,
        repeats,
        signal: controller.signal,
        onResult: async result => {
          await benchmarkStorage.recordResult(runId, result);
        },
      });
      await benchmarkStorage.finishRun(runId, summary.stats, summary.samplingApplied);
    } catch (err: any) {
      console.error(`[benchmark] run ${runId} failed:`, err);
      await benchmarkStorage.failRun(runId, err?.message ?? String(err));
    } finally {
      active.delete(runId);
    }
  })();

  return { runId };
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
