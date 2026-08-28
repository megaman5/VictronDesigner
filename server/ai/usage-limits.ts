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
  /** Which cap stopped the request, when one did. */
  blockedBy?: "lifetime" | "monthly";
  limitUsd: number;
  spend: SpendWindow;
  remainingUsd: number;
  /** Total allowance across the account's life, and what is left of it. */
  lifetimeLimitUsd: number;
  lifetimeSpentUsd: number;
  lifetimeRemainingUsd: number;
  /** Set when an admin has reset the user - lifetime spend counts from here. */
  lifetimeSince?: Date;
}

export const DEFAULT_MONTHLY_LIMIT_USD = 5;
export const DEFAULT_LIFETIME_LIMIT_USD = 10;

export function monthlyLimitUsd(): number {
  const raw = process.env.AI_MONTHLY_LIMIT_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_LIMIT_USD;
}

/** Global default lifetime allowance, before any per-user override. */
export function defaultLifetimeLimitUsd(): number {
  const raw = process.env.AI_LIFETIME_LIMIT_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LIFETIME_LIMIT_USD;
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

/** The per-user allowance row, if an admin has ever adjusted this user. */
export async function getAllowance(userId: string) {
  const { db } = await import("../db");
  const { aiAllowances } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const [row] = await db.select().from(aiAllowances).where(eq(aiAllowances.userId, userId));
  return row ?? null;
}

/**
 * Platform-billed spend for a user over the whole life of their account,
 * or since an admin reset them.
 */
export async function getLifetimeSpend(
  userId: string,
  since?: Date | null
): Promise<{ costUsd: number; requests: number; unpricedRequests: number }> {
  const { db } = await import("../db");
  const { aiLogs } = await import("@shared/schema");
  const { and, eq, gte, sql } = await import("drizzle-orm");

  const filters = [eq(aiLogs.userId, userId), eq(aiLogs.billedToPlatform, true)];
  if (since) filters.push(gte(aiLogs.createdAt, since));

  const [row] = await db
    .select({
      costUsd: sql<string | null>`coalesce(sum(${aiLogs.costUsd}), 0)`,
      requests: sql<string>`count(*)`,
      unpriced: sql<string>`count(*) filter (where ${aiLogs.costUsd} is null)`,
    })
    .from(aiLogs)
    .where(and(...filters));

  return {
    costUsd: Number(row?.costUsd ?? 0),
    requests: Number(row?.requests ?? 0),
    unpricedRequests: Number(row?.unpriced ?? 0),
  };
}

/**
 * Decide whether a request may proceed on the platform key.
 * BYOK callers should skip this entirely - it is not our spend.
 *
 * Two caps apply and both must pass: a lifetime allowance (the free credit
 * someone gets, topped up by an admin) and the monthly cap (a rate limit, so
 * one user cannot burn a whole month's budget in an afternoon).
 */
export async function checkQuota(userId: string, now = new Date()): Promise<QuotaDecision> {
  const limitUsd = monthlyLimitUsd();
  const allowance = await getAllowance(userId);
  const lifetimeLimitUsd = allowance?.lifetimeLimitUsd ?? defaultLifetimeLimitUsd();
  const lifetimeSince = allowance?.spendSince ?? undefined;

  const [spend, lifetime] = await Promise.all([
    getMonthlySpend(userId, now),
    getLifetimeSpend(userId, lifetimeSince),
  ]);

  const remainingUsd = Math.max(0, limitUsd - spend.costUsd);
  const lifetimeRemainingUsd = Math.max(0, lifetimeLimitUsd - lifetime.costUsd);

  const lifetimeExhausted = lifetime.costUsd >= lifetimeLimitUsd;
  const monthlyExhausted = spend.costUsd >= limitUsd;
  const allowed = !lifetimeExhausted && !monthlyExhausted;

  // Lifetime is reported first: it is the one the user has to do something
  // about, whereas the monthly cap clears on its own.
  const blockedBy = lifetimeExhausted ? "lifetime" : monthlyExhausted ? "monthly" : undefined;

  const reason = lifetimeExhausted
    ? `Free AI allowance of $${lifetimeLimitUsd.toFixed(2)} used up (spent $${lifetime.costUsd.toFixed(2)}). Add your own API key to keep going, or use the tip button and I will credit you with more.`
    : monthlyExhausted
      ? `Monthly AI limit of $${limitUsd.toFixed(2)} reached (used $${spend.costUsd.toFixed(2)}). Add your own API key to keep going, or wait for the limit to reset.`
      : undefined;

  return {
    allowed,
    blockedBy,
    limitUsd,
    spend,
    remainingUsd,
    lifetimeLimitUsd,
    lifetimeSpentUsd: lifetime.costUsd,
    lifetimeRemainingUsd,
    lifetimeSince,
    reason,
  };
}
