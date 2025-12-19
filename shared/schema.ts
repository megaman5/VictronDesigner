import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  response: jsonb("response"), // { components, wires, description, recommendations }
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  createdAtIdx: index("ai_logs_created_at_idx").on(table.createdAt),
  visitorIdIdx: index("ai_logs_visitor_id_idx").on(table.visitorId),
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
  polarity: "positive" | "negative" | "neutral" | "ground";
  length: number; // in feet
  gauge?: string;
  current?: number;
  voltageDrop?: number;
  color?: string;
  conductorMaterial?: "copper" | "aluminum";
}

export interface WireCalculation {
  current: number;
  length: number;
  voltage: number;
  temperatureC: number;
  conductorMaterial: "copper" | "aluminum";
  insulationType: "60C" | "75C" | "90C";
  bundlingFactor: number;
  maxVoltageDrop: number;
  recommendedGauge: string;
  actualVoltageDrop: number;
  voltageDropPercent: number;
  status: "valid" | "warning" | "error";
  message?: string;
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
