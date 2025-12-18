import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Request, Response, NextFunction } from "express";

// Admin email whitelist
const ADMIN_EMAILS = ["megaman5@gmail.com"];

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  googleId: string;
  isAdmin: boolean;
}

// In-memory user store (for simplicity)
const users = new Map<string, AuthUser>();

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

          // Check if user exists
          let user = Array.from(users.values()).find(u => u.googleId === googleId);

          if (!user) {
            // Create new user
            user = {
              id: googleId,
              email,
              displayName: profile.displayName || email,
              googleId,
              isAdmin: ADMIN_EMAILS.includes(email.toLowerCase()),
            };
            users.set(googleId, user);
          } else {
            // Update admin status in case whitelist changed
            user.isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());
          }

          return done(null, user);
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

// Deserialize user from session
passport.deserializeUser((id: string, done) => {
  const user = users.get(id);
  if (user) {
    done(null, user);
  } else {
    done(null, false);
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
