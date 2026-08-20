import { db } from "../../db";
import { benchmarkRuns, benchmarkResults } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import type { CaseResult, RunStats } from "./runner";

/** Persistence for benchmark runs so results can be compared over time. */

export interface CreateRunInput {
  suiteId: string;
  skillId: string;
  skillVersion: string;
  provider: string;
  model: string;
  repeats: number;
  temperature?: number;
  seed?: number;
  label?: string;
  triggeredBy?: string;
  caseCount: number;
}

const money = (n: number | null | undefined) =>
  typeof n === "number" ? n.toFixed(6) : null;
const decimal = (n: number | null | undefined, dp = 2) =>
  typeof n === "number" ? n.toFixed(dp) : null;

export const benchmarkStorage = {
  async createRun(input: CreateRunInput): Promise<string> {
    const [row] = await db
      .insert(benchmarkRuns)
      .values({
        suiteId: input.suiteId,
        skillId: input.skillId,
        skillVersion: input.skillVersion,
        provider: input.provider,
        model: input.model,
        repeats: input.repeats,
        temperature: decimal(input.temperature),
        seed: input.seed ?? null,
        label: input.label ?? null,
        triggeredBy: input.triggeredBy ?? null,
        caseCount: input.caseCount,
        status: "running",
      })
      .returning({ id: benchmarkRuns.id });
    return row.id;
  },

  async recordResult(runId: string, result: CaseResult): Promise<void> {
    await db.insert(benchmarkResults).values({
      runId,
      caseId: result.caseId,
      repeat: result.repeat,
      success: result.success,
      score: result.score,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      componentCount: result.componentCount,
      wireCount: result.wireCount,
      repairCount: result.repairCount,
      iterationsUsed: result.iterationsUsed,
      scorePath: result.scorePath.length ? result.scorePath : null,
      expectationsMet: result.expectationsMet,
      failedExpectations: result.failedExpectations.length ? result.failedExpectations : null,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: money(result.costUsd),
      durationMs: result.durationMs,
      errorMessage: result.errorMessage ?? null,
      issues: result.issues ?? null,
      output: result.output ?? null,
    });

    await db
      .update(benchmarkRuns)
      .set({ completedCount: (await this.countResults(runId)) })
      .where(eq(benchmarkRuns.id, runId));
  },

  async countResults(runId: string): Promise<number> {
    const rows = await db
      .select({ id: benchmarkResults.id })
      .from(benchmarkResults)
      .where(eq(benchmarkResults.runId, runId));
    return rows.length;
  },

  async finishRun(
    runId: string,
    stats: RunStats,
    samplingApplied: boolean | null
  ): Promise<void> {
    await db
      .update(benchmarkRuns)
      .set({
        status: "completed",
        finishedAt: new Date(),
        completedCount: stats.completedCount,
        meanScore: decimal(stats.meanScore),
        medianScore: decimal(stats.medianScore),
        minScore: stats.minScore,
        maxScore: stats.maxScore,
        passRate: decimal(stats.passRate),
        totalCostUsd: money(stats.totalCostUsd),
        totalInputTokens: stats.totalInputTokens,
        totalOutputTokens: stats.totalOutputTokens,
        meanDurationMs: stats.meanDurationMs,
        samplingApplied,
      })
      .where(eq(benchmarkRuns.id, runId));
  },

  async failRun(runId: string, message: string): Promise<void> {
    await db
      .update(benchmarkRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: message.slice(0, 2000) })
      .where(eq(benchmarkRuns.id, runId));
  },

  async listRuns(limit = 50) {
    return db.select().from(benchmarkRuns).orderBy(desc(benchmarkRuns.startedAt)).limit(limit);
  },

  async getRun(runId: string) {
    const [run] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, runId));
    if (!run) return null;
    const results = await db
      .select()
      .from(benchmarkResults)
      .where(eq(benchmarkResults.runId, runId))
      .orderBy(benchmarkResults.caseId, benchmarkResults.repeat);
    return { run, results };
  },

  /** Latest completed run per model for a suite, for side-by-side comparison. */
  async compareSuite(suiteId: string, limit = 20) {
    return db
      .select()
      .from(benchmarkRuns)
      .where(and(eq(benchmarkRuns.suiteId, suiteId), eq(benchmarkRuns.status, "completed")))
      .orderBy(desc(benchmarkRuns.startedAt))
      .limit(limit);
  },
};
