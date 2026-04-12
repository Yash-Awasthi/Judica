import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import prisma from "../lib/db.js";
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

        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          user = await prisma.user.create({
            data: {
              email: email ?? undefined,
              username: profile.displayName || email.split("@")[0],
              passwordHash: "", // OAuth user, no password
              role: "member",
            },
          });
        }

        done(null, user as any);
      } catch (err) {
        done(err as Error);
      }
    }
  );
}
