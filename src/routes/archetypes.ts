import { FastifyPluginAsync } from "fastify";
import {
  getUserArchetypes,
  upsertUserArchetype,
  deleteUserArchetype,
  toggleArchetypeStatus,
  validateArchetype,
  cloneDefaultArchetype,
  exportUserArchetypes,
  importArchetypes,
  getArchetypeUsage,
  type UserArchetypeInput
} from "../lib/archetypes.js";
import { fastifyOptionalAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";

const archetypesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", { preHandler: fastifyOptionalAuth }, async (request, _reply) => {
    const userId = request.userId;

    if (!userId) {
      const { ARCHETYPES } = await import("../config/archetypes.js");
      return { archetypes: ARCHETYPES, isCustom: false };
    }

    const archetypes = await getUserArchetypes(userId);
    const usage = await getArchetypeUsage(userId);

    return {
      archetypes,
      usage,
      isCustom: true
    };
  });

  fastify.post("/", { preHandler: fastifyOptionalAuth }, async (request, _reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required for custom archetypes");
    }

    const { archetypeId, ...archetypeData } = request.body as Record<string, unknown>;

    const validation = validateArchetype(archetypeData as unknown as UserArchetypeInput);
    if (!validation.valid) {
      throw new AppError(400, `Validation failed: ${validation.errors.join(", ")}`);
    }

    const archetype = await upsertUserArchetype(userId, archetypeData as unknown as UserArchetypeInput, archetypeId as string | undefined);

    return {
      message: archetypeId ? "Archetype updated successfully" : "Archetype created successfully",
      archetype
    };
  });

  fastify.delete("/:id", { preHandler: fastifyOptionalAuth }, async (request, _reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const { id } = request.params as { id: string };
    await deleteUserArchetype(userId, id as string);

    return { message: "Archetype deleted successfully" };
  });

  fastify.patch("/:id/toggle", { preHandler: fastifyOptionalAuth }, async (request, _reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const { id } = request.params as { id: string };
    const isActive = await toggleArchetypeStatus(userId, id as string);

    return {
      message: `Archetype ${isActive ? "activated" : "deactivated"} successfully`,
      isActive
    };
  });

  fastify.post("/:id/clone", { preHandler: fastifyOptionalAuth }, async (request, _reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const { id } = request.params as { id: string };
    const clonedData = cloneDefaultArchetype(id as string);

    const customizations = request.body as Record<string, unknown>;
    const finalData = { ...clonedData, ...customizations };

    const validation = validateArchetype(finalData);
    if (!validation.valid) {
      throw new AppError(400, `Validation failed: ${validation.errors.join(", ")}`);
    }

    const archetype = await upsertUserArchetype(userId, finalData);

    return {
      message: "Archetype cloned successfully",
      archetype
    };
  });

  fastify.get("/export", { preHandler: fastifyOptionalAuth }, async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const exportData = await exportUserArchetypes(userId);

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', 'attachment; filename="archetypes.json"');
    return reply.send(exportData);
  });

  fastify.post("/import", { preHandler: fastifyOptionalAuth }, async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const { jsonData } = request.body as { jsonData?: string };
    if (!jsonData) {
      throw new AppError(400, "JSON data is required");
    }

    const result = await importArchetypes(userId, jsonData);

    if (result.errors.length > 0) {
      reply.code(207);
      return {
        message: `Imported ${result.imported} archetypes with ${result.errors.length} errors`,
        imported: result.imported,
        errors: result.errors
      };
    } else {
      return {
        message: `Successfully imported ${result.imported} archetypes`,
        imported: result.imported
      };
    }
  });

  fastify.get("/usage", { preHandler: fastifyOptionalAuth }, async (request, _reply) => {
    const userId = request.userId;
    if (!userId) {
      throw new AppError(401, "Authentication required");
    }

    const usage = await getArchetypeUsage(userId);

    return { usage };
  });
};

export default archetypesPlugin;
