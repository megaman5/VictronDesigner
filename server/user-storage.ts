import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Durable user records.
 *
 * Users previously lived in a module-level Map, so passport's deserializeUser
 * found nothing after a restart and every deploy silently logged everyone out.
 * That also left per-user features (BYOK keys, spend limits) with no stable
 * identity to attach to.
 *
 * The public id stays the Google account id rather than the table's uuid:
 * ai_logs.user_id already holds Google ids, so switching would orphan every
 * historical row and break spend history on the first deploy.
 */

export interface StoredUser {
  id: string; // Google account id - the identity used across the app
  email: string;
  displayName: string;
  googleId: string;
}

export const userStorage = {
  /** Insert or refresh a user seen through OAuth. */
  async upsertFromGoogle(profile: {
    googleId: string;
    email: string;
    displayName: string;
  }): Promise<StoredUser> {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.googleId, profile.googleId))
      .limit(1);

    if (existing.length > 0) {
      // Keep email/display name current without touching createdAt
      await db
        .update(users)
        .set({ email: profile.email, displayName: profile.displayName })
        .where(eq(users.googleId, profile.googleId));
    } else {
      await db.insert(users).values({
        googleId: profile.googleId,
        email: profile.email,
        displayName: profile.displayName,
      });
    }

    return {
      id: profile.googleId,
      email: profile.email,
      displayName: profile.displayName,
      googleId: profile.googleId,
    };
  },

  async findByGoogleId(googleId: string): Promise<StoredUser | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.googleId, googleId))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.googleId!,
      email: row.email ?? "",
      displayName: row.displayName ?? row.email ?? "",
      googleId: row.googleId!,
    };
  },
};
