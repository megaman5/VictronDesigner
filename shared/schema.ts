import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const schematics = pgTable("schematics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  systemVoltage: integer("system_voltage").notNull().default(12),
  components: jsonb("components").notNull().default([]),
  wires: jsonb("wires").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Schematic = typeof schematics.$inferSelect;
export type InsertSchematic = z.infer<typeof insertSchematicSchema>;
export type UpdateSchematic = z.infer<typeof updateSchematicSchema>;

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
  status: "valid" | "warning" | "invalid";
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
