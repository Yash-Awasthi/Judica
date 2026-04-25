import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { prompts, promptVersions } from "../db/schema/prompts.js";
import { eq, and, desc, max } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { routeAndCollect } from "../router/index.js";
import {
  createVersion,
  listVersions,
  getVersion,
  rollback,
  diffVersions,
} from "../services/promptVersion.service.js";

const promptsPlugin: FastifyPluginAsync = async (fastify) => {
    // GET / — list user's prompts
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userPrompts = await db
      .select()
      .from(prompts)
      .where(eq(prompts.userId, request.userId!))
      .orderBy(desc(prompts.createdAt));

    // For each prompt, fetch the latest version summary
    const result = await Promise.all(
      userPrompts.map(async (p) => {
        const versions = await db
          .select({
            id: promptVersions.id,
            versionNum: promptVersions.versionNum,
            createdAt: promptVersions.createdAt,
          })
          .from(promptVersions)
          .where(eq(promptVersions.promptId, p.id))
          .orderBy(desc(promptVersions.versionNum))
          .limit(1);

        return { ...p, versions };
      }),
    );

    return { prompts: result };
  });

    // POST / — create prompt + first version
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, description, content, model, temperature } = request.body as { name?: string; content?: string; description?: string; tags?: string[]; category?: string; isPublic?: boolean; model?: string; temperature?: number };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new AppError(400, "Name is required", "PROMPT_NAME_REQUIRED");
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(400, "Content is required", "PROMPT_CONTENT_REQUIRED");
    }

    const promptId = randomUUID();
    const versionId = randomUUID();

    const [newPrompt] = await db
      .insert(prompts)
      .values({
        id: promptId,
        userId: request.userId!,
        name: name.trim(),
        description: description?.trim() || null,
      })
      .returning();

    const [newVersion] = await db
      .insert(promptVersions)
      .values({
        id: versionId,
        promptId,
        versionNum: 1,
        content: content.trim(),
        model: model || null,
        temperature: temperature ?? null,
      })
      .returning();

    reply.code(201);
    return { ...newPrompt, versions: [newVersion] };
  });

    // GET /:id — get prompt detail with latest version
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const versions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, prompt.id))
      .orderBy(desc(promptVersions.versionNum))
      .limit(1);

    return { ...prompt, versions };
  });

    // DELETE /:id — delete prompt (cascades versions)
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    await db.delete(prompts).where(eq(prompts.id, prompt.id));
    return { success: true };
  });

    // GET /:id/versions — list all versions for prompt
  fastify.get("/:id/versions", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const versions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, prompt.id))
      .orderBy(desc(promptVersions.versionNum));

    return { versions };
  });

    // POST /:id/versions — create new version
  fastify.post("/:id/versions", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const { content, model, temperature, notes } = request.body as { name?: string; content?: string; description?: string; tags?: string[]; category?: string; isPublic?: boolean; model?: string; temperature?: number; notes?: string };
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(400, "Content is required", "VERSION_CONTENT_REQUIRED");
    }

    // Get current max versionNum and insert in a transaction to avoid TOCTOU race
    const [version] = await db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ maxVersion: max(promptVersions.versionNum) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, prompt.id));

      const nextVersion = (latest?.maxVersion ?? 0) + 1;

      return tx
        .insert(promptVersions)
        .values({
          id: randomUUID(),
          promptId: prompt.id,
          versionNum: nextVersion,
          content: content.trim(),
          model: model || null,
          temperature: temperature ?? null,
          notes: notes?.trim() || null,
        })
        .returning();
    });

    reply.code(201);
    return version;
  });

    // GET /:id/versions/:versionNum — get specific version
  fastify.get("/:id/versions/:versionNum", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id, versionNum: versionNumParam } = request.params as { id: string; versionNum: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const versionNum = parseInt(versionNumParam, 10);
    if (isNaN(versionNum)) {
      throw new AppError(400, "Invalid version number", "INVALID_VERSION_NUM");
    }

    const [version] = await db
      .select()
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.promptId, prompt.id),
          eq(promptVersions.versionNum, versionNum),
        ),
      );

    if (!version) throw new AppError(404, "Version not found", "VERSION_NOT_FOUND");

    return version;
  });

    // PUT /:id — update prompt metadata and auto-create version if content provided
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { name, description, content, systemPrompt, changeNote } = request.body as {
      name?: string;
      description?: string;
      content?: string;
      systemPrompt?: string;
      changeNote?: string;
    };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    // Update prompt metadata if provided
    const updates: Partial<typeof prompts.$inferInsert> = {};
    if (name && typeof name === "string" && name.trim().length > 0) {
      updates.name = name.trim();
    }
    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }

    if (Object.keys(updates).length > 0) {
      await db.update(prompts).set(updates).where(eq(prompts.id, id));
    }

    // Auto-create a version record if content was updated
    let newVersion = null;
    if (content && typeof content === "string" && content.trim().length > 0) {
      newVersion = await createVersion(
        id,
        { content: content.trim(), systemPrompt: systemPrompt ?? null },
        request.userId!,
        changeNote
      );
    }

    return { success: true, version: newVersion };
  });

    // GET /:id/versions/history — list extended version history
  fastify.get("/:id/versions/history", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const versions = await listVersions(id);
    return { versions };
  });

    // POST /:id/versions/:version/rollback — rollback to a prior version
  fastify.post("/:id/versions/:version/rollback", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id, version: versionParam } = request.params as { id: string; version: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const version = parseInt(versionParam, 10);
    if (isNaN(version) || version < 1) {
      throw new AppError(400, "Invalid version number", "INVALID_VERSION_NUM");
    }

    const newVersion = await rollback(id, version, request.userId!);
    reply.code(201);
    return newVersion;
  });

    // GET /:id/versions/:v1/diff/:v2 — diff two versions
  fastify.get("/:id/versions/:v1/diff/:v2", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id, v1: v1Param, v2: v2Param } = request.params as { id: string; v1: string; v2: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const v1 = parseInt(v1Param, 10);
    const v2 = parseInt(v2Param, 10);
    if (isNaN(v1) || isNaN(v2) || v1 < 1 || v2 < 1) {
      throw new AppError(400, "Invalid version numbers", "INVALID_VERSION_NUM");
    }

    return diffVersions(id, v1, v2);
  });

    // POST /test — test a prompt against LLM
  fastify.post("/test", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { content, model, temperature, test_input } = request.body as { name?: string; content?: string; description?: string; tags?: string[]; category?: string; isPublic?: boolean; model?: string; temperature?: number; test_input?: string };

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(400, "Content is required", "TEST_CONTENT_REQUIRED");
    }

    // Replace {{input}} placeholder with test_input if provided
    // R2-08: Sanitize test_input against prompt injection before substituting
    let resolvedContent = content;
    if (test_input) {
      const { sanitizeForPrompt } = await import("../lib/sanitize.js");
      const safeInput = sanitizeForPrompt(test_input).slice(0, 2000);
      resolvedContent = resolvedContent.replace(/\{\{input\}\}/g, safeInput);
    }

    const startTime = Date.now();

    const result = await routeAndCollect(
      {
        model: model || "auto",
        messages: [{ role: "user", content: resolvedContent }],
        temperature: temperature ?? undefined,
      },
      { preferredModel: model || undefined },
    );

    const latencyMs = Date.now() - startTime;

    return {
      response: result.text,
      latency_ms: latencyMs,
      usage: result.usage,
    };
  });
};

export default promptsPlugin;
