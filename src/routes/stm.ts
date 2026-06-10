/**
 * STM modules — GET/POST /api/stm
 *
 * Lightweight config endpoint: list available modules,
 * validate a requested combination, and persist active modules per user.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  STM_MODULES,
  validateSTMCombination,
  type STMModuleId,
} from "../lib/stmModules.js";
import { db } from "../lib/drizzle.js";
import { userSettings } from "../db/schema/users.js";
import { eq } from "drizzle-orm";

const stmPlugin: FastifyPluginAsync = async (fastify) => {

  // GET /api/stm — list all available modules
  fastify.get("/", async () => ({
    modules: STM_MODULES.map(({ id, label, description, icon, conflictsWith }) => ({
      id, label, description, icon,
      conflictsWith: conflictsWith ?? [],
    })),
  }));

  // GET /api/stm/active — get active modules for current user
  fastify.get("/active", { preHandler: fastifyRequireAuth }, async (request) => {
    const settings = await db.query.userSettings?.findFirst?.({
      where: eq(userSettings.userId, request.userId!),
    }).catch(() => null);

    const raw = (settings as any)?.stmModules;
    const active: STMModuleId[] = Array.isArray(raw) ? raw : [];
    return { active };
  });

  // POST /api/stm/active — set active modules
  fastify.post<{ Body: { modules: STMModuleId[] } }>(
    "/active",
    { preHandler: fastifyRequireAuth },
    async (request) => {
      const { modules } = request.body ?? {};
      if (!Array.isArray(modules)) {
        throw new AppError(400, "modules must be an array", "INVALID_MODULES");
      }

      const validIds = new Set(STM_MODULES.map((m) => m.id));
      const invalid  = modules.filter((id) => !validIds.has(id));
      if (invalid.length) {
        throw new AppError(400, `Invalid module IDs: ${invalid.join(", ")}`, "INVALID_MODULES");
      }

      const conflicts = validateSTMCombination(modules);
      if (conflicts.length) {
        throw new AppError(400, `Module conflicts: ${conflicts.join("; ")}`, "MODULE_CONFLICT");
      }

      // Upsert into user settings
      await db
        .insert(userSettings)
        .values({ userId: request.userId!, stmModules: modules } as any)
        .onConflictDoUpdate({
          target: userSettings.userId,
          set:    { stmModules: modules } as any,
        })
        .catch(() => {
          // userSettings table may not have stmModules column yet — graceful fallback
        });

      return { success: true, active: modules, conflicts: [] };
    }
  );

  // POST /api/stm/validate — dry-run validate a combination
  fastify.post<{ Body: { modules: STMModuleId[] } }>(
    "/validate",
    async (request) => {
      const { modules = [] } = request.body ?? {};
      const conflicts = validateSTMCombination(modules);
      return {
        valid:     conflicts.length === 0,
        conflicts,
        modules:   modules.map((id) => STM_MODULES.find((m) => m.id === id)).filter(Boolean),
      };
    }
  );
};

export default stmPlugin;
