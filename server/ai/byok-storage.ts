import { db } from "../db";
import { userApiKeys } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { encryptApiKey, decryptApiKey, isVaultConfigured } from "./key-vault";
import type { ProviderCredentials, ProviderId } from "./providers";

/**
 * Storage for user-supplied provider keys.
 *
 * The plaintext key exists only in memory, for the duration of a request. It
 * is encrypted before it reaches the database and is never returned to a
 * client - listKeys deliberately returns the last four characters only.
 */

export interface StoredKeySummary {
  provider: string;
  lastFour: string;
  baseUrl: string | null;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export const byokStorage = {
  isAvailable(): boolean {
    return isVaultConfigured();
  },

  async saveKey(input: {
    userId: string;
    provider: ProviderId;
    apiKey: string;
    baseUrl?: string;
    label?: string;
  }): Promise<StoredKeySummary> {
    const { ciphertext, lastFour } = encryptApiKey(input.apiKey, {
      userId: input.userId,
      provider: input.provider,
    });

    const values = {
      userId: input.userId,
      provider: input.provider,
      encryptedKey: ciphertext,
      keyLastFour: lastFour,
      baseUrl: input.baseUrl ?? null,
      label: input.label ?? null,
    };

    await db
      .insert(userApiKeys)
      .values(values)
      .onConflictDoUpdate({
        target: [userApiKeys.userId, userApiKeys.provider],
        set: {
          encryptedKey: values.encryptedKey,
          keyLastFour: values.keyLastFour,
          baseUrl: values.baseUrl,
          label: values.label,
        },
      });

    return {
      provider: input.provider,
      lastFour,
      baseUrl: values.baseUrl,
      label: values.label,
      createdAt: new Date(),
      lastUsedAt: null,
    };
  },

  /** Summaries only - never the key itself. */
  async listKeys(userId: string): Promise<StoredKeySummary[]> {
    const rows = await db.select().from(userApiKeys).where(eq(userApiKeys.userId, userId));
    return rows.map(r => ({
      provider: r.provider,
      lastFour: r.keyLastFour,
      baseUrl: r.baseUrl,
      label: r.label,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
    }));
  },

  /**
   * Decrypt a user's key for immediate use. Returns null when they have not
   * supplied one, so callers fall back to the platform key.
   */
  async getCredentials(
    userId: string,
    provider: ProviderId
  ): Promise<ProviderCredentials | null> {
    const rows = await db
      .select()
      .from(userApiKeys)
      .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider)))
      .limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    const apiKey = decryptApiKey(row.encryptedKey, { userId, provider });

    // Best-effort usage stamp; never fail the request over it
    void db
      .update(userApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider)))
      .catch(() => {});

    return { apiKey, ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}) };
  },

  async deleteKey(userId: string, provider: ProviderId): Promise<boolean> {
    const deleted = await db
      .delete(userApiKeys)
      .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider)))
      .returning({ id: userApiKeys.id });
    return deleted.length > 0;
  },
};
