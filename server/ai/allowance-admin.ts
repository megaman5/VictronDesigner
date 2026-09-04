import { db } from "../db";
import { aiAllowances, aiLogs } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { defaultLifetimeLimitUsd, monthlyLimitUsd } from "./usage-limits";
import { estimateFallbackCostUsd } from "./pricing";

/**
 * Admin view of AI spend per user, and the controls to top someone up.
 *
 * The list is built from ai_logs rather than from the allowance table, because
 * a row in ai_allowances only exists once someone has been adjusted - most
 * users will never have one, and they still need to show up here.
 */

export interface UserUsageRow {
  userId: string;
  userEmail: string | null;
  lifetimeSpentUsd: number;
  /** lifetimeSpentUsd plus a flat estimate for requests with no recorded cost. */
  lifetimeEstimatedUsd: number;
  lifetimeLimitUsd: number;
  lifetimeRemainingUsd: number;
  monthSpentUsd: number;
  monthEstimatedUsd: number;
  requests: number;
  unpricedRequests: number;
  /** The estimated-only portion attributable to unpriced requests (lifetime). */
  unpricedEstimatedUsd: number;
  lastUsedAt: string | null;
  /** Present only when an admin has adjusted this user. */
  spendSince: string | null;
  note: string | null;
  updatedBy: string | null;
}

function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

interface LogRow {
  userId: string;
  userEmail: string | null;
  model: string | null;
  costUsd: string | null;
  createdAt: Date;
}

export async function listUserUsage(now = new Date()): Promise<UserUsageRow[]> {
  const monthStart = startOfMonthUtc(now);

  // Pulled once and aggregated in JS - the estimate depends on each row's
  // model, which isn't something a single SQL sum can apply per user.
  const logs = await db
    .select({
      userId: aiLogs.userId,
      userEmail: aiLogs.userEmail,
      model: aiLogs.model,
      costUsd: aiLogs.costUsd,
      createdAt: aiLogs.createdAt,
    })
    .from(aiLogs)
    .where(and(eq(aiLogs.billedToPlatform, true), sql`${aiLogs.userId} is not null`));

  const allowances = await db.select().from(aiAllowances);
  const byUser = new Map(allowances.map(a => [a.userId, a]));
  const defaultLimit = defaultLifetimeLimitUsd();

  const byUserId = new Map<string, LogRow[]>();
  for (const log of logs) {
    if (!log.userId) continue;
    const row: LogRow = { ...log, userId: log.userId };
    const list = byUserId.get(row.userId);
    if (list) list.push(row);
    else byUserId.set(row.userId, [row]);
  }

  const rows: UserUsageRow[] = [];
  for (const [userId, userLogs] of Array.from(byUserId)) {
    const allowance = byUser.get(userId);
    const since = allowance?.spendSince ?? null;

    let userEmail: string | null = null;
    let lastUsedAt: Date | null = null;
    let lifetimeSpent = 0;
    let lifetimeEstimated = 0;
    let monthSpent = 0;
    let monthEstimated = 0;
    let requests = 0;
    let unpricedRequests = 0;
    let unpricedEstimated = 0;

    for (const log of userLogs) {
      if (log.userEmail) userEmail = log.userEmail;
      if (!lastUsedAt || log.createdAt > lastUsedAt) lastUsedAt = log.createdAt;

      // Lifetime spend honours a reset; the month figure never does.
      const inLifetimeWindow = !since || log.createdAt >= since;
      if (!inLifetimeWindow) continue;

      requests++;
      const real = log.costUsd !== null ? Number(log.costUsd) : null;
      const estimate = real ?? estimateFallbackCostUsd(log.model);

      if (real !== null) {
        lifetimeSpent += real;
      } else {
        unpricedRequests++;
        unpricedEstimated += estimate;
      }
      lifetimeEstimated += estimate;

      if (log.createdAt >= monthStart) {
        monthSpent += real ?? 0;
        monthEstimated += estimate;
      }
    }

    const limit = allowance?.lifetimeLimitUsd ?? defaultLimit;

    rows.push({
      userId,
      userEmail: allowance?.userEmail ?? userEmail,
      lifetimeSpentUsd: lifetimeSpent,
      lifetimeEstimatedUsd: lifetimeEstimated,
      lifetimeLimitUsd: limit,
      lifetimeRemainingUsd: Math.max(0, limit - lifetimeSpent),
      monthSpentUsd: monthSpent,
      monthEstimatedUsd: monthEstimated,
      requests,
      unpricedRequests,
      unpricedEstimatedUsd: unpricedEstimated,
      lastUsedAt: lastUsedAt ? lastUsedAt.toISOString() : null,
      spendSince: since ? new Date(since).toISOString() : null,
      note: allowance?.note ?? null,
      updatedBy: allowance?.updatedBy ?? null,
    });
  }

  // Closest to their limit first - those are the ones needing a decision.
  // Ranked by the estimated total so unpriced-heavy users aren't buried at
  // the bottom just because their real cost_usd sum happens to be $0.
  rows.sort((a, b) => b.lifetimeEstimatedUsd - a.lifetimeEstimatedUsd);
  return rows;
}

export interface DailyUsage {
  date: string; // YYYY-MM-DD, UTC
  costUsd: number;
  estimatedCostUsd: number;
  requests: number;
}

/** Daily spend across all users, for the usage-over-time chart. */
export async function listDailyUsage(days = 90, now = new Date()): Promise<DailyUsage[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${aiLogs.createdAt}), 'YYYY-MM-DD')`,
      model: aiLogs.model,
      realCost: sql<string | null>`coalesce(sum(${aiLogs.costUsd}), 0)`,
      unpriced: sql<string>`count(*) filter (where ${aiLogs.costUsd} is null)`,
      requests: sql<string>`count(*)`,
    })
    .from(aiLogs)
    .where(and(eq(aiLogs.billedToPlatform, true), sql`${aiLogs.createdAt} >= ${since}`))
    .groupBy(sql`date_trunc('day', ${aiLogs.createdAt})`, aiLogs.model);

  const byDay = new Map<string, DailyUsage>();
  for (const r of rows) {
    const existing = byDay.get(r.day) ?? { date: r.day, costUsd: 0, estimatedCostUsd: 0, requests: 0 };
    const real = Number(r.realCost ?? 0);
    const unpricedCount = Number(r.unpriced ?? 0);
    existing.costUsd += real;
    existing.estimatedCostUsd += real + unpricedCount * estimateFallbackCostUsd(r.model);
    existing.requests += Number(r.requests ?? 0);
    byDay.set(r.day, existing);
  }

  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}

async function upsertAllowance(
  userId: string,
  values: Partial<typeof aiAllowances.$inferInsert>,
  adminEmail: string
) {
  const [row] = await db
    .insert(aiAllowances)
    .values({ userId, ...values, updatedBy: adminEmail, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: aiAllowances.userId,
      set: { ...values, updatedBy: adminEmail, updatedAt: new Date() },
    })
    .returning();
  return row;
}

/** Set this user's total allowance to an explicit dollar figure. */
export async function setLifetimeLimit(
  userId: string,
  limitUsd: number,
  adminEmail: string,
  note?: string
) {
  return upsertAllowance(userId, { lifetimeLimitUsd: limitUsd, note: note ?? null }, adminEmail);
}

/** Add to whatever this user's allowance currently is (the "tipped me" path). */
export async function grantCredit(
  userId: string,
  amountUsd: number,
  adminEmail: string,
  note?: string
) {
  const [existing] = await db.select().from(aiAllowances).where(eq(aiAllowances.userId, userId));
  const current = existing?.lifetimeLimitUsd ?? defaultLifetimeLimitUsd();
  return upsertAllowance(
    userId,
    { lifetimeLimitUsd: current + amountUsd, note: note ?? existing?.note ?? null },
    adminEmail
  );
}

/**
 * Zero someone's counted spend by only counting from now on. Their ai_logs
 * history is left intact - this is an accounting boundary, not a deletion.
 */
export async function resetSpend(userId: string, adminEmail: string, note?: string) {
  return upsertAllowance(userId, { spendSince: new Date(), note: note ?? null }, adminEmail);
}

export const allowanceAdmin = {
  listUserUsage,
  listDailyUsage,
  setLifetimeLimit,
  grantCredit,
  resetSpend,
  monthlyLimitUsd,
  defaultLifetimeLimitUsd,
};
