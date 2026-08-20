// The database is imported lazily inside the query below. Importing it at
// module load makes this file - and anything that imports it - impossible to
// unit test without a live DATABASE_URL, which is exactly why the AI wiring
// integration test has never been runnable.

/**
 * Monthly spend caps for AI usage on the platform's API keys.
 *
 * Only platform-billed requests count. If someone supplies their own key the
 * spend is theirs, so it is recorded but never counted against a cap.
 *
 * Cost is an estimate from published list prices, not a bill. Models with no
 * price entry contribute nothing, which means a cap can under-count - so
 * `unpricedRequests` is surfaced rather than hidden.
 */

export interface SpendWindow {
  /** Start of the current calendar month, UTC. */
  since: Date;
  costUsd: number;
  requests: number;
  /** Requests whose model had no price entry, so cost is unknown. */
  unpricedRequests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface QuotaDecision {
  allowed: boolean;
  reason?: string;
  limitUsd: number;
  spend: SpendWindow;
  remainingUsd: number;
}

export const DEFAULT_MONTHLY_LIMIT_USD = 5;

export function monthlyLimitUsd(): number {
  const raw = process.env.AI_MONTHLY_LIMIT_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_LIMIT_USD;
}

function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Platform-billed spend for a user in the current calendar month. */
export async function getMonthlySpend(userId: string, now = new Date()): Promise<SpendWindow> {
  const since = startOfMonthUtc(now);

  const { db } = await import("../db");
  const { aiLogs } = await import("@shared/schema");
  const { and, eq, gte, sql } = await import("drizzle-orm");

  const [row] = await db
    .select({
      costUsd: sql<string | null>`coalesce(sum(${aiLogs.costUsd}), 0)`,
      requests: sql<string>`count(*)`,
      unpriced: sql<string>`count(*) filter (where ${aiLogs.costUsd} is null)`,
      inputTokens: sql<string | null>`coalesce(sum(${aiLogs.inputTokens}), 0)`,
      outputTokens: sql<string | null>`coalesce(sum(${aiLogs.outputTokens}), 0)`,
    })
    .from(aiLogs)
    .where(
      and(
        eq(aiLogs.userId, userId),
        eq(aiLogs.billedToPlatform, true),
        gte(aiLogs.createdAt, since)
      )
    );

  return {
    since,
    costUsd: Number(row?.costUsd ?? 0),
    requests: Number(row?.requests ?? 0),
    unpricedRequests: Number(row?.unpriced ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
  };
}

/**
 * Decide whether a request may proceed on the platform key.
 * BYOK callers should skip this entirely - it is not our spend.
 */
export async function checkQuota(userId: string, now = new Date()): Promise<QuotaDecision> {
  const limitUsd = monthlyLimitUsd();
  const spend = await getMonthlySpend(userId, now);
  const remainingUsd = Math.max(0, limitUsd - spend.costUsd);
  const allowed = spend.costUsd < limitUsd;

  return {
    allowed,
    limitUsd,
    spend,
    remainingUsd,
    reason: allowed
      ? undefined
      : `Monthly AI limit of $${limitUsd.toFixed(2)} reached (used $${spend.costUsd.toFixed(2)}). Add your own API key to keep going, or wait for the limit to reset.`,
  };
}
