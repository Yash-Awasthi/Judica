/**
 * Shared test helper for `fastify.inject()` integration tests.
 *
 * Builds a lightweight Fastify instance with essential middleware
 * but mocked external services (DB, Redis, queues).
 *
 * Usage:
 *   import { buildTestApp, createAuthHeaders } from "../helpers/testApp.js";
 *
 *   let app: Awaited<ReturnType<typeof buildTestApp>>;
 *   beforeAll(async () => { app = await buildTestApp(); });
 *   afterAll(async () => { await app.close(); });
 *
 *   it("returns 200", async () => {
 *     const res = await app.inject({ method: "GET", url: "/api/health" });
 *     expect(res.statusCode).toBe(200);
 *   });
 */

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import jwt from "jsonwebtoken";
import { vi } from "vitest";

const TEST_JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-min-16-chars";
const TEST_USER = { userId: 1, username: "testuser", role: "member" };
const TEST_ADMIN = { userId: 2, username: "adminuser", role: "admin" };

/**
 * Build a minimal Fastify app for inject()-based integration tests.
 * Registers only the route plugin(s) you pass in.
 */
export async function buildTestApp(
  plugins: Array<{ plugin: any; prefix: string }> = [],
) {
  // Override JWT_SECRET for test JWT generation
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  const fastify = Fastify({
    logger: false,
    trustProxy: true,
  });

  await fastify.register(fastifyCookie);

  // Register each plugin
  for (const { plugin, prefix } of plugins) {
    await fastify.register(plugin, { prefix });
  }

  await fastify.ready();
  return fastify;
}

/**
 * Generate a valid JWT for inject() requests.
 */
export function signTestToken(
  payload: { userId: number; username: string; role: string } = TEST_USER,
  options: jwt.SignOptions = { expiresIn: "15m" },
): string {
  // Auth middleware verifies issuer and audience, so include them
  const defaultOptions: jwt.SignOptions = {
    expiresIn: "15m",
    algorithm: "HS256",
    issuer: "aibyai",
    audience: process.env.NODE_ENV || "test",
  };
  const mergedOptions = { ...defaultOptions, ...options };
  return jwt.sign(payload, TEST_JWT_SECRET, mergedOptions);
}

/**
 * Return headers with a valid Bearer token for authenticated requests.
 */
export function createAuthHeaders(
  user: { userId: number; username: string; role: string } = TEST_USER,
): Record<string, string> {
  return {
    authorization: `Bearer ${signTestToken(user)}`,
    "content-type": "application/json",
  };
}

/**
 * Return headers with admin credentials.
 */
export function createAdminHeaders(): Record<string, string> {
  return createAuthHeaders(TEST_ADMIN);
}

export { TEST_JWT_SECRET, TEST_USER, TEST_ADMIN };
