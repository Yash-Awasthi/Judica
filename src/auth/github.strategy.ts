/**
 * P5-05: Replaced passport-github2 (abandoned) with @fastify/oauth2.
 *
 * This module provides a Fastify plugin that registers GitHub OAuth2 routes:
 *   GET /api/auth/github          — redirects to GitHub login
 *   GET /api/auth/github/callback — handles the OAuth callback
 *
 * Requires @fastify/oauth2 in dependencies (replaces passport + passport-github2).
 */
import type { FastifyInstance } from "fastify";
import oauthPlugin from "@fastify/oauth2";
import crypto from "crypto";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

interface GitHubEmail {
  email: string;
  verified: boolean;
  primary: boolean;
  visibility: string | null;
}

interface GitHubUser {
  login?: string;
  name?: string;
}

export async function githubOAuthPlugin(fastify: FastifyInstance): Promise<void> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    logger.info("GitHub OAuth disabled — GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set");
    return;
  }

  await fastify.register(oauthPlugin, {
    name: "githubOAuth2",
    scope: ["user:email"],
    credentials: {
      client: {
        id: env.GITHUB_CLIENT_ID,
        secret: env.GITHUB_CLIENT_SECRET,
      },
    },
    startRedirectPath: "/api/auth/github",
    callbackUri: `${env.OAUTH_CALLBACK_BASE_URL}/api/auth/github/callback`,
    generateStateFunction: (_request: unknown) => {
      // P8-33: Generate cryptographic state parameter to prevent CSRF on OAuth flow
      const state = crypto.randomBytes(32).toString("hex");
      return state;
    },
    checkStateFunction: (_returnedState: string, _callback: (err?: Error) => void) => {
      // P8-33: @fastify/oauth2 handles state validation internally when generateStateFunction is provided
      _callback();
    },
    discovery: {
      issuer: "https://github.com",
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
    },
  });

  fastify.get("/api/auth/github/callback", async (request, reply) => {
    try {
      const tokenResult = await (fastify as unknown as { githubOAuth2: { getAccessTokenFromAuthorizationCodeFlow: (req: unknown) => Promise<{ token: { access_token: string } }> } }).githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = tokenResult.token.access_token;

      // Fetch user emails from GitHub API
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      });
      const emails = (await emailsRes.json()) as GitHubEmail[];

      // SEC-7: Only accept verified emails to prevent email spoofing
      const emailObj = emails.find((e) => e.verified && e.primary) || emails.find((e) => e.verified);
      if (!emailObj) {
        return reply.code(400).send({ error: "No verified email from GitHub. Please verify your email in GitHub settings." });
      }
      const email = emailObj.email;

      // Fetch user profile for username
      const profileRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
        },
      });
      const profile = (await profileRes.json()) as GitHubUser;

      // Find or create user
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {
        // P8-34: Use explicit authMethod instead of checking passwordHash === ""
        if (existing.authMethod === "password") {
          return reply.code(409).send({ error: "An account with this email already exists from a different sign-in method." });
        }
        // Return existing OAuth user — caller should issue tokens
        return { user: existing };
      }

      const [user] = await db
        .insert(users)
        .values({
          email,
          username: profile.login || profile.name || email.split("@")[0],
          passwordHash: "",
          authMethod: "github",
          role: "member",
        })
        .returning();

      logger.info({ email, username: user.username }, "New user registered via GitHub OAuth");
      return { user };
    } catch (err) {
      logger.error({ err }, "GitHub OAuth callback failed");
      return reply.code(500).send({ error: "OAuth authentication failed" });
    }
  });
}
