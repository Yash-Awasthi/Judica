import type { FastifyPluginAsync } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject
} from "../services/project.service.js";
import { AppError } from "../middleware/errorHandler.js";

function validateProjectBody(body: Record<string, unknown>, requireName: boolean): void {
  if (requireName) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new AppError(400, "name is required and must be a non-empty string");
    }
  }
  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      throw new AppError(400, "name must be a string");
    }
    if (body.name.length > 200) {
      throw new AppError(400, "name must be at most 200 characters");
    }
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      throw new AppError(400, "description must be a string");
    }
    if (body.description.length > 2000) {
      throw new AppError(400, "description must be at most 2000 characters");
    }
  }
  if (body.defaultSystemPrompt !== undefined) {
    if (typeof body.defaultSystemPrompt !== "string") {
      throw new AppError(400, "defaultSystemPrompt must be a string");
    }
    if (body.defaultSystemPrompt.length > 10000) {
      throw new AppError(400, "defaultSystemPrompt must be at most 10000 characters");
    }
  }
  if (body.color !== undefined) {
    if (typeof body.color !== "string") {
      throw new AppError(400, "color must be a string");
    }
    if (body.color.length > 20) {
      throw new AppError(400, "color must be at most 20 characters");
    }
  }
  if (body.icon !== undefined) {
    if (typeof body.icon !== "string") {
      throw new AppError(400, "icon must be a string");
    }
    if (body.icon.length > 10) {
      throw new AppError(400, "icon must be at most 10 characters");
    }
  }
}

const projectsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyRateLimit, { max: 60, timeWindow: "1 minute" });
  fastify.addHook("preHandler", fastifyRequireAuth);

  // List projects
  fastify.get("/", async (request, _reply) => {
    const userId = request.userId!;
    const projects = await getProjects(userId);
    return projects;
  });

  // Get project by ID
  fastify.get("/:projectId", async (request, _reply) => {
    const userId = request.userId!;
    const { projectId } = request.params as { projectId: string };
    const project = await getProjectById(projectId, userId);
    if (!project) {
      throw new AppError(404, "Project not found");
    }
    return project;
  });

  // Create project
  fastify.post("/", async (request, reply) => {
    const userId = request.userId!;
    const body = request.body as { name: string; description?: string; defaultCouncilComposition?: Record<string, unknown>; color?: string; icon?: string; defaultSystemPrompt?: string };
    validateProjectBody(body as unknown as Record<string, unknown>, true);
    const project = await createProject({
      userId,
      name: body.name,
      description: body.description,
      color: body.color,
      icon: body.icon,
      defaultCouncilComposition: body.defaultCouncilComposition,
      defaultSystemPrompt: body.defaultSystemPrompt,
    });
    return reply.code(201).send(project);
  });

  // Update project
  fastify.put("/:projectId", async (request, _reply) => {
    const userId = request.userId!;
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { name: string; description?: string; defaultCouncilComposition?: Record<string, unknown>; color?: string; icon?: string; defaultSystemPrompt?: string };
    validateProjectBody(body as unknown as Record<string, unknown>, false);
    const project = await updateProject(projectId, userId, body);
    if (!project) {
      throw new AppError(404, "Project not found");
    }
    return project;
  });

  // Delete project (soft delete)
  fastify.delete("/:projectId", async (request, _reply) => {
    const userId = request.userId!;
    const { projectId } = request.params as { projectId: string };
    const success = await deleteProject(projectId, userId);
    if (!success) {
      throw new AppError(404, "Project not found");
    }
    return { success: true };
  });

  // ── File attachments ─────────────────────────────────────────────────────

  interface ProjectFileEntry {
    id: string;
    filename: string;
    size: number;
    added_at: string;
  }

  // In-memory file store keyed by projectId (swap for DB/R2 when ready)
  const fileStore = new Map<string, ProjectFileEntry[]>();

  // GET /:projectId/files
  fastify.get("/:projectId/files", async (request, _reply) => {
    const { projectId } = request.params as { projectId: string };
    return fileStore.get(projectId) ?? [];
  });

  // POST /:projectId/files — multipart upload
  fastify.post("/:projectId/files", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const data = await (request as any).file?.();
    if (!data) throw new AppError(400, "No file provided");

    const MAX_SIZE = 5 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of data.file) {
      total += chunk.length;
      if (total > MAX_SIZE) throw new AppError(413, "File too large (max 5 MB)");
      chunks.push(chunk);
    }

    const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const entry: ProjectFileEntry = {
      id: fileId,
      filename: data.filename ?? "upload",
      size: total,
      added_at: new Date().toISOString(),
    };

    const existing = fileStore.get(projectId) ?? [];
    if (existing.length >= 10) throw new AppError(400, "Maximum 10 files per project");
    fileStore.set(projectId, [...existing, entry]);

    return reply.code(201).send(entry);
  });

  // DELETE /:projectId/files/:fileId
  fastify.delete("/:projectId/files/:fileId", async (request, _reply) => {
    const { projectId, fileId } = request.params as { projectId: string; fileId: string };
    const files = fileStore.get(projectId) ?? [];
    if (!files.find((f) => f.id === fileId)) throw new AppError(404, "File not found");
    fileStore.set(projectId, files.filter((f) => f.id !== fileId));
    return { deleted: true };
  });
};

export default projectsPlugin;
