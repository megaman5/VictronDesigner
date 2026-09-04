import { db } from "../../db";
import { benchmarkRuns, benchmarkResults, benchmarkExemplars } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import type { CaseResult, RunStats } from "./runner";
import type { JudgePanelResult } from "./judge";

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
  promptHash?: string | null;
  gitRev?: string | null;
  gitDirty?: boolean | null;
  judges?: string[] | null;
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
        promptHash: input.promptHash ?? null,
        gitRev: input.gitRev ?? null,
        gitDirty: input.gitDirty ?? null,
        judges: input.judges?.length ? input.judges : null,
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
      judgeScore: result.judgeScore,
      judgeStdDev: decimal(result.judgeStdDev),
      judgeCostUsd: money(result.judgeCostUsd),
      judgeDetails: result.judgeDetails ?? null,
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
        meanJudgeScore: decimal(stats.meanJudgeScore),
        totalJudgeCostUsd: money(stats.totalJudgeCostUsd),
        samplingApplied,
      })
      .where(eq(benchmarkRuns.id, runId));
  },

  /** Attach (or replace) a judge verdict on a stored result - retro-judging. */
  async recordJudgement(resultId: string, panel: JudgePanelResult): Promise<void> {
    await db
      .update(benchmarkResults)
      .set({
        judgeScore: panel.score,
        judgeStdDev: decimal(panel.stdDev),
        judgeCostUsd: money(panel.costUsd),
        judgeDetails: {
          verdicts: panel.verdicts,
          lowConfidence: panel.lowConfidence,
          usedExemplar: panel.usedExemplar,
        },
      })
      .where(eq(benchmarkResults.id, resultId));
  },

  /** Recompute a run's judge aggregates from its result rows after retro-judging. */
  async refreshRunJudgeStats(runId: string, judges: string[]): Promise<void> {
    const rows = await db
      .select({ judgeScore: benchmarkResults.judgeScore, judgeCostUsd: benchmarkResults.judgeCostUsd })
      .from(benchmarkResults)
      .where(eq(benchmarkResults.runId, runId));

    const scores = rows.map(r => r.judgeScore).filter((s): s is number => typeof s === "number");
    const costs = rows
      .map(r => (r.judgeCostUsd === null ? null : Number(r.judgeCostUsd)))
      .filter((c): c is number => typeof c === "number" && Number.isFinite(c));

    await db
      .update(benchmarkRuns)
      .set({
        judges,
        meanJudgeScore: decimal(scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null),
        totalJudgeCostUsd: money(costs.length ? costs.reduce((a, b) => a + b, 0) : null),
      })
      .where(eq(benchmarkRuns.id, runId));
  },

  /** One exemplar per case; a new one replaces the old. */
  async saveExemplar(input: {
    caseId: string;
    suiteId: string;
    model: string;
    validatorScore: number | null;
    design: { components: any[]; wires: any[] };
    notes?: string | null;
    createdBy?: string | null;
  }): Promise<void> {
    await db
      .insert(benchmarkExemplars)
      .values({
        caseId: input.caseId,
        suiteId: input.suiteId,
        model: input.model,
        validatorScore: input.validatorScore,
        design: input.design,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      })
      .onConflictDoUpdate({
        target: benchmarkExemplars.caseId,
        set: {
          suiteId: input.suiteId,
          model: input.model,
          validatorScore: input.validatorScore,
          design: input.design,
          notes: input.notes ?? null,
          createdBy: input.createdBy ?? null,
          createdAt: new Date(),
        },
      });
  },

  async listExemplars() {
    return db.select().from(benchmarkExemplars).orderBy(benchmarkExemplars.caseId);
  },

  /** Exemplar designs keyed by caseId, the shape the runner wants. */
  async exemplarsByCase(): Promise<Record<string, { components: any[]; wires: any[] }>> {
    const rows = await this.listExemplars();
    const out: Record<string, { components: any[]; wires: any[] }> = {};
    for (const row of rows) {
      const design = row.design as any;
      if (design?.components?.length) out[row.caseId] = design;
    }
    return out;
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
