import { Router, Response, NextFunction } from "express";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import prisma from "../lib/db.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { validate, authSchema, configSchema } from "../middleware/validate.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

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

  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return rawToken;
}

async function issueTokenPair(userId: number, username: string, res: Response): Promise<void> {
  const accessToken = generateAccessToken(userId, username);
  const refreshToken = await createRefreshToken(userId);

  // Set refresh token as httpOnly cookie
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: REFRESH_TOKEN_TTL_SECS * 1000,
    path: "/api/auth",
  });

  res.json({ token: accessToken, username });
}

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
router.post("/register", validate(authSchema), async (req, res: Response, next) => {
  try {
    const { username, password } = req.body;
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });

    const user = await prisma.user.create({
      data: { username, passwordHash: hash },
    });

    logger.info({ username }, "New user registered");
    await issueTokenPair(user.id, username, res);
    res.status(201);
  } catch (e: any) {
    if (e.code === "P2002") {
      next(new AppError(409, "Username already taken"));
    } else {
      next(e);
    }
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
router.post("/login", validate(authSchema), async (req, res: Response, next) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });

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
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
      logger.info({ username }, "Migrated password hash from bcrypt to argon2id");
    }

    logger.info({ username }, "User logged in");
    await issueTokenPair(user.id, username, res);
  } catch (e) {
    next(e);
  }
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
router.post("/logout", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    // Revoke access token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
       const token = authHeader.split(" ")[1];
       const payload = jwt.decode(token) as any;
       const expiresAt = payload?.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 15 * 60 * 1000);

       const ttlSecs = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
       await redis.set(`revoked:${token}`, "1", { EX: ttlSecs });

       await prisma.revokedToken.create({
         data: { token, expiresAt }
       });
    }

    // Revoke refresh token
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      await prisma.refreshToken.deleteMany({ where: { tokenHash } });
    }

    // Clear the refresh token cookie
    res.clearCookie("refresh_token", { path: "/api/auth" });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
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
router.get("/me", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, username: true, customInstructions: true, createdAt: true },
    });

    if (!user) throw new AppError(404, "User not found");
    res.json(user);
  } catch (e) {
    next(e);
  }
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
router.post("/refresh", async (req: any, res: Response, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      throw new AppError(401, "No refresh token provided");
    }

    const tokenHash = hashRefreshToken(refreshToken);
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { User: { select: { id: true, username: true } } },
    });

    if (!storedToken || storedToken.expiresAt < new Date()) {
      // If token not found, it may have been reused (replay attack) — revoke all user tokens
      if (!storedToken) {
        // Token was already consumed — potential replay attack
        // We can't know which user, so just reject
        logger.warn("Refresh token replay detected");
      }
      res.clearCookie("refresh_token", { path: "/api/auth" });
      throw new AppError(401, "Invalid or expired refresh token");
    }

    // Delete the used refresh token (single-use rotation)
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const { id: userId, username } = storedToken.User;

    logger.info({ username }, "Token refreshed via rotation");
    await issueTokenPair(userId, username, res);
  } catch (e) {
    next(e);
  }
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
router.patch("/me", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { custom_instructions } = req.body;
    if (typeof custom_instructions !== "string") {
      throw new AppError(400, "custom_instructions must be a string");
    }

    await prisma.user.update({
      where: { id: req.userId },
      data: { customInstructions: custom_instructions.slice(0, 2000) },
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
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
router.post("/config", requireAuth, validate(configSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const encrypted = encrypt(JSON.stringify(req.body.config));

    await prisma.councilConfig.upsert({
      where: { userId: req.userId! },
      update: { config: encrypted },
      create: { userId: req.userId!, config: encrypted } as any,
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
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
router.get("/config", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const row = await prisma.councilConfig.findUnique({
      where: { userId: req.userId },
    });

    if (!row) { res.json(null); return; }
    const decrypted = JSON.parse(decrypt(row.config as string));
    res.json(decrypted);
  } catch (e) {
    next(e);
  }
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
router.post("/config/rotate", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const row = await prisma.councilConfig.findUnique({
      where: { userId: req.userId },
    });

    if (!row) {
      throw new AppError(404, "No configuration found to rotate");
    }

    const decrypted = JSON.parse(decrypt(row.config as string));

    const reEncrypted = encrypt(JSON.stringify(decrypted));

    await prisma.councilConfig.update({
      where: { userId: req.userId! },
      data: { config: reEncrypted },
    });

    logger.info({ userId: req.userId }, "Rotated API keys for user config");
    res.json({ success: true, message: "Keys rotated successfully" });
  } catch (e) {
    next(e);
  }
});

export default router;
