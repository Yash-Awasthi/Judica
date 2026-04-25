/**
 * User Groups — Routes
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addMember,
  removeMember,
  setGroupPermission,
} from "../services/userGroup.service.js";

const userGroupsPlugin: FastifyPluginAsync = async (fastify) => {
  // GET / — list groups
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request) => {
    const groups = await listGroups(request.userId!);
    return { groups };
  });

  // POST / — create group
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, description, isPublic } = request.body as { name?: string; description?: string; isPublic?: boolean };
    if (!name) throw new AppError(400, "Group name is required", "GROUP_NAME_REQUIRED");
    const result = await createGroup(name, description, isPublic || false, request.userId!);
    reply.code(201);
    return result;
  });

  // GET /:id — get group detail
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const group = await getGroup(parseInt(id, 10));
    if (!group) throw new AppError(404, "Group not found", "GROUP_NOT_FOUND");
    return group;
  });

  // PUT /:id — update group
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{ name: string; description: string; isPublic: boolean }>;
    await updateGroup(parseInt(id, 10), body);
    return { success: true };
  });

  // DELETE /:id — delete group
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await deleteGroup(parseInt(id, 10));
    return { success: true };
  });

  // POST /:id/members — add member
  fastify.post("/:id/members", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, role } = request.body as { userId?: number; role?: "member" | "curator" | "admin" };
    if (!userId) throw new AppError(400, "userId is required", "MEMBER_USER_REQUIRED");
    await addMember(parseInt(id, 10), userId, role || "member");
    reply.code(201);
    return { success: true };
  });

  // DELETE /:id/members/:userId — remove member
  fastify.delete("/:id/members/:userId", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id, userId } = request.params as { id: string; userId: string };
    await removeMember(parseInt(id, 10), parseInt(userId, 10));
    return { success: true };
  });

  // POST /:id/permissions — set permission
  fastify.post("/:id/permissions", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { resourceType, resourceId, permission } = request.body as {
      resourceType?: "document_set" | "persona" | "knowledge_base" | "connector";
      resourceId?: string;
      permission?: "read" | "write" | "admin";
    };
    if (!resourceType || !resourceId) throw new AppError(400, "resourceType and resourceId required", "PERMISSION_REQUIRED");
    await setGroupPermission(parseInt(id, 10), resourceType, resourceId, permission || "read");
    reply.code(201);
    return { success: true };
  });
};

export default userGroupsPlugin;
