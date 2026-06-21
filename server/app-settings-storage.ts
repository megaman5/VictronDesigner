import { db } from "./db";
import { appSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

export const DEFAULT_AI_MODEL = "gpt-5.4";

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
}

export const appSettingsStorage = new AppSettingsStorage();
