import { FastifyPluginAsync } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject
} from "../services/projectService.js";
import { AppError } from "../middleware/errorHandler.js";

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
};

export default projectsPlugin;
