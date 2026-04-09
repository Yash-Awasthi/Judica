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
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(new Error("No email from Google"));

        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existing) {
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
