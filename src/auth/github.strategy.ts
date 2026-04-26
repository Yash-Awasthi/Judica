/**
 * Replaced passport-github2 (abandoned) with @fastify/oauth2.
 *
 * This module provides a Fastify plugin that registers GitHub OAuth2 routes:
 *   GET /api/auth/github          — redirects to GitHub login
 *   GET /api/auth/github/callback — handles the OAuth callback
 *
 * Requires @fastify/oauth2 in dependencies (replaces passport + passport-github2).
 * Also exports createGitHubStrategy for passport-based flows.
 */
import type { FastifyInstance } from "fastify";
import oauthPlugin from "@fastify/oauth2";
import crypto from "crypto";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";
import { issueTokenPair } from "../lib/tokenIssuer.js";

// Map of generated OAuth state tokens to their creation timestamps (ms).
// Used to validate the state parameter on callback and prevent CSRF attacks.
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingStates = new Map<string, number>();

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

// CSRF state store for OAuth2 flow (short-lived, in-memory)
const pendingOAuthStates = new Set<string>();

export async function githubOAuthPlugin(fastify: FastifyInstance): Promise<void> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    logger.info("GitHub OAuth disabled — GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set");
    return;
  }

  await fastify.register(oauthPlugin as any, {
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
      const state = crypto.randomBytes(32).toString("hex");
      pendingOAuthStates.add(state);
      setTimeout(() => pendingOAuthStates.delete(state), STATE_TTL_MS);
      return state;
    },
    checkStateFunction: (returnedState: string, _callback: (err?: Error) => void) => {
      // R3-08: Validate returned state has the expected format (64 hex chars = 32 random bytes).
      // @fastify/oauth2 embeds the state in a signed cookie and compares it internally;
      // this check rejects obviously malformed/tampered values before that comparison.
      if (!returnedState || !/^[0-9a-f]{64}$/.test(returnedState)) {
        return _callback(new Error("Invalid OAuth state parameter"));
      }
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
        signal: AbortSignal.timeout(10000),
      });
      if (!emailsRes.ok) {
        logger.error({ status: emailsRes.status }, "GitHub emails API request failed");
        return reply.code(502).send({ error: "Failed to retrieve email from GitHub" });
      }
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
        signal: AbortSignal.timeout(10000),
      });
      if (!profileRes.ok) {
        logger.error({ status: profileRes.status }, "GitHub profile API request failed");
        return reply.code(502).send({ error: "Failed to retrieve profile from GitHub" });
      }
      const profile = (await profileRes.json()) as GitHubUser;

      // Find or create user
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existing) {
        // Use explicit authMethod instead of checking passwordHash === ""
        if (existing.authMethod === "password") {
          const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";
          return reply.redirect(`${frontendUrl}/login?error=email_conflict`);
        }
        await issueTokenPair(existing.id, existing.username, existing.role, reply, request);
        const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";
        return reply.redirect(frontendUrl);
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
      await issueTokenPair(user.id, user.username, user.role, reply, request);
      const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";
      return reply.redirect(frontendUrl);
    } catch (err) {
      logger.error({ err }, "GitHub OAuth callback failed");
      const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";
      return reply.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }
  });
}
