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
    async (_accessToken: string, _refreshToken: string, profile: { emails?: Array<{ value?: string; verified?: boolean }>; displayName?: string }, done: (error: Error | null, user?: any) => void) => {
      try {
        // SEC-7: Verify email presence and verification status to prevent
        // account takeover via unverified email claims.
        const emailObj = profile.emails?.[0];
        if (!emailObj?.value) return done(new Error("No email from Google"));
        if ((emailObj as any).verified === false) return done(new Error("Google email not verified"));
        const email = emailObj.value;

        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existing) {
          if (existing.passwordHash) {
            return done(new Error("An account with this email already exists from a different sign-in method. Please use your original sign-in method."));
          }
          return done(null, existing as any);
        }

        const [user] = await db
          .insert(users)
          .values({
            email: email ?? undefined,
            username: profile.displayName || email.split("@")[0],
            passwordHash: "", // OAuth user, no password
            role: "member",
          })
          .returning();

        done(null, user as any);
      } catch (err) {
        done(err as Error);
      }
    }
  );
}
