/**
 * Document Set Routes — REST API for managing document collections.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  createDocumentSet,
  listDocumentSets,
  getDocumentSet,
  updateDocumentSet,
  deleteDocumentSet,
  addDocumentToSet,
  removeDocumentFromSet,
} from "../services/documentSet.service.js";

const documentSetsPlugin: FastifyPluginAsync = async (fastify) => {
  // POST / — create document set
  fastify.post("/", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { name, description, isPublic } = request.body as {
      name?: string;
      description?: string;
      isPublic?: boolean;
    };
    if (!name) throw new AppError(400, "name is required");
    const result = await createDocumentSet({ name, description, userId: request.userId!, isPublic });
    return { success: true, id: result.id };
  });

  // GET / — list document sets
  fastify.get("/", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    return listDocumentSets(request.userId!);
  });

  // GET /:id — get document set with members
  fastify.get("/:id", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const set = await getDocumentSet(parseInt(id, 10), request.userId!);
    if (!set) throw new AppError(404, "Document set not found");
    return set;
  });

  // PATCH /:id — update document set
  fastify.patch("/:id", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; isPublic?: boolean };
    const updated = await updateDocumentSet(parseInt(id, 10), request.userId!, body);
    if (!updated) throw new AppError(404, "Document set not found or not owned by you");
    return { success: true };
  });

  // DELETE /:id — delete document set
  fastify.delete("/:id", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteDocumentSet(parseInt(id, 10), request.userId!);
    if (!deleted) throw new AppError(404, "Document set not found or not owned by you");
    return { success: true };
  });

  // POST /:id/documents — add document to set
  fastify.post("/:id/documents", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { documentId, documentTitle, documentSource } = request.body as {
      documentId?: string;
      documentTitle?: string;
      documentSource?: string;
    };
    if (!documentId) throw new AppError(400, "documentId is required");
    const result = await addDocumentToSet(parseInt(id, 10), { documentId, documentTitle, documentSource });
    return { success: true, id: result.id };
  });

  // DELETE /:id/documents/:docId — remove document from set
  fastify.delete("/:id/documents/:docId", { preHandler: [fastifyRequireAuth] }, async (request, _reply) => {
    const { id, docId } = request.params as { id: string; docId: string };
    await removeDocumentFromSet(parseInt(id, 10), docId);
    return { success: true };
  });
};

export default documentSetsPlugin;
