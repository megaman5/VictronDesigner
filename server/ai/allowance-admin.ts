import { db } from "../db";
import { aiAllowances, aiLogs } from "@shared/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { defaultLifetimeLimitUsd, monthlyLimitUsd } from "./usage-limits";

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
  lifetimeLimitUsd: number;
  lifetimeRemainingUsd: number;
  monthSpentUsd: number;
  requests: number;
  unpricedRequests: number;
  lastUsedAt: string | null;
  /** Present only when an admin has adjusted this user. */
  spendSince: string | null;
  note: string | null;
  updatedBy: string | null;
}

function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function listUserUsage(now = new Date()): Promise<UserUsageRow[]> {
  const monthStart = startOfMonthUtc(now);

  // One row per user who has ever made a platform-billed request.
  const totals = await db
    .select({
      userId: aiLogs.userId,
      userEmail: sql<string | null>`max(${aiLogs.userEmail})`,
      requests: sql<string>`count(*)`,
      unpriced: sql<string>`count(*) filter (where ${aiLogs.costUsd} is null)`,
      lastUsedAt: sql<Date | null>`max(${aiLogs.createdAt})`,
    })
    .from(aiLogs)
    .where(and(eq(aiLogs.billedToPlatform, true), sql`${aiLogs.userId} is not null`))
    .groupBy(aiLogs.userId);

  const allowances = await db.select().from(aiAllowances);
  const byUser = new Map(allowances.map(a => [a.userId, a]));
  const defaultLimit = defaultLifetimeLimitUsd();

  const rows: UserUsageRow[] = [];
  for (const t of totals) {
    if (!t.userId) continue;
    const allowance = byUser.get(t.userId);
    const since = allowance?.spendSince ?? null;

    // Lifetime spend honours a reset; the month figure never does.
    const lifetimeFilters = [eq(aiLogs.userId, t.userId), eq(aiLogs.billedToPlatform, true)];
    if (since) lifetimeFilters.push(gte(aiLogs.createdAt, since));

    const [[lifetime], [month]] = await Promise.all([
      db
        .select({ cost: sql<string | null>`coalesce(sum(${aiLogs.costUsd}), 0)` })
        .from(aiLogs)
        .where(and(...lifetimeFilters)),
      db
        .select({ cost: sql<string | null>`coalesce(sum(${aiLogs.costUsd}), 0)` })
        .from(aiLogs)
        .where(
          and(
            eq(aiLogs.userId, t.userId),
            eq(aiLogs.billedToPlatform, true),
            gte(aiLogs.createdAt, monthStart)
          )
        ),
    ]);

    const limit = allowance?.lifetimeLimitUsd ?? defaultLimit;
    const spent = Number(lifetime?.cost ?? 0);

    rows.push({
      userId: t.userId,
      userEmail: allowance?.userEmail ?? t.userEmail ?? null,
      lifetimeSpentUsd: spent,
      lifetimeLimitUsd: limit,
      lifetimeRemainingUsd: Math.max(0, limit - spent),
      monthSpentUsd: Number(month?.cost ?? 0),
      requests: Number(t.requests ?? 0),
      unpricedRequests: Number(t.unpriced ?? 0),
      lastUsedAt: t.lastUsedAt ? new Date(t.lastUsedAt).toISOString() : null,
      spendSince: since ? new Date(since).toISOString() : null,
      note: allowance?.note ?? null,
      updatedBy: allowance?.updatedBy ?? null,
    });
  }

  // Closest to their limit first - those are the ones needing a decision.
  rows.sort((a, b) => b.lifetimeSpentUsd - a.lifetimeSpentUsd);
  return rows;
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
  setLifetimeLimit,
  grantCredit,
  resetSpend,
  monthlyLimitUsd,
  defaultLifetimeLimitUsd,
};
