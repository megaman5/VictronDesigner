import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, jsonb, timestamp, index, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").unique(),
  password: text("password"),
  googleId: text("google_id").unique(),
  email: text("email").unique(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const schematics = pgTable("schematics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  systemVoltage: integer("system_voltage").notNull().default(12),
  components: jsonb("components").notNull().default([]),
  wires: jsonb("wires").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// User designs (saved schematics for logged-in users)
export const userDesigns = pgTable("user_designs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  systemVoltage: integer("system_voltage").notNull().default(12),
  components: jsonb("components").notNull().default([]),
  wires: jsonb("wires").notNull().default([]),
  thumbnail: text("thumbnail"), // base64 screenshot
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("user_designs_user_id_idx").on(table.userId),
}));

// Feedback submissions
export const feedback = pgTable("feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  message: text("message").notNull(),
  email: text("email"),
  userAgent: text("user_agent").notNull(),
  state: jsonb("state").notNull(), // { components, wires, systemVoltage }
  screenshot: text("screenshot"), // base64 encoded image
  status: text("status").notNull().default("new"), // "new" | "completed"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * User-defined component types ("Phase 1" of custom components — personal,
 * private definitions only; see docs/custom-components-design.md).
 *
 * Placed instances snapshot their terminal list and dimensions into the
 * SchematicComponent's `properties` at drop time, so a saved schematic keeps
 * rendering correctly even if this definition is later edited or deleted.
 * `ownerId` holds AuthUser.id (the Google account id used across the app,
 * see server/auth.ts) rather than the users.id primary key, matching the
 * userDesigns table's convention — the two are different value spaces.
 */
export const customComponents = pgTable("custom_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ownerId: varchar("owner_id").notNull(),
  name: text("name").notNull(),
  subtitle: text("subtitle"),
  category: text("category").notNull().default("custom"),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  terminals: jsonb("terminals").notNull(), // Terminal[] (see client/src/lib/terminal-config.ts)
  appearance: jsonb("appearance"), // body colour, label placement, optional bars
  // DC voltages (12/24/48) this part is compatible with, e.g. a dual-voltage
  // charger declares [12, 24]. null/empty = no declared DC voltage (AC,
  // passive, or pass-through part) - excluded from the voltage-mismatch check.
  supportedVoltages: jsonb("supported_voltages"), // number[] | null
  // "private" is the only visibility phase 1 builds UI for; the column exists
  // so phase 2 (community sharing) doesn't need a migration.
  visibility: text("visibility").notNull().default("private"), // private | unlisted | public
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  ownerIdIdx: index("custom_components_owner_id_idx").on(table.ownerId),
}));

export const appSettings = pgTable("app_settings", {
  key: varchar("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Sessions for observability
export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  visitorId: varchar("visitor_id").notNull(),
  userId: varchar("user_id"),
  userEmail: text("user_email"),
  userAgent: text("user_agent").notNull(),
  ip: varchar("ip").notNull(),
  pageViews: integer("page_views").notNull().default(0),
  actions: integer("actions").notNull().default(0),
  startTime: timestamp("start_time").notNull().defaultNow(),
  lastActivity: timestamp("last_activity").notNull().defaultNow(),
}, (table) => ({
  visitorIdIdx: index("sessions_visitor_id_idx").on(table.visitorId),
  startTimeIdx: index("sessions_start_time_idx").on(table.startTime),
}));

// AI request logs
export const aiLogs = pgTable("ai_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id"),
  visitorId: varchar("visitor_id"),
  userId: varchar("user_id"),
  userEmail: text("user_email"),
  ip: varchar("ip"),
  action: varchar("action").notNull(), // generate-system, wire-components, iterate-design
  prompt: text("prompt").notNull(),
  systemVoltage: integer("system_voltage").notNull().default(12),
  success: boolean("success").notNull(),
  durationMs: integer("duration_ms").notNull(),
  iterations: integer("iterations"),
  qualityScore: integer("quality_score"),
  componentCount: integer("component_count"),
  wireCount: integer("wire_count"),
  errorMessage: text("error_message"),
  model: varchar("model"),
  provider: varchar("provider"),
  skillId: varchar("skill_id"),
  skillVersion: varchar("skill_version"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  // Estimated from list prices; null when the model is not in the price table
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
  // False when the caller supplied their own API key, so it is not our spend
  billedToPlatform: boolean("billed_to_platform").notNull().default(true),
  response: jsonb("response"), // { components, wires, description, recommendations }
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("ai_logs_created_at_idx").on(table.createdAt),
  visitorIdIdx: index("ai_logs_visitor_id_idx").on(table.visitorId),
  userSpendIdx: index("ai_logs_user_spend_idx").on(table.userId, table.createdAt),
}));

/**
 * Benchmark runs: one row per (suite x skill version x provider x model)
 * execution, so prompt and model changes can be compared over time.
 */
export const benchmarkRuns = pgTable("benchmark_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  suiteId: varchar("suite_id").notNull(),
  skillId: varchar("skill_id").notNull(),
  skillVersion: varchar("skill_version").notNull(),
  provider: varchar("provider").notNull(),
  model: varchar("model").notNull(),
  // repeats per case, so run-to-run variance is measurable
  repeats: integer("repeats").notNull().default(1),
  temperature: numeric("temperature", { precision: 4, scale: 2 }),
  seed: integer("seed"),
  // False when the provider rejected the sampling parameters we asked for
  samplingApplied: boolean("sampling_applied"),
  status: varchar("status").notNull().default("running"), // running | completed | failed
  label: text("label"),
  triggeredBy: varchar("triggered_by"),
  caseCount: integer("case_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  meanScore: numeric("mean_score", { precision: 6, scale: 2 }),
  medianScore: numeric("median_score", { precision: 6, scale: 2 }),
  minScore: integer("min_score"),
  maxScore: integer("max_score"),
  passRate: numeric("pass_rate", { precision: 5, scale: 2 }),
  totalCostUsd: numeric("total_cost_usd", { precision: 12, scale: 6 }),
  totalInputTokens: integer("total_input_tokens"),
  totalOutputTokens: integer("total_output_tokens"),
  meanDurationMs: integer("mean_duration_ms"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
}, (table) => ({
  startedAtIdx: index("benchmark_runs_started_at_idx").on(table.startedAt),
  suiteIdx: index("benchmark_runs_suite_idx").on(table.suiteId, table.model),
}));

/** One row per case execution (repeat included) inside a run. */
export const benchmarkResults = pgTable("benchmark_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull(),
  caseId: varchar("case_id").notNull(),
  repeat: integer("repeat").notNull().default(1),
  success: boolean("success").notNull(),
  score: integer("score"),
  errorCount: integer("error_count"),
  warningCount: integer("warning_count"),
  componentCount: integer("component_count"),
  wireCount: integer("wire_count"),
  // Repairs the deterministic normalizer had to make - a direct measure of
  // how well the prompt is landing, independent of the design score
  repairCount: integer("repair_count"),
  // Model calls this case needed, and the score after each - so convergence
  // (or divergence, which is what a bad prompt looks like) is visible
  iterationsUsed: integer("iterations_used"),
  scorePath: jsonb("score_path"),
  expectationsMet: boolean("expectations_met"),
  failedExpectations: jsonb("failed_expectations"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  issues: jsonb("issues"),
  output: jsonb("output"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  runIdx: index("benchmark_results_run_idx").on(table.runId),
}));

/**
 * Per-user provider API keys (BYOK). The key itself is stored encrypted;
 * only the last four characters are ever returned to a client.
 */
export const userApiKeys = pgTable("user_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  provider: varchar("provider").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  keyLastFour: varchar("key_last_four", { length: 4 }).notNull(),
  baseUrl: text("base_url"),
  label: text("label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
}, (table) => ({
  userProviderIdx: uniqueIndex("user_api_keys_user_provider_idx").on(table.userId, table.provider),
}));

// Tracking events
export const events = pgTable("events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id"),
  visitorId: varchar("visitor_id"),
  userId: varchar("user_id"),
  type: varchar("type").notNull(), // page_view, action, export, save, load, feedback
  name: varchar("name").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("events_created_at_idx").on(table.createdAt),
  typeIdx: index("events_type_idx").on(table.type),
}));

// Error logs
export const errorLogs = pgTable("error_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id"),
  visitorId: varchar("visitor_id"),
  userId: varchar("user_id"),
  type: varchar("type").notNull(), // api_error, ai_error, validation_error, client_error
  endpoint: varchar("endpoint"),
  message: text("message").notNull(),
  stack: text("stack"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("error_logs_created_at_idx").on(table.createdAt),
  typeIdx: index("error_logs_type_idx").on(table.type),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertSchematicSchema = createInsertSchema(schematics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateSchematicSchema = createInsertSchema(schematics).omit({
  createdAt: true,
  updatedAt: true,
}).partial();

// User designs schemas
export const insertUserDesignSchema = createInsertSchema(userDesigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Feedback schema
export const insertFeedbackSchema = createInsertSchema(feedback).omit({
  id: true,
  createdAt: true,
});

// Session schema
export const insertSessionSchema = createInsertSchema(sessions).omit({
  id: true,
  startTime: true,
  lastActivity: true,
});

// AI logs schema
export const insertAILogSchema = createInsertSchema(aiLogs).omit({
  id: true,
  createdAt: true,
});

// Events schema
export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  createdAt: true,
});

// Error logs schema
export const insertErrorLogSchema = createInsertSchema(errorLogs).omit({
  id: true,
  createdAt: true,
});

// Custom component definitions
export const insertCustomComponentSchema = createInsertSchema(customComponents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateCustomComponentSchema = createInsertSchema(customComponents).omit({
  id: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Schematic = typeof schematics.$inferSelect;
export type InsertSchematic = z.infer<typeof insertSchematicSchema>;
export type UpdateSchematic = z.infer<typeof updateSchematicSchema>;
export type UserDesign = typeof userDesigns.$inferSelect;
export type InsertUserDesign = z.infer<typeof insertUserDesignSchema>;
export type Feedback = typeof feedback.$inferSelect;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type AILog = typeof aiLogs.$inferSelect;
export type InsertAILog = z.infer<typeof insertAILogSchema>;
export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type ErrorLog = typeof errorLogs.$inferSelect;
export type InsertErrorLog = z.infer<typeof insertErrorLogSchema>;
export type CustomComponentDefinition = typeof customComponents.$inferSelect;
export type InsertCustomComponentDefinition = z.infer<typeof insertCustomComponentSchema>;
export type UpdateCustomComponentDefinition = z.infer<typeof updateCustomComponentSchema>;

// Component and wire types for the schematic
export interface SchematicComponent {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  properties: {
    voltage?: number;
    current?: number;
    power?: number;
    capacity?: number;
    efficiency?: number;
    [key: string]: any;
  };
}

export interface Wire {
  id: string;
  fromComponentId: string;
  toComponentId: string;
  fromTerminal: string;
  toTerminal: string;
  polarity: "positive" | "negative" | "hot" | "neutral" | "ground";
  length: number; // in feet
  gauge?: string;
  current?: number;
  voltageDrop?: number;
  color?: string;
  conductorMaterial?: "copper" | "aluminum";
  // Manual routing bends, stored RELATIVE to the from-component's origin so they
  // move with the diagram. The wire is routed through these points in order.
  waypoints?: Array<{ x: number; y: number }>;
}

export interface WireCalculation {
  current: number;
  length: number;
  voltage: number;
  temperatureC: number;
  conductorMaterial: "copper" | "aluminum";
  insulationType: "60C" | "75C" | "90C" | "105C";
  bundlingFactor: number;
  maxVoltageDrop: number;
  recommendedGauge: string;
  actualVoltageDrop: number;
  voltageDropPercent: number;
  status: "valid" | "warning" | "error";
  message?: string;
  totalCurrent?: number;
  parallelCount?: number;
}

export interface LoadCalculation {
  dcLoads: number;
  acLoads: number;
  totalPower: number;
  peakPower: number;
  averagePower: number;
  batteryCapacityRequired: number;
  inverterSizeRequired: number;
  chargingPowerRequired: number;
}

export interface AISystemRequest {
  prompt: string;
  systemVoltage?: number;
}

export interface AISystemResponse {
  components: SchematicComponent[];
  wires: Wire[];
  description: string;
  recommendations: string[];
}

// Design validation types
export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  componentIds?: string[];
  wireId?: string;
  wireIds?: string[];
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  score: number;
  issues: ValidationIssue[];
  metrics?: {
    totalComponents: number;
    componentCount?: number;
    totalWires: number;
    wireCount?: number;
    totalCurrent: number;
    estimatedCost: number;
    avgComponentSpacing?: number;
    layoutEfficiency?: number;
  };
}
