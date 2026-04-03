import { Router, Response, NextFunction } from "express";
import { 
  getUserArchetypes, 
  upsertUserArchetype, 
  deleteUserArchetype, 
  toggleArchetypeStatus,
  validateArchetype,
  cloneDefaultArchetype,
  exportUserArchetypes,
  importArchetypes,
  getArchetypeUsage
} from "../lib/archetypes.js";
import { optionalAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

// ── GET /api/archetypes - Get user's archetypes ─────────────────────────────
router.get("/", optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    
    if (!userId) {
      // Return default archetypes for unauthenticated users
      const { ARCHETYPES } = await import("../config/archetypes.js");
      return res.json({ archetypes: ARCHETYPES, isCustom: false });
    }

    const archetypes = await getUserArchetypes(userId);
    const usage = await getArchetypeUsage(userId);
    
    res.json({ 
      archetypes, 
      usage,
      isCustom: true 
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/archetypes - Create or update archetype ───────────────────────────
router.post("/", optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required for custom archetypes");
    }

    const { archetypeId, ...archetypeData } = req.body;
    
    // Validate input
    const validation = validateArchetype(archetypeData);
    if (!validation.valid) {
      throw new AppError(400, `Validation failed: ${validation.errors.join(", ")}`);
    }

    const archetype = await upsertUserArchetype(userId, archetypeData, archetypeId);
    
    res.json({ 
      message: archetypeId ? "Archetype updated successfully" : "Archetype created successfully",
      archetype 
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/archetypes/:id - Delete archetype ───────────────────────────────
router.delete("/:id", optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const { id } = req.params;
    await deleteUserArchetype(userId, id as string);
    
    res.json({ message: "Archetype deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/archetypes/:id/toggle - Toggle archetype status ───────────────────
router.patch("/:id/toggle", optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const { id } = req.params;
    const isActive = await toggleArchetypeStatus(userId, id as string);
    
    res.json({ 
      message: `Archetype ${isActive ? "activated" : "deactivated"} successfully`,
      isActive 
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/archetypes/:id/clone - Clone default archetype ───────────────────────
router.post("/:id/clone", optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const { id } = req.params;
    const clonedData = cloneDefaultArchetype(id as string);
    
    // Allow customization of cloned data
    const customizations = req.body;
    const finalData = { ...clonedData, ...customizations };
    
    const validation = validateArchetype(finalData);
    if (!validation.valid) {
      throw new AppError(400, `Validation failed: ${validation.errors.join(", ")}`);
    }

    const archetype = await upsertUserArchetype(userId, finalData);
    
    res.json({ 
      message: "Archetype cloned successfully",
      archetype 
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/archetypes/export - Export archetypes ─────────────────────────────────
router.get("/export", optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const exportData = await exportUserArchetypes(userId);
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="archetypes.json"');
    res.send(exportData);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/archetypes/import - Import archetypes ─────────────────────────────────
router.post("/import", optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const { jsonData } = req.body;
    if (!jsonData) {
      throw new AppError(400, "JSON data is required");
    }

    const result = await importArchetypes(userId, jsonData);
    
    if (result.errors.length > 0) {
      res.status(207).json({ // 207 Multi-Status
        message: `Imported ${result.imported} archetypes with ${result.errors.length} errors`,
        imported: result.imported,
        errors: result.errors
      });
    } else {
      res.json({ 
        message: `Successfully imported ${result.imported} archetypes`,
        imported: result.imported
      });
    }
  } catch (err) {
    next(err);
  }
});

// ── GET /api/archetypes/usage - Get archetype usage statistics ───────────────────────
router.get("/usage", optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const usage = await getArchetypeUsage(userId);
    
    res.json({ usage });
  } catch (err) {
    next(err);
  }
});

export default router;
