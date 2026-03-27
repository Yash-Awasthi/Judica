import { Router, Response } from "express";
import prisma from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { validate, archetypeSchema } from "../middleware/validate.js";
import { ARCHETYPES } from "../config/archetypes.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

// ── GET /council/archetypes ──────────────────────────────────────────────────
// Returns all archetypes available to the user (System + Custom)
router.get("/archetypes", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const config = await prisma.councilConfig.findUnique({
      where: { userId: req.userId! }
    });

    const customArchetypes = config ? (config.config as any).customArchetypes || [] : [];
    const systemArchetypes = Object.values(ARCHETYPES);

    res.json({
      system: systemArchetypes,
      custom: customArchetypes
    });
  } catch (e) {
    next(e);
  }
});

// ── POST /council/archetypes ─────────────────────────────────────────────────
// Creates or updates a custom archetype
router.post("/archetypes", requireAuth, validate(archetypeSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const newArchetype = req.body;
    
    const currentConfig = await prisma.councilConfig.findUnique({
      where: { userId: req.userId! }
    });

    const customArchetypes = currentConfig ? (currentConfig.config as any).customArchetypes || [] : [];
    
    // Check if system archetype with same ID exists
    if (ARCHETYPES[newArchetype.id]) {
      throw new AppError(400, "Cannot override system archetypes");
    }

    // Update or Add
    const existingIdx = customArchetypes.findIndex((a: any) => a.id === newArchetype.id);
    if (existingIdx > -1) {
      customArchetypes[existingIdx] = newArchetype;
    } else {
      if (customArchetypes.length >= 20) {
        throw new AppError(400, "Maximum of 20 custom archetypes allowed");
      }
      customArchetypes.push(newArchetype);
    }

    // Preserve existing config keys (like 'members') while updating 'customArchetypes'
    const updatedConfig = { 
      ...(currentConfig?.config as any || {}), 
      customArchetypes 
    };

    await prisma.councilConfig.upsert({
      where: { userId: req.userId! },
      update: { config: updatedConfig },
      create: { userId: req.userId!, config: updatedConfig }
    });

    res.json({ success: true, archetype: newArchetype });
  } catch (e) {
    next(e);
  }
});

// ── DELETE /council/archetypes/:id ───────────────────────────────────────────
router.delete("/archetypes/:id", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    
    const currentConfig = await prisma.councilConfig.findUnique({
      where: { userId: req.userId! }
    });

    if (!currentConfig) throw new AppError(404, "No custom archetypes found");

    const customArchetypes = (currentConfig.config as any).customArchetypes || [];
    const filtered = customArchetypes.filter((a: any) => a.id !== id);

    if (filtered.length === customArchetypes.length) {
      throw new AppError(404, "Custom archetype not found");
    }

    const updatedConfig = {
      ...(currentConfig.config as any || {}),
      customArchetypes: filtered
    };

    await prisma.councilConfig.update({
      where: { userId: req.userId! },
      data: { config: updatedConfig }
    });

    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;
