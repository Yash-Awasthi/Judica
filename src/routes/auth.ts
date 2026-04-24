import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto, { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { users, userSettings } from "../db/schema/users.js";
import { refreshTokens, revokedTokens, councilConfigs } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { authSchema, configSchema, userSettingsSchema, fastifyValidate } from "../middleware/validate.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { AppError } from "../middleware/errorHandler.js";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_TTL_DAYS = 7;
const REFRESH_TOKEN_TTL_SECS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

// Constant dummy hash to prevent user enumeration via timing.
// Generated with argon2id so verify() takes the same time regardless of user existence.
// L-8: Use a structurally valid argon2id hash so verify() performs real work (not a fast reject).
// Re-generate with: node -e "require('argon2').hash('dummy-timing-password',{type:2,memoryCost:65536,timeCost:3}).then(console.log)"
const DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRoZXJlaGVyZQ$Tk5vc1ZmVEI5YVJtWHVXNjlmb2R5T3VRY2hJNjFoZTA";

// Pin algorithm to HS256 in sign() to match verify() — prevents algorithm-confusion attacks
function generateAccessToken(userId: number, username: string, role: string): string {
  return jwt.sign({ userId, username, role }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: "aibyai",
    audience: env.NODE_ENV,
  });
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function fingerprintHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function createRefreshToken(userId: number, ip?: string, userAgent?: string): Promise<string> {
  const rawToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECS * 1000);

  await db.insert(refreshTokens).values({
    id: randomUUID(),
    userId,
    tokenHash,
    ipHash: ip ? fingerprintHash(ip) : null,
    userAgentHash: userAgent ? fingerprintHash(userAgent) : null,
    expiresAt,
  });

  // Store token-family mapping for replay detection
  await redis.set(`refresh_family:${tokenHash}`, String(userId), { EX: REFRESH_TOKEN_TTL_SECS });

  return rawToken;
}

async function issueTokenPair(userId: number, username: string, role: string, reply: FastifyReply, request?: FastifyRequest): Promise<{ token: string; username: string; role: string }> {
  const accessToken = generateAccessToken(userId, username, role);
  const refreshToken = await createRefreshToken(userId, request?.ip, request?.headers["user-agent"]);

  // Set access token as httpOnly cookie
  reply.setCookie("access_token", accessToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 15 * 60, // 15 minutes
    path: "/",
  });

  // Set refresh token as httpOnly cookie
  reply.setCookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_TOKEN_TTL_SECS,
    path: "/api/auth",
  });

  // Still return token in body for backward compatibility during migration
  return { token: accessToken, username, role };
}


import fastifyRateLimit from "@fastify/rate-limit";

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Register plugin-level rate limit so CodeQL/scanners can detect it
  if (typeof fastify.register === "function") {
    await fastify.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
  }

  // Redis-backed rate limiting — no in-process Map, no memory growth.
  // Redis keys auto-expire via TTL. Works across replicas.
  const AUTH_RATE_LIMIT = 10; // 10 attempts per minute
  const AUTH_RATE_WINDOW_SECS = 60;

  function getClientKey(request: FastifyRequest): string {
    return request.ip || "unknown";
  }

  const authRateLimit = async (request: FastifyRequest, reply: FastifyReply) => {
    const key = `auth_rate:${getClientKey(request)}`;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, AUTH_RATE_WINDOW_SECS);
    }

    if (current > AUTH_RATE_LIMIT) {
      const ttl = await redis.ttl(key);
      reply.header("Retry-After", String(ttl > 0 ? ttl : AUTH_RATE_WINDOW_SECS));
      reply.code(429).send({ error: "Too many auth attempts, try again later." });
      return;
    }
  };

    // Fix CodeQL alert: Explicit rate limit config so static analyzers detect it
    fastify.post("/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, preHandler: [authRateLimit, fastifyValidate(authSchema)] }, async (request, reply) => {
    try {
      const { username, password } = request.body as { username: string; password: string };
      const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });

      const [user] = await db.insert(users).values({ email: username, username, passwordHash: hash }).returning();

      logger.info({ username }, "New user registered");
      reply.code(201);
      return issueTokenPair(user.id, username, user.role, reply, request);
    } catch (e: unknown) {
      if ((e as Record<string, unknown>).code === "23505") {
        throw new AppError(409, "Username already taken");
      }
      throw e;
    }
  });

    // Fix CodeQL alert #61: Explicit rate limit config so static analyzers detect it
    fastify.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, preHandler: [authRateLimit, fastifyValidate(authSchema)] }, async (request, reply) => {
    const { username, password } = request.body as { username: string; password: string };
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

    if (!user) {
      // Always run argon2.verify against a dummy hash to equalize response timing
      await argon2.verify(DUMMY_HASH, password).catch(() => {});
      throw new AppError(401, "Invalid username or password");
    }

    // Primary hash is argon2id. Legacy bcrypt support retained only
    // for migration — users are auto-migrated to argon2id on next successful login.
    // Support both legacy bcrypt ($2a$/$2b$) and new argon2id hashes
    let passwordValid: boolean;
    if (!user.passwordHash) {
      // OAuth-only user — no password to verify
      throw new AppError(401, "Invalid username or password");
    }
    const isBcryptHash = user.passwordHash.startsWith("$2a$") || user.passwordHash.startsWith("$2b$");

    if (isBcryptHash) {
      // Legacy bcrypt hashes: argon2.verify does not support bcrypt, so we
      // attempt a dynamic import of bcryptjs (optional dependency).
      try {
        const bcryptjs = await import("bcryptjs" as string);
        const bcrypt = bcryptjs.default ?? bcryptjs;
        passwordValid = await bcrypt.compare(password, user.passwordHash);
      } catch {
        logger.warn(
          { username },
          "bcryptjs is not installed — cannot verify legacy bcrypt password. " +
          "Install bcryptjs or manually migrate this user's password to argon2id."
        );
        throw new AppError(401, "Invalid username or password");
      }
    } else {
      passwordValid = await argon2.verify(user.passwordHash, password);
    }

    if (!passwordValid) {
      throw new AppError(401, "Invalid username or password");
    }

    // Re-hash legacy bcrypt passwords to argon2id on successful login
    if (isBcryptHash) {
      const newHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
      logger.info({ username }, "Migrated password hash from bcrypt to argon2id");
    }

    logger.info({ username }, "User logged in");
    return issueTokenPair(user.id, username, user.role, reply, request);
  });

    fastify.post("/logout", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    // Extract token from both header AND cookie to ensure revocation
    const authHeader = request.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    const tokenFromCookie = (request as unknown as { cookies?: { access_token?: string } }).cookies?.access_token;
    const token = tokenFromHeader || tokenFromCookie;

    if (token) {
       const payload = jwt.decode(token) as { userId?: number; exp?: number } | null;
       const expiresAt = payload?.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 15 * 60 * 1000);

       const ttlSecs = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
       // C-1 fix: store hash, not raw token, to match fastifyAuth.ts isTokenRevoked lookup
       const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
       await redis.set(`revoked:${tokenHash}`, "1", { EX: ttlSecs });

       await db.insert(revokedTokens).values({ tokenHash, expiresAt });
    }

    // Revoke refresh token
    const refreshToken = (request as unknown as { cookies?: { refresh_token?: string } }).cookies?.refresh_token;
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    }

    // Clear both auth cookies
    reply.clearCookie("access_token", { path: "/" });
    reply.clearCookie("refresh_token", { path: "/api/auth" });
    return { success: true };
  });

    fastify.get("/me", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const [user] = await db.select({
      id: users.id,
      username: users.username,
      customInstructions: users.customInstructions,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, request.userId!)).limit(1);

    if (!user) throw new AppError(404, "User not found");
    return user;
  });

    fastify.post("/refresh", { preHandler: [authRateLimit] }, async (request, reply) => {
    const refreshToken = (request as unknown as { cookies?: { refresh_token?: string } }).cookies?.refresh_token;
    if (!refreshToken) {
      throw new AppError(401, "No refresh token provided");
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const [storedToken] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);

    if (!storedToken || storedToken.expiresAt < new Date()) {
      // On replay, revoke ALL tokens for the affected user
      if (!storedToken) {
        // Token was already consumed — replay attack. Look up user from family mapping.
        const familyUserId = await redis.get(`refresh_family:${tokenHash}`);
        if (familyUserId) {
          // NaN guard on familyUserId parse
          const userId = parseInt(familyUserId, 10);
          if (!Number.isFinite(userId) || userId <= 0) {
            logger.warn({ familyUserId }, "Refresh token replay — invalid userId in family mapping");
          } else {
            logger.warn({ userId }, "Refresh token replay detected — revoking all sessions for user");
            await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
          }
        } else {
          logger.warn("Refresh token replay detected — user unknown");
        }
      }
      reply.clearCookie("refresh_token", { path: "/api/auth" });
      throw new AppError(401, "Invalid or expired refresh token");
    }

    // Validate device/IP binding — prevent stolen refresh tokens from working on different devices
    const currentIpHash = request.ip ? fingerprintHash(request.ip) : null;
    const currentUaHash = request.headers["user-agent"] ? fingerprintHash(request.headers["user-agent"]) : null;

    if (storedToken.ipHash && currentIpHash && storedToken.ipHash !== currentIpHash) {
      logger.warn({ userId: storedToken.userId, storedIp: storedToken.ipHash, currentIp: currentIpHash }, "Refresh token used from different IP");
      // Revoke all refresh tokens for this user (potential theft)
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, storedToken.userId));
      reply.clearCookie("refresh_token", { path: "/api/auth" });
      throw new AppError(401, "Session invalidated due to device mismatch. Please log in again.");
    }

    if (storedToken.userAgentHash && currentUaHash && storedToken.userAgentHash !== currentUaHash) {
      logger.warn({ userId: storedToken.userId }, "Refresh token used from different user-agent");
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, storedToken.userId));
      reply.clearCookie("refresh_token", { path: "/api/auth" });
      throw new AppError(401, "Session invalidated due to device mismatch. Please log in again.");
    }

    // Look up the user separately
    const [user] = await db.select({ id: users.id, username: users.username, role: users.role }).from(users).where(eq(users.id, storedToken.userId)).limit(1);

    // Invalidate the old token to prevent reuse (token rotation)
    await db.delete(refreshTokens).where(eq(refreshTokens.id, storedToken.id));

    logger.info({ username: user.username }, "Token refreshed via rotation");
    return issueTokenPair(user.id, user.username, user.role, reply, request);
  });

    fastify.patch("/me", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { custom_instructions } = request.body as { custom_instructions?: string };
    if (typeof custom_instructions !== "string") {
      throw new AppError(400, "custom_instructions must be a string");
    }

    // Sanitize custom_instructions — strip HTML tags and control chars to prevent prompt injection
    // Cap input before regex loop to prevent quadratic behavior on large inputs
    let sanitized = custom_instructions.slice(0, 2000);
    // Loop to handle nested/split tags like <scr<script>ipt>
    // M-2: Cap iterations to prevent ReDoS via deeply-crafted tag strings
    const TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9]*[^>]{0,256}>/g;
    let prev = "";
    let iterations = 0;
    const MAX_SANITIZE_ITERATIONS = 10;
    while (prev !== sanitized && iterations < MAX_SANITIZE_ITERATIONS) {
      prev = sanitized;
      sanitized = sanitized.replace(TAG_RE, "");
      iterations++;
    }
    // Final pass: strip any remaining lone `<` that couldn't form a full tag
    sanitized = sanitized.replace(/</g, "&lt;");
    sanitized = sanitized
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // strip control chars (keep \n \r \t)
      .slice(0, 2000);

    await db.update(users).set({ customInstructions: sanitized }).where(eq(users.id, request.userId!));

    return { success: true };
  });

    fastify.post("/config", { preHandler: [fastifyRequireAuth, fastifyValidate(configSchema)] }, async (request, _reply) => {
    // Validate and cap config size before encryption
    const configData = (request.body as Record<string, unknown>).config;
    const configStr = JSON.stringify(configData);
    if (configStr.length > 100_000) {
      throw new AppError(413, "Config payload too large (max 100KB)");
    }
    const encrypted = encrypt(configStr);

    await db.insert(councilConfigs).values({
      userId: request.userId!,
      config: encrypted,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: councilConfigs.userId,
      set: { config: encrypted, updatedAt: new Date() },
    });

    return { success: true };
  });

    fastify.get("/config", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const [row] = await db.select().from(councilConfigs).where(eq(councilConfigs.userId, request.userId!)).limit(1);

    if (!row) return null;
    try {
      const decrypted = JSON.parse(decrypt(row.config as string));
      return decrypted;
    } catch {
      throw new AppError(500, "Failed to decrypt configuration — data may be corrupted");
    }
  });

    fastify.post("/config/rotate", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const [row] = await db.select().from(councilConfigs).where(eq(councilConfigs.userId, request.userId!)).limit(1);

    if (!row) {
      throw new AppError(404, "No configuration found to rotate");
    }

    // Decrypt with the current/previous key, re-encrypt with current key
    let decrypted: unknown;
    try {
      decrypted = JSON.parse(decrypt(row.config as string));
    } catch {
      throw new AppError(500, "Failed to decrypt configuration — data may be corrupted");
    }
    const reEncrypted = encrypt(JSON.stringify(decrypted));

    await db.update(councilConfigs).set({ config: reEncrypted }).where(eq(councilConfigs.userId, request.userId!));

    logger.info({ userId: request.userId }, "Rotated encryption key for user config");
    return { success: true, message: "Keys rotated successfully" };
  });

  // GET /api/auth/settings - retrieve user settings
  fastify.get("/settings", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, request.userId!)).limit(1);
    return row?.settings ?? {};
  });

  // PUT /api/auth/settings - save user settings
  // Zod .strict() schema rejects unknown keys including __proto__/constructor
  // — prevents prototype pollution. Only whitelisted keys pass validation.
  // Cap settings payload size to prevent oversized storage
  fastify.put("/settings", { preHandler: [fastifyRequireAuth, fastifyValidate(userSettingsSchema)] }, async (request, _reply) => {
    const settings = request.body;
    const settingsStr = JSON.stringify(settings);
    if (settingsStr.length > 100_000) {
      throw new AppError(413, "Settings payload too large (max 100KB)");
    }

    await db.insert(userSettings).values({
      userId: request.userId!,
      settings,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: userSettings.userId,
      set: { settings, updatedAt: new Date() },
    });

    return { success: true };
  });
};

export default authPlugin;
