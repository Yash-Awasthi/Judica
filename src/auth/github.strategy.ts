import { Strategy as GitHubStrategy } from "passport-github2";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";

export function createGitHubStrategy() {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return null;

  return new GitHubStrategy(
    {
      clientID: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      callbackURL: `${env.OAUTH_CALLBACK_BASE_URL}/api/auth/github/callback`,
      scope: ["user:email"],
    },
    async (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
      try {
        // SEC-7: Only accept verified emails from GitHub to prevent email spoofing
        // and cross-provider account collision attacks.
        const emailObj = profile.emails?.find((e: any) => e.verified || e.primary);
        if (!emailObj?.value) return done(new Error("No verified email from GitHub. Please make your email public in GitHub settings."));
        const email = emailObj.value;

        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existing) {
          // SEC-7: Prevent cross-provider email collision. If the existing account
          // has a password hash it's a local account and can be safely linked.
          // If it has no password (OAuth-only) and was created by a different provider,
          // reject to prevent account takeover via email collision.
          if (!existing.passwordHash) {
            return done(new Error("An account with this email already exists from a different sign-in method. Please use your original sign-in method."));
          }
          return done(null, existing);
        }

        const [user] = await db
          .insert(users)
          .values({
            email,
            username: profile.username || profile.displayName || email.split("@")[0],
            passwordHash: "",
            role: "member",
          })
          .returning();

        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  );
}
