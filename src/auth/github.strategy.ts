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
        const email = profile.emails?.[0]?.value || `${profile.username}@github.local`;

        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (existing) {
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
