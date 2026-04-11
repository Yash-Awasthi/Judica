import { Strategy as GitHubStrategy } from "passport-github2";
import prisma from "../lib/db.js";
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

        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          user = await prisma.user.create({
            data: {
              email,
              username: profile.username || profile.displayName || email.split("@")[0],
              passwordHash: "",
              role: "member",
            },
          });
        }

        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  );
}
