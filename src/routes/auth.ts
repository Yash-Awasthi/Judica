import { Router, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
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
    const hash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { username, passwordHash: hash },
    });

    const token = jwt.sign(
      { userId: user.id, username },
      env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    logger.info({ username }, "New user registered");
    res.status(201).json({ token, username });
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

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError(401, "Invalid username or password");
    }

    const token = jwt.sign(
      { userId: user.id, username },
      env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    logger.info({ username }, "User logged in");
    res.json({ token, username });
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
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
       const token = authHeader.split(" ")[1];
       const payload = jwt.decode(token) as any;
       const expiresAt = payload?.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

       const ttlSecs = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
       await redis.set(`revoked:${token}`, "1", { EX: ttlSecs });

       await prisma.revokedToken.create({
         data: { token, expiresAt }
       });
    }
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
 *     summary: Refresh the current JWT token
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         required: true
 *         schema: { type: string }
 *         description: Bearer token
 *     responses:
 *       200: { description: Token refreshed, content: { application/json: { schema: { type: object, properties: { token: { type: string }, username: { type: string } } } } } }
 *       401: { description: Unauthorized }
 */
router.post("/refresh", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const token = jwt.sign(
      { userId: req.userId, username: req.username },
      env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    logger.info({ username: req.username }, "Token refreshed");
    res.json({ token, username: req.username });
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
      create: { userId: req.userId!, config: encrypted },
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
