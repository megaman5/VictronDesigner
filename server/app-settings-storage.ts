import { db } from "./db";
import { appSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

export const DEFAULT_AI_MODEL = "gpt-5.4";
export const DEFAULT_WIRE_ROUTING_STYLE = "orthogonal";
export const WIRE_ROUTING_STYLE_VALUES = ["orthogonal", "rounded", "curved", "straight"];

class AppSettingsStorage {
  async get(key: string): Promise<string | null> {
    const [result] = await db.select()
      .from(appSettings)
      .where(eq(appSettings.key, key));

    return result?.value || null;
  }

  async set(key: string, value: string): Promise<void> {
    await db.insert(appSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async getAIModel(): Promise<string> {
    return await this.get("ai_model") || DEFAULT_AI_MODEL;
  }

  async setAIModel(model: string): Promise<void> {
    await this.set("ai_model", model);
  }

  // Per-user disclaimer acceptance (stores the accepted version string).
  async getUserDisclaimer(userId: string): Promise<string | null> {
    return await this.get(`disclaimer:${userId}`);
  }

  async setUserDisclaimer(userId: string, version: string): Promise<void> {
    await this.set(`disclaimer:${userId}`, version);
  }

  // Whether the (beta) wire routing style selector is shown in the designer.
  async getWireRoutingSelectorEnabled(): Promise<boolean> {
    const value = await this.get("wire_routing_selector_enabled");
    // Default ON so the feature is available out of the box.
    return value === null ? true : value === "true";
  }

  async setWireRoutingSelectorEnabled(enabled: boolean): Promise<void> {
    await this.set("wire_routing_selector_enabled", enabled ? "true" : "false");
  }

  // The default wire routing style for new sessions (per-user choice is stored
  // client-side and overrides this default).
  async getDefaultWireRoutingStyle(): Promise<string> {
    const value = await this.get("default_wire_routing_style");
    return value && WIRE_ROUTING_STYLE_VALUES.includes(value) ? value : DEFAULT_WIRE_ROUTING_STYLE;
  }

  async setDefaultWireRoutingStyle(style: string): Promise<void> {
    await this.set("default_wire_routing_style", style);
  }
}

export const appSettingsStorage = new AppSettingsStorage();
