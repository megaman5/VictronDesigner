import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Request, Response, NextFunction } from "express";
import { userStorage } from "./user-storage";

// Admin email whitelist
const ADMIN_EMAILS = ["megaman5@gmail.com"];

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  googleId: string;
  isAdmin: boolean;
}

// Users are persisted in Postgres. A previous in-memory Map meant every
// restart logged everyone out, because deserializeUser found nothing.

// Configure Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || "";
          const googleId = profile.id;

          const stored = await userStorage.upsertFromGoogle({
            googleId,
            email,
            displayName: profile.displayName || email,
          });

          return done(null, {
            ...stored,
            // Derived at load time, never persisted, so editing the whitelist
            // takes effect without a data migration.
            isAdmin: ADMIN_EMAILS.includes(email.toLowerCase()),
          });
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );
}

// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session. Reads the database, so sessions survive a
// restart - which is what per-user quotas and stored API keys depend on.
passport.deserializeUser(async (id: string, done) => {
  try {
    const stored = await userStorage.findByGoogleId(id);
    if (!stored) return done(null, false);
    done(null, {
      ...stored,
      isAdmin: ADMIN_EMAILS.includes(stored.email.toLowerCase()),
    });
  } catch (error) {
    done(error as Error);
  }
});

// Middleware to check if user is authenticated
export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
}

// Middleware to check if user is admin
export function isAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    const user = req.user as AuthUser;
    if (user.isAdmin) {
      return next();
    }
    res.status(403).json({ error: "Access denied. Admin privileges required." });
  } else {
    res.status(401).json({ error: "Not authenticated" });
  }
}

export { passport };
