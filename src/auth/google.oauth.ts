/**
 * Google Sign-in via @fastify/oauth2.
 *
 * Registers two routes at the app root (no prefix so paths are absolute):
 *   GET /api/auth/google          — redirect to Google consent page
 *   GET /api/auth/google/callback — exchange code, find/create user, issue tokens
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   OAUTH_CALLBACK_BASE_URL  (e.g. https://yourapp.com)
 *   FRONTEND_URL             (redirect destination after login)
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

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const pendingOAuthStates = new Set<string>();

interface GoogleTokenInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export async function googleOAuthPlugin(fastify: FastifyInstance): Promise<void> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    logger.info("Google OAuth disabled — GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set");
    return;
  }

  await fastify.register(oauthPlugin as any, {
    name: "googleOAuth2",
    scope: ["openid", "email", "profile"],
    credentials: {
      client: {
        id: env.GOOGLE_CLIENT_ID,
        secret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    startRedirectPath: "/api/auth/google",
    callbackUri: `${env.OAUTH_CALLBACK_BASE_URL}/api/auth/google/callback`,
    generateStateFunction: (_request: unknown) => {
      const state = crypto.randomBytes(32).toString("hex");
      pendingOAuthStates.add(state);
      setTimeout(() => pendingOAuthStates.delete(state), STATE_TTL_MS);
      return state;
    },
    checkStateFunction: (returnedState: string, callback: (err?: Error) => void) => {
      // Reject obviously malformed/tampered values (64 hex chars = 32 random bytes)
      if (!returnedState || !/^[0-9a-f]{64}$/.test(returnedState)) {
        return callback(new Error("Invalid OAuth state parameter"));
      }
      callback();
    },
    discovery: {
      issuer: "https://accounts.google.com",
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
    },
  });

  fastify.get("/api/auth/google/callback", async (request, reply) => {
    try {
      const tokenResult = await (fastify as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = tokenResult.token.access_token;

      // Fetch user info from Google's tokeninfo endpoint
      const userInfoRes = await fetch(
        `https://www.googleapis.com/oauth2/v3/userinfo`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!userInfoRes.ok) {
        logger.error({ status: userInfoRes.status }, "Google userinfo API request failed");
        return reply.code(502).send({ error: "Failed to retrieve user info from Google" });
      }
      const profile = (await userInfoRes.json()) as GoogleTokenInfo;

      // SEC-7: Only accept verified email addresses
      if (!profile.email) {
        return reply.code(400).send({ error: "No email returned from Google" });
      }
      if (profile.email_verified !== true) {
        return reply.code(400).send({ error: "Google email is not verified. Please verify your email in Google settings." });
      }

      const email = profile.email;

      const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (existing) {
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
          username: profile.name || email.split("@")[0],
          passwordHash: "",
          authMethod: "google",
          role: "member",
        })
        .returning();

      logger.info({ email, username: user.username }, "New user registered via Google OAuth");
      await issueTokenPair(user.id, user.username, user.role, reply, request);
      const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";
      return reply.redirect(frontendUrl);
    } catch (err) {
      logger.error({ err }, "Google OAuth callback failed");
      const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";
      return reply.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }
  });
}
