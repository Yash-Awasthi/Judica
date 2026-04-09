import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto, { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { refreshTokens, revokedTokens, councilConfigs } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { authSchema, configSchema } from "../middleware/validate.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { AppError } from "../middleware/errorHandler.js";

const ACCESS_TOKEN_EXPIRY = "15m";
const REFRESH_TOKEN_TTL_DAYS = 7;
const REFRESH_TOKEN_TTL_SECS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

function generateAccessToken(userId: number, username: string): string {
  return jwt.sign({ userId, username }, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createRefreshToken(userId: number): Promise<string> {
  const rawToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECS * 1000);

  await db.insert(refreshTokens).values({ id: randomUUID(), userId, tokenHash, expiresAt });

  return rawToken;
}

async function issueTokenPair(userId: number, username: string, reply: FastifyReply): Promise<void> {
  const accessToken = generateAccessToken(userId, username);
  const refreshToken = await createRefreshToken(userId);

  // Set refresh token as httpOnly cookie
  reply.setCookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_TOKEN_TTL_SECS,
    path: "/api/auth",
  });

  return { token: accessToken, username } as any;
}

function fastifyValidate(schema: any) {
  return async (request: any, reply: any) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      throw new AppError(400, result.error.issues.map((i: any) => i.message).join(", "));
    }
    request.body = result.data;
  };
}

const authPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * @openapi
   * /api/auth/register:
   *   post:
   *     tags: [Auth]
   *     summary: Register a new user account
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username: { type: string }
   *               password: { type: string, minLength: 8 }
   *     responses:
   *       201: { description: Account created, content: { application/json: { schema: { type: object, properties: { token: { type: string }, username: { type: string } } } } } }
   *       409: { description: Username already taken }
   *       400: { description: Validation error }
   */
  fastify.post("/register", { preHandler: [fastifyValidate(authSchema)] }, async (request, reply) => {
    try {
      const { username, password } = request.body as any;
      const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });

      const [user] = await db.insert(users).values({ username, passwordHash: hash }).returning();

      logger.info({ username }, "New user registered");
      reply.code(201);
      return issueTokenPair(user.id, username, reply);
    } catch (e: any) {
      if (e.code === "23505") {
        throw new AppError(409, "Username already taken");
      }
      throw e;
    }
  });

  /**
   * @openapi
   * /api/auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Log in with username and password
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username: { type: string }
   *               password: { type: string }
   *     responses:
   *       200: { description: Login successful, content: { application/json: { schema: { type: object, properties: { token: { type: string }, username: { type: string } } } } } }
   *       401: { description: Invalid username or password }
   *       400: { description: Validation error }
   */
  fastify.post("/login", { preHandler: [fastifyValidate(authSchema)] }, async (request, reply) => {
    const { username, password } = request.body as any;
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

    if (!user) {
      throw new AppError(401, "Invalid username or password");
    }

    // Support both legacy bcrypt ($2a$/$2b$) and new argon2id hashes
    let passwordValid = false;
    const isBcryptHash = user.passwordHash.startsWith("$2a$") || user.passwordHash.startsWith("$2b$");

    if (isBcryptHash) {
      // Dynamic import for legacy bcrypt verification only
      const { default: bcrypt } = await import("bcryptjs");
      passwordValid = await bcrypt.compare(password, user.passwordHash);
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
    return issueTokenPair(user.id, username, reply);
  });

  /**
   * @openapi
   * /api/auth/logout:
   *   post:
   *     tags: [Auth]
   *     summary: Log out and revoke the current JWT token
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema: { type: string }
   *         description: Bearer token
   *     responses:
   *       200: { description: Logout successful, content: { application/json: { schema: { type: object, properties: { success: { type: boolean } } } } } }
   *       401: { description: Unauthorized }
   */
  fastify.post("/logout", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    // Revoke access token
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
       const token = authHeader.split(" ")[1];
       const payload = jwt.decode(token) as any;
       const expiresAt = payload?.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 15 * 60 * 1000);

       const ttlSecs = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
       await redis.set(`revoked:${token}`, "1", { EX: ttlSecs });

       await db.insert(revokedTokens).values({ token, expiresAt });
    }

    // Revoke refresh token
    const refreshToken = (request as any).cookies?.refresh_token;
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    }

    // Clear the refresh token cookie
    reply.clearCookie("refresh_token", { path: "/api/auth" });
    return { success: true };
  });

  /**
   * @openapi
   * /api/auth/me:
   *   get:
   *     tags: [Auth]
   *     summary: Get the authenticated user's profile
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema: { type: string }
   *         description: Bearer token
   *     responses:
   *       200:
   *         description: User profile
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id: { type: string }
   *                 username: { type: string }
   *                 customInstructions: { type: string, nullable: true }
   *                 createdAt: { type: string, format: date-time }
   *       401: { description: Unauthorized }
   *       404: { description: User not found }
   */
  fastify.get("/me", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    const [user] = await db.select({
      id: users.id,
      username: users.username,
      customInstructions: users.customInstructions,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, request.userId!)).limit(1);

    if (!user) throw new AppError(404, "User not found");
    return user;
  });

  /**
   * @openapi
   * /api/auth/refresh:
   *   post:
   *     tags: [Auth]
   *     summary: Rotate refresh token and get a new access token
   *     description: Uses httpOnly refresh_token cookie. The old refresh token is invalidated and a new pair is issued (token rotation).
   *     responses:
   *       200: { description: Token refreshed, content: { application/json: { schema: { type: object, properties: { token: { type: string }, username: { type: string } } } } } }
   *       401: { description: Invalid or expired refresh token }
   */
  fastify.post("/refresh", async (request, reply) => {
    const refreshToken = (request as any).cookies?.refresh_token;
    if (!refreshToken) {
      throw new AppError(401, "No refresh token provided");
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const [storedToken] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);

    if (!storedToken || storedToken.expiresAt < new Date()) {
      // If token not found, it may have been reused (replay attack) — revoke all user tokens
      if (!storedToken) {
        // Token was already consumed — potential replay attack
        // We can't know which user, so just reject
        logger.warn("Refresh token replay detected");
      }
      reply.clearCookie("refresh_token", { path: "/api/auth" });
      throw new AppError(401, "Invalid or expired refresh token");
    }

    // Delete the used refresh token (single-use rotation)
    await db.delete(refreshTokens).where(eq(refreshTokens.id, storedToken.id));

    // Look up the user separately
    const [user] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.id, storedToken.userId)).limit(1);

    logger.info({ username: user.username }, "Token refreshed via rotation");
    return issueTokenPair(user.id, user.username, reply);
  });

  /**
   * @openapi
   * /api/auth/me:
   *   patch:
   *     tags: [Auth]
   *     summary: Update the authenticated user's custom instructions
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema: { type: string }
   *         description: Bearer token
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [custom_instructions]
   *             properties:
   *               custom_instructions: { type: string, maxLength: 2000 }
   *     responses:
   *       200: { description: Update successful, content: { application/json: { schema: { type: object, properties: { success: { type: boolean } } } } } }
   *       400: { description: custom_instructions must be a string }
   *       401: { description: Unauthorized }
   */
  fastify.patch("/me", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    const { custom_instructions } = request.body as any;
    if (typeof custom_instructions !== "string") {
      throw new AppError(400, "custom_instructions must be a string");
    }

    await db.update(users).set({ customInstructions: custom_instructions.slice(0, 2000) }).where(eq(users.id, request.userId!));

    return { success: true };
  });

  /**
   * @openapi
   * /api/auth/config:
   *   post:
   *     tags: [Auth]
   *     summary: Save or update the user's council configuration
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema: { type: string }
   *         description: Bearer token
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [config]
   *             properties:
   *               config: { type: object, description: Council configuration object }
   *     responses:
   *       200: { description: Configuration saved, content: { application/json: { schema: { type: object, properties: { success: { type: boolean } } } } } }
   *       400: { description: Validation error }
   *       401: { description: Unauthorized }
   */
  fastify.post("/config", { preHandler: [fastifyRequireAuth, fastifyValidate(configSchema)] }, async (request, reply) => {
    const encrypted = encrypt(JSON.stringify((request.body as any).config));

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

  /**
   * @openapi
   * /api/auth/config:
   *   get:
   *     tags: [Auth]
   *     summary: Retrieve the user's council configuration
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema: { type: string }
   *         description: Bearer token
   *     responses:
   *       200: { description: Configuration object or null if not set, content: { application/json: { schema: { type: object, nullable: true } } } }
   *       401: { description: Unauthorized }
   */
  fastify.get("/config", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    const [row] = await db.select().from(councilConfigs).where(eq(councilConfigs.userId, request.userId!)).limit(1);

    if (!row) return null;
    const decrypted = JSON.parse(decrypt(row.config as string));
    return decrypted;
  });

  /**
   * @openapi
   * /api/auth/config/rotate:
   *   post:
   *     tags: [Auth]
   *     summary: Rotate encryption on the user's stored API keys
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: header
   *         name: Authorization
   *         required: true
   *         schema: { type: string }
   *         description: Bearer token
   *     responses:
   *       200: { description: Keys rotated successfully, content: { application/json: { schema: { type: object, properties: { success: { type: boolean }, message: { type: string } } } } } }
   *       401: { description: Unauthorized }
   *       404: { description: No configuration found to rotate }
   */
  fastify.post("/config/rotate", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    const [row] = await db.select().from(councilConfigs).where(eq(councilConfigs.userId, request.userId!)).limit(1);

    if (!row) {
      throw new AppError(404, "No configuration found to rotate");
    }

    const decrypted = JSON.parse(decrypt(row.config as string));
    const reEncrypted = encrypt(JSON.stringify(decrypted));

    await db.update(councilConfigs).set({ config: reEncrypted }).where(eq(councilConfigs.userId, request.userId!));

    logger.info({ userId: request.userId }, "Rotated API keys for user config");
    return { success: true, message: "Keys rotated successfully" };
  });
};

export default authPlugin;
