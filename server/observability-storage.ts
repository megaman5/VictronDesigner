import { db } from "./db";
import { sessions, aiLogs, events, errorLogs } from "@shared/schema";
import { eq, desc, gte, sql, and, count } from "drizzle-orm";

// Types for observability data
export interface SessionData {
  visitorId: string;
  userId?: string;
  userEmail?: string;
  userAgent: string;
  ip: string;
}

export interface AILogData {
  sessionId?: string;
  visitorId?: string;
  userId?: string;
  action: "generate-system" | "wire-components" | "iterate-design";
  prompt: string;
  systemVoltage: number;
  success: boolean;
  durationMs: number;
  iterations?: number;
  qualityScore?: number;
  componentCount?: number;
  wireCount?: number;
  errorMessage?: string;
  model?: string;
  response?: {
    components?: any[];
    wires?: any[];
    description?: string;
    recommendations?: string[];
  };
}

export interface EventData {
  sessionId?: string;
  visitorId?: string;
  userId?: string;
  type: "page_view" | "action" | "export" | "save" | "load" | "feedback";
  name: string;
  metadata?: Record<string, any>;
}

export interface ErrorLogData {
  sessionId?: string;
  visitorId?: string;
  userId?: string;
  type: "api_error" | "ai_error" | "validation_error" | "client_error";
  endpoint?: string;
  message: string;
  stack?: string;
  metadata?: Record<string, any>;
}

export interface ObservabilityStats {
  totalSessions: number;
  uniqueVisitors: number;
  totalAIRequests: number;
  successfulAIRequests: number;
  failedAIRequests: number;
  totalEvents: number;
  totalErrors: number;
  averageAIDuration: number;
  averageQualityScore: number;
  sessionsToday: number;
  aiRequestsToday: number;
  sessionsLast7Days: number;
  aiRequestsLast7Days: number;
}

class ObservabilityStorage {
  private sessionCache = new Map<string, { id: string; lastActivity: Date }>();

  // Session management
  async getOrCreateSession(
    visitorId: string,
    userAgent: string,
    ip: string,
    userId?: string,
    userEmail?: string
  ): Promise<{ id: string }> {
    // Check cache first
    const cached = this.sessionCache.get(visitorId);
    if (cached) {
      const now = new Date();
      // Session timeout: 30 minutes
      if (now.getTime() - cached.lastActivity.getTime() < 30 * 60 * 1000) {
        // Update last activity
        await db.update(sessions)
          .set({ 
            lastActivity: now,
            userId: userId || undefined,
            userEmail: userEmail || undefined,
          })
          .where(eq(sessions.id, cached.id));
        
        cached.lastActivity = now;
        return { id: cached.id };
      }
    }

    // Create new session
    const [session] = await db.insert(sessions)
      .values({
        visitorId,
        userId,
        userEmail,
        userAgent,
        ip,
        pageViews: 0,
        actions: 0,
      })
      .returning({ id: sessions.id });

    this.sessionCache.set(visitorId, { id: session.id, lastActivity: new Date() });
    return session;
  }

  async incrementSessionStats(sessionId: string, pageViews: number = 0, actions: number = 0) {
    await db.update(sessions)
      .set({
        pageViews: sql`${sessions.pageViews} + ${pageViews}`,
        actions: sql`${sessions.actions} + ${actions}`,
        lastActivity: new Date(),
      })
      .where(eq(sessions.id, sessionId));
  }

  // AI logging
  async logAIRequest(data: AILogData): Promise<{ id: string }> {
    const [log] = await db.insert(aiLogs)
      .values({
        sessionId: data.sessionId,
        visitorId: data.visitorId,
        userId: data.userId,
        action: data.action,
        prompt: data.prompt,
        systemVoltage: data.systemVoltage,
        success: data.success,
        durationMs: data.durationMs,
        iterations: data.iterations,
        qualityScore: data.qualityScore,
        componentCount: data.componentCount,
        wireCount: data.wireCount,
        errorMessage: data.errorMessage,
        model: data.model,
        response: data.response,
      })
      .returning({ id: aiLogs.id });

    return log;
  }

  async getAILogs(limit: number = 100, offset: number = 0) {
    return db.select()
      .from(aiLogs)
      .orderBy(desc(aiLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  // Event logging
  async logEvent(data: EventData): Promise<{ id: string }> {
    const [event] = await db.insert(events)
      .values({
        sessionId: data.sessionId,
        visitorId: data.visitorId,
        userId: data.userId,
        type: data.type,
        name: data.name,
        metadata: data.metadata,
      })
      .returning({ id: events.id });

    return event;
  }

  async getEvents(limit: number = 100, offset: number = 0) {
    return db.select()
      .from(events)
      .orderBy(desc(events.createdAt))
      .limit(limit)
      .offset(offset);
  }

  // Error logging
  async logError(data: ErrorLogData): Promise<{ id: string }> {
    const [error] = await db.insert(errorLogs)
      .values({
        sessionId: data.sessionId,
        visitorId: data.visitorId,
        userId: data.userId,
        type: data.type,
        endpoint: data.endpoint,
        message: data.message,
        stack: data.stack,
        metadata: data.metadata,
      })
      .returning({ id: errorLogs.id });

    return error;
  }

  async getErrors(limit: number = 100, offset: number = 0) {
    return db.select()
      .from(errorLogs)
      .orderBy(desc(errorLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  // Get all sessions
  async getSessions(limit: number = 100, offset: number = 0) {
    return db.select()
      .from(sessions)
      .orderBy(desc(sessions.startTime))
      .limit(limit)
      .offset(offset);
  }

  // Statistics
  async getStats(): Promise<ObservabilityStats> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last7Days = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get counts using parallel queries
    const [
      totalSessionsResult,
      uniqueVisitorsResult,
      totalAIResult,
      successfulAIResult,
      totalEventsResult,
      totalErrorsResult,
      sessionsTodayResult,
      aiTodayResult,
      sessionsLast7DaysResult,
      aiLast7DaysResult,
      avgDurationResult,
      avgQualityResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(sessions),
      db.select({ count: sql<number>`count(distinct ${sessions.visitorId})` }).from(sessions),
      db.select({ count: count() }).from(aiLogs),
      db.select({ count: count() }).from(aiLogs).where(eq(aiLogs.success, true)),
      db.select({ count: count() }).from(events),
      db.select({ count: count() }).from(errorLogs),
      db.select({ count: count() }).from(sessions).where(gte(sessions.startTime, today)),
      db.select({ count: count() }).from(aiLogs).where(gte(aiLogs.createdAt, today)),
      db.select({ count: count() }).from(sessions).where(gte(sessions.startTime, last7Days)),
      db.select({ count: count() }).from(aiLogs).where(gte(aiLogs.createdAt, last7Days)),
      db.select({ avg: sql<number>`coalesce(avg(${aiLogs.durationMs}), 0)` }).from(aiLogs).where(eq(aiLogs.success, true)),
      db.select({ avg: sql<number>`coalesce(avg(${aiLogs.qualityScore}), 0)` }).from(aiLogs).where(and(eq(aiLogs.success, true), sql`${aiLogs.qualityScore} is not null`)),
    ]);

    const totalAI = totalAIResult[0]?.count || 0;
    const successfulAI = successfulAIResult[0]?.count || 0;

    return {
      totalSessions: totalSessionsResult[0]?.count || 0,
      uniqueVisitors: uniqueVisitorsResult[0]?.count || 0,
      totalAIRequests: totalAI,
      successfulAIRequests: successfulAI,
      failedAIRequests: totalAI - successfulAI,
      totalEvents: totalEventsResult[0]?.count || 0,
      totalErrors: totalErrorsResult[0]?.count || 0,
      averageAIDuration: Math.round(avgDurationResult[0]?.avg || 0),
      averageQualityScore: Math.round((avgQualityResult[0]?.avg || 0) * 10) / 10,
      sessionsToday: sessionsTodayResult[0]?.count || 0,
      aiRequestsToday: aiTodayResult[0]?.count || 0,
      sessionsLast7Days: sessionsLast7DaysResult[0]?.count || 0,
      aiRequestsLast7Days: aiLast7DaysResult[0]?.count || 0,
    };
  }

  // Get daily analytics
  async getAnalytics(days: number = 30) {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get daily session counts
    const dailySessions = await db.select({
      date: sql<string>`date(${sessions.startTime})`,
      sessions: count(),
      uniqueVisitors: sql<number>`count(distinct ${sessions.visitorId})`,
    })
      .from(sessions)
      .where(gte(sessions.startTime, startDate))
      .groupBy(sql`date(${sessions.startTime})`)
      .orderBy(sql`date(${sessions.startTime})`);

    // Get daily AI counts
    const dailyAI = await db.select({
      date: sql<string>`date(${aiLogs.createdAt})`,
      aiRequests: count(),
      successfulAI: sql<number>`sum(case when ${aiLogs.success} then 1 else 0 end)`,
    })
      .from(aiLogs)
      .where(gte(aiLogs.createdAt, startDate))
      .groupBy(sql`date(${aiLogs.createdAt})`)
      .orderBy(sql`date(${aiLogs.createdAt})`);

    // Get daily event counts
    const dailyEvents = await db.select({
      date: sql<string>`date(${events.createdAt})`,
      events: count(),
    })
      .from(events)
      .where(gte(events.createdAt, startDate))
      .groupBy(sql`date(${events.createdAt})`)
      .orderBy(sql`date(${events.createdAt})`);

    // Merge data by date
    const dateMap = new Map<string, {
      sessions: number;
      uniqueVisitors: number;
      aiRequests: number;
      successfulAI: number;
      events: number;
    }>();

    // Initialize all dates
    for (let d = 0; d < days; d++) {
      const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split("T")[0];
      dateMap.set(key, {
        sessions: 0,
        uniqueVisitors: 0,
        aiRequests: 0,
        successfulAI: 0,
        events: 0,
      });
    }

    // Populate from queries
    for (const row of dailySessions) {
      const existing = dateMap.get(row.date) || { sessions: 0, uniqueVisitors: 0, aiRequests: 0, successfulAI: 0, events: 0 };
      existing.sessions = row.sessions;
      existing.uniqueVisitors = row.uniqueVisitors;
      dateMap.set(row.date, existing);
    }

    for (const row of dailyAI) {
      const existing = dateMap.get(row.date) || { sessions: 0, uniqueVisitors: 0, aiRequests: 0, successfulAI: 0, events: 0 };
      existing.aiRequests = row.aiRequests;
      existing.successfulAI = Number(row.successfulAI) || 0;
      dateMap.set(row.date, existing);
    }

    for (const row of dailyEvents) {
      const existing = dateMap.get(row.date) || { sessions: 0, uniqueVisitors: 0, aiRequests: 0, successfulAI: 0, events: 0 };
      existing.events = row.events;
      dateMap.set(row.date, existing);
    }

    return Array.from(dateMap.entries())
      .map(([date, stats]) => ({
        date,
        sessions: stats.sessions,
        uniqueVisitors: stats.uniqueVisitors,
        aiRequests: stats.aiRequests,
        successfulAI: stats.successfulAI,
        aiSuccessRate: stats.aiRequests > 0 
          ? Math.round((stats.successfulAI / stats.aiRequests) * 100) 
          : 0,
        events: stats.events,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // Get AI action breakdown
  async getAIActionBreakdown() {
    const breakdown = await db.select({
      action: aiLogs.action,
      total: count(),
      successful: sql<number>`sum(case when ${aiLogs.success} then 1 else 0 end)`,
      failed: sql<number>`sum(case when not ${aiLogs.success} then 1 else 0 end)`,
      avgDuration: sql<number>`coalesce(avg(${aiLogs.durationMs}), 0)`,
      avgQuality: sql<number>`coalesce(avg(case when ${aiLogs.qualityScore} is not null then ${aiLogs.qualityScore} end), 0)`,
    })
      .from(aiLogs)
      .groupBy(aiLogs.action);

    const result: Record<string, {
      total: number;
      successful: number;
      failed: number;
      avgDuration: number;
      avgQuality: number;
    }> = {};

    for (const row of breakdown) {
      result[row.action] = {
        total: row.total,
        successful: Number(row.successful) || 0,
        failed: Number(row.failed) || 0,
        avgDuration: Math.round(row.avgDuration),
        avgQuality: Math.round(row.avgQuality * 10) / 10,
      };
    }

    return result;
  }

  // Cleanup old data
  async cleanupOldData(retentionDays: number = 90) {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const [sessionsDeleted, aiLogsDeleted, eventsDeleted, errorsDeleted] = await Promise.all([
      db.delete(sessions).where(sql`${sessions.startTime} < ${cutoffDate}`).returning({ id: sessions.id }),
      db.delete(aiLogs).where(sql`${aiLogs.createdAt} < ${cutoffDate}`).returning({ id: aiLogs.id }),
      db.delete(events).where(sql`${events.createdAt} < ${cutoffDate}`).returning({ id: events.id }),
      db.delete(errorLogs).where(sql`${errorLogs.createdAt} < ${cutoffDate}`).returning({ id: errorLogs.id }),
    ]);

    return {
      sessionsRemoved: sessionsDeleted.length,
      aiLogsRemoved: aiLogsDeleted.length,
      eventsRemoved: eventsDeleted.length,
      errorsRemoved: errorsDeleted.length,
    };
  }
}

export const observabilityStorage = new ObservabilityStorage();
