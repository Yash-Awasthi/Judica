import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { validate, authSchema, configSchema } from "../middleware/validate.js";
import { encryptConfig, decryptConfig } from "../lib/crypto.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

// ── Register ────────────────────────────────────────────
router.post("/register", validate(authSchema), async (req, res: Response, next) => {
  try {
    const { username, password } = req.body;
    const hash = bcrypt.hashSync(password, 12);

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

// ── Login ───────────────────────────────────────────────
router.post("/login", validate(authSchema), async (req, res: Response, next) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
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

// ── Get profile ─────────────────────────────────────────
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

// ── Update custom instructions ──────────────────────────
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

// ── Save council config ─────────────────────────────────
router.post("/config", requireAuth, validate(configSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const encrypted = encryptConfig(req.body.config);

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

// ── Load council config ─────────────────────────────────
router.get("/config", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const row = await prisma.councilConfig.findUnique({
      where: { userId: req.userId },
    });

    if (!row) { res.json(null); return; }
    const decrypted = decryptConfig(row.config);
    res.json(decrypted);
  } catch (e) {
    next(e);
  }
});

export default router;