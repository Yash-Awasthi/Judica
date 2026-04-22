import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";

export function createGoogleStrategy() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;

  return new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${env.OAUTH_CALLBACK_BASE_URL}/api/auth/google/callback`,
    },
    async (_accessToken: string, _refreshToken: string, profile: { emails?: Array<{ value?: string; verified?: boolean }>; displayName?: string }, done: (error: Error | null, user?: Record<string, unknown>) => void) => {
      try {
        // SEC-7: Verify email presence and verification status to prevent
        // account takeover via unverified email claims.
        const emailObj = profile.emails?.[0];
        if (!emailObj?.value) return done(new Error("No email from Google"));
        // P8-32: Use strict !== true check — `verified === false` passes for undefined/null
        if (emailObj.verified !== true) return done(new Error("Google email not verified"));
        const email = emailObj.value;

        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existing) {
          // P8-34: Use explicit authMethod instead of checking passwordHash
          if (existing.authMethod === "password") {
            return done(new Error("An account with this email already exists from a different sign-in method. Please use your original sign-in method."));
          }
          return done(null, existing as Record<string, unknown>);
        }

        const sanitizedUsername = (profile.displayName || email.split("@")[0]).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 30);

        const [user] = await db
          .insert(users)
          .values({
            email: email ?? undefined,
            username: sanitizedUsername,
            passwordHash: "", // OAuth user, no password
            authMethod: "google",
            role: "member",
          })
          .onConflictDoNothing()
          .returning();

        if (!user) {
          // Race condition: user was created by another request, fetch it
          const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
          if (existing) return done(null, existing as Record<string, unknown>);
          return done(new Error("Failed to create user account"));
        }

        done(null, user as Record<string, unknown>);
      } catch (err) {
        done(err as Error);
      }
    }
  );
}
