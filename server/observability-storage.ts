import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OBSERVABILITY_DIR = path.join(__dirname, "..", "observability-data");
const SESSIONS_FILE = path.join(OBSERVABILITY_DIR, "sessions.json");
const AI_LOGS_FILE = path.join(OBSERVABILITY_DIR, "ai-logs.json");
const EVENTS_FILE = path.join(OBSERVABILITY_DIR, "events.json");
const ERRORS_FILE = path.join(OBSERVABILITY_DIR, "errors.json");

// Types for observability data

export interface Session {
  id: string;
  visitorId: string; // fingerprint or cookie-based
  userId?: string; // if logged in
  userEmail?: string;
  startTime: string;
  lastActivity: string;
  userAgent: string;
  ip: string;
  pageViews: number;
  actions: number;
}

export interface AILog {
  id: string;
  timestamp: string;
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
}

export interface Event {
  id: string;
  timestamp: string;
  sessionId?: string;
  visitorId?: string;
  userId?: string;
  type: "page_view" | "action" | "export" | "save" | "load" | "feedback";
  name: string;
  metadata?: Record<string, any>;
}

export interface ErrorLog {
  id: string;
  timestamp: string;
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
  private sessionCache = new Map<string, Session>();

  constructor() {
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists() {
    if (!fs.existsSync(OBSERVABILITY_DIR)) {
      fs.mkdirSync(OBSERVABILITY_DIR, { recursive: true });
    }
    
    const files = [SESSIONS_FILE, AI_LOGS_FILE, EVENTS_FILE, ERRORS_FILE];
    for (const file of files) {
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
      }
    }
  }

  private readFile<T>(filePath: string): T[] {
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading ${filePath}:`, error);
      return [];
    }
  }

  private writeFile<T>(filePath: string, data: T[]) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Error writing ${filePath}:`, error);
    }
  }

  // Session management
  async getOrCreateSession(
    visitorId: string,
    userAgent: string,
    ip: string,
    userId?: string,
    userEmail?: string
  ): Promise<Session> {
    // Check cache first
    if (this.sessionCache.has(visitorId)) {
      const session = this.sessionCache.get(visitorId)!;
      const lastActivity = new Date(session.lastActivity);
      const now = new Date();
      
      // Session timeout: 30 minutes
      if (now.getTime() - lastActivity.getTime() < 30 * 60 * 1000) {
        session.lastActivity = now.toISOString();
        if (userId) session.userId = userId;
        if (userEmail) session.userEmail = userEmail;
        this.sessionCache.set(visitorId, session);
        return session;
      }
    }

    // Create new session
    const session: Session = {
      id: randomUUID(),
      visitorId,
      userId,
      userEmail,
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      userAgent,
      ip,
      pageViews: 0,
      actions: 0,
    };

    this.sessionCache.set(visitorId, session);
    
    // Persist to file
    const sessions = this.readFile<Session>(SESSIONS_FILE);
    sessions.push(session);
    this.writeFile(SESSIONS_FILE, sessions);

    return session;
  }

  async updateSession(sessionId: string, updates: Partial<Session>) {
    const sessions = this.readFile<Session>(SESSIONS_FILE);
    const index = sessions.findIndex(s => s.id === sessionId);
    
    if (index !== -1) {
      sessions[index] = { ...sessions[index], ...updates };
      this.writeFile(SESSIONS_FILE, sessions);
      
      // Update cache
      const visitorId = sessions[index].visitorId;
      if (this.sessionCache.has(visitorId)) {
        this.sessionCache.set(visitorId, sessions[index]);
      }
    }
  }

  async incrementSessionStats(sessionId: string, pageViews: number = 0, actions: number = 0) {
    const sessions = this.readFile<Session>(SESSIONS_FILE);
    const index = sessions.findIndex(s => s.id === sessionId);
    
    if (index !== -1) {
      sessions[index].pageViews += pageViews;
      sessions[index].actions += actions;
      sessions[index].lastActivity = new Date().toISOString();
      this.writeFile(SESSIONS_FILE, sessions);
    }
  }

  // AI logging
  async logAIRequest(data: Omit<AILog, "id" | "timestamp">): Promise<AILog> {
    const log: AILog = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...data,
    };

    const logs = this.readFile<AILog>(AI_LOGS_FILE);
    logs.push(log);
    this.writeFile(AI_LOGS_FILE, logs);

    return log;
  }

  async getAILogs(limit: number = 100, offset: number = 0): Promise<AILog[]> {
    const logs = this.readFile<AILog>(AI_LOGS_FILE);
    return logs
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(offset, offset + limit);
  }

  // Event logging
  async logEvent(data: Omit<Event, "id" | "timestamp">): Promise<Event> {
    const event: Event = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...data,
    };

    const events = this.readFile<Event>(EVENTS_FILE);
    events.push(event);
    this.writeFile(EVENTS_FILE, events);

    return event;
  }

  async getEvents(limit: number = 100, offset: number = 0): Promise<Event[]> {
    const events = this.readFile<Event>(EVENTS_FILE);
    return events
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(offset, offset + limit);
  }

  // Error logging
  async logError(data: Omit<ErrorLog, "id" | "timestamp">): Promise<ErrorLog> {
    const error: ErrorLog = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...data,
    };

    const errors = this.readFile<ErrorLog>(ERRORS_FILE);
    errors.push(error);
    this.writeFile(ERRORS_FILE, errors);

    return error;
  }

  async getErrors(limit: number = 100, offset: number = 0): Promise<ErrorLog[]> {
    const errors = this.readFile<ErrorLog>(ERRORS_FILE);
    return errors
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(offset, offset + limit);
  }

  // Get all sessions
  async getSessions(limit: number = 100, offset: number = 0): Promise<Session[]> {
    const sessions = this.readFile<Session>(SESSIONS_FILE);
    return sessions
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
      .slice(offset, offset + limit);
  }

  // Statistics
  async getStats(): Promise<ObservabilityStats> {
    const sessions = this.readFile<Session>(SESSIONS_FILE);
    const aiLogs = this.readFile<AILog>(AI_LOGS_FILE);
    const events = this.readFile<Event>(EVENTS_FILE);
    const errors = this.readFile<ErrorLog>(ERRORS_FILE);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last7Days = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const uniqueVisitors = new Set(sessions.map(s => s.visitorId)).size;
    
    const successfulAI = aiLogs.filter(l => l.success);
    const failedAI = aiLogs.filter(l => !l.success);
    
    const aiDurations = successfulAI.map(l => l.durationMs).filter(d => d > 0);
    const averageAIDuration = aiDurations.length > 0 
      ? aiDurations.reduce((a, b) => a + b, 0) / aiDurations.length 
      : 0;

    const qualityScores = aiLogs
      .map(l => l.qualityScore)
      .filter((s): s is number => s !== undefined && s > 0);
    const averageQualityScore = qualityScores.length > 0
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : 0;

    const sessionsToday = sessions.filter(s => new Date(s.startTime) >= today).length;
    const aiRequestsToday = aiLogs.filter(l => new Date(l.timestamp) >= today).length;
    
    const sessionsLast7Days = sessions.filter(s => new Date(s.startTime) >= last7Days).length;
    const aiRequestsLast7Days = aiLogs.filter(l => new Date(l.timestamp) >= last7Days).length;

    return {
      totalSessions: sessions.length,
      uniqueVisitors,
      totalAIRequests: aiLogs.length,
      successfulAIRequests: successfulAI.length,
      failedAIRequests: failedAI.length,
      totalEvents: events.length,
      totalErrors: errors.length,
      averageAIDuration: Math.round(averageAIDuration),
      averageQualityScore: Math.round(averageQualityScore * 10) / 10,
      sessionsToday,
      aiRequestsToday,
      sessionsLast7Days,
      aiRequestsLast7Days,
    };
  }

  // Get detailed analytics
  async getAnalytics(days: number = 30) {
    const sessions = this.readFile<Session>(SESSIONS_FILE);
    const aiLogs = this.readFile<AILog>(AI_LOGS_FILE);
    const events = this.readFile<Event>(EVENTS_FILE);

    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Group by day
    const dailyStats: Record<string, {
      sessions: number;
      aiRequests: number;
      successfulAI: number;
      events: number;
      uniqueVisitors: Set<string>;
    }> = {};

    // Initialize all days
    for (let d = 0; d < days; d++) {
      const date = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split("T")[0];
      dailyStats[key] = {
        sessions: 0,
        aiRequests: 0,
        successfulAI: 0,
        events: 0,
        uniqueVisitors: new Set(),
      };
    }

    // Populate from data
    for (const session of sessions) {
      const date = session.startTime.split("T")[0];
      if (dailyStats[date]) {
        dailyStats[date].sessions++;
        dailyStats[date].uniqueVisitors.add(session.visitorId);
      }
    }

    for (const log of aiLogs) {
      const date = log.timestamp.split("T")[0];
      if (dailyStats[date]) {
        dailyStats[date].aiRequests++;
        if (log.success) dailyStats[date].successfulAI++;
      }
    }

    for (const event of events) {
      const date = event.timestamp.split("T")[0];
      if (dailyStats[date]) {
        dailyStats[date].events++;
      }
    }

    // Convert to array
    return Object.entries(dailyStats)
      .map(([date, stats]) => ({
        date,
        sessions: stats.sessions,
        uniqueVisitors: stats.uniqueVisitors.size,
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
    const aiLogs = this.readFile<AILog>(AI_LOGS_FILE);
    
    const breakdown: Record<string, {
      total: number;
      successful: number;
      failed: number;
      avgDuration: number;
      avgQuality: number;
    }> = {};

    for (const log of aiLogs) {
      if (!breakdown[log.action]) {
        breakdown[log.action] = {
          total: 0,
          successful: 0,
          failed: 0,
          avgDuration: 0,
          avgQuality: 0,
        };
      }

      const b = breakdown[log.action];
      b.total++;
      if (log.success) {
        b.successful++;
      } else {
        b.failed++;
      }
    }

    // Calculate averages
    for (const action of Object.keys(breakdown)) {
      const logs = aiLogs.filter(l => l.action === action);
      const durations = logs.map(l => l.durationMs).filter(d => d > 0);
      const qualities = logs.map(l => l.qualityScore).filter((q): q is number => q !== undefined);
      
      breakdown[action].avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
      breakdown[action].avgQuality = qualities.length > 0
        ? Math.round((qualities.reduce((a, b) => a + b, 0) / qualities.length) * 10) / 10
        : 0;
    }

    return breakdown;
  }

  // Clear old data (retention policy)
  async cleanupOldData(retentionDays: number = 90) {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const sessions = this.readFile<Session>(SESSIONS_FILE);
    const aiLogs = this.readFile<AILog>(AI_LOGS_FILE);
    const events = this.readFile<Event>(EVENTS_FILE);
    const errors = this.readFile<ErrorLog>(ERRORS_FILE);

    const filteredSessions = sessions.filter(s => s.startTime > cutoffDate);
    const filteredAILogs = aiLogs.filter(l => l.timestamp > cutoffDate);
    const filteredEvents = events.filter(e => e.timestamp > cutoffDate);
    const filteredErrors = errors.filter(e => e.timestamp > cutoffDate);

    this.writeFile(SESSIONS_FILE, filteredSessions);
    this.writeFile(AI_LOGS_FILE, filteredAILogs);
    this.writeFile(EVENTS_FILE, filteredEvents);
    this.writeFile(ERRORS_FILE, filteredErrors);

    return {
      sessionsRemoved: sessions.length - filteredSessions.length,
      aiLogsRemoved: aiLogs.length - filteredAILogs.length,
      eventsRemoved: events.length - filteredEvents.length,
      errorsRemoved: errors.length - filteredErrors.length,
    };
  }
}

export const observabilityStorage = new ObservabilityStorage();
