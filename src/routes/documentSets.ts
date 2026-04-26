/**
 * Document Set Routes — REST API for managing document collections.
 *
 * Phase 3.8: Curated subsets of the knowledge base. Scope a specific agent or
 * conversation to only a defined set of documents.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  createDocumentSet,
  getDocumentSets,
  getDocumentSetById,
  updateDocumentSet,
  deleteDocumentSet,
  addDocumentsToSet,
  removeDocumentFromSet,
  getDocumentSetMembers,
  getDocumentSetsForConversation,
  linkDocumentSetToConversation,
  unlinkDocumentSetFromConversation,
} from "../services/documentSets.service.js";

const documentSetsPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── POST / — create document set ──────────────────────────────────────────
  fastify.post(
    "/",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "Create a new document set",
        tags: ["document-sets"],
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            isPublic: { type: "boolean" },
          },
        },
      },
    },
    async (request, _reply) => {
      const { name, description, isPublic } = request.body as {
        name?: string;
        description?: string;
        isPublic?: boolean;
      };
      if (!name) throw new AppError(400, "name is required");
      const result = await createDocumentSet({
        name,
        description,
        userId: request.userId!,
        isPublic,
      });
      return { success: true, id: result.id };
    },
  );

  // ─── GET / — list user's document sets ─────────────────────────────────────
  fastify.get(
    "/",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "List document sets for the authenticated user",
        tags: ["document-sets"],
      },
    },
    async (request, _reply) => {
      return getDocumentSets(request.userId!);
    },
  );

  // ─── GET /:id — get single document set with member count ─────────────────
  fastify.get(
    "/:id",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "Get a document set by ID with member count",
        tags: ["document-sets"],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, _reply) => {
      const { id } = request.params as { id: string };
      const set = await getDocumentSetById(id, request.userId!);
      if (!set) throw new AppError(404, "Document set not found");
      return set;
    },
  );

  // ─── PUT /:id — update document set ───────────────────────────────────────
  fastify.put(
    "/:id",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "Update a document set (name, description, visibility)",
        tags: ["document-sets"],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            isPublic: { type: "boolean" },
          },
        },
      },
    },
    async (request, _reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        description?: string;
        isPublic?: boolean;
      };
      const updated = await updateDocumentSet(id, request.userId!, body);
      if (!updated) throw new AppError(404, "Document set not found or not owned by you");
      return { success: true };
    },
  );

  // ─── DELETE /:id — delete document set ────────────────────────────────────
  fastify.delete(
    "/:id",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "Delete a document set",
        tags: ["document-sets"],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, _reply) => {
      const { id } = request.params as { id: string };
      const deleted = await deleteDocumentSet(id, request.userId!);
      if (!deleted) throw new AppError(404, "Document set not found or not owned by you");
      return { success: true };
    },
  );

  // ─── POST /:id/members — add documents to set ────────────────────────────
  fastify.post(
    "/:id/members",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "Add documents to a document set",
        tags: ["document-sets"],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["documentIds"],
          properties: {
            documentIds: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    async (request, _reply) => {
      const { id } = request.params as { id: string };
      const { documentIds } = request.body as { documentIds?: string[] };
      if (!documentIds || documentIds.length === 0) {
        throw new AppError(400, "documentIds array is required and must not be empty");
      }
      const result = await addDocumentsToSet(id, documentIds, request.userId!);
      return { success: true, addedCount: result.addedCount };
    },
  );

  // ─── DELETE /:id/members/:documentId — remove document from set ───────────
  fastify.delete(
    "/:id/members/:documentId",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "Remove a document from a document set",
        tags: ["document-sets"],
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
            documentId: { type: "string" },
          },
        },
      },
    },
    async (request, _reply) => {
      const { id, documentId } = request.params as {
        id: string;
        documentId: string;
      };
      await removeDocumentFromSet(id, documentId, request.userId!);
      return { success: true };
    },
  );

  // ─── GET /:id/members — list documents in set ────────────────────────────
  fastify.get(
    "/:id/members",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "List all documents in a document set",
        tags: ["document-sets"],
        params: {
          type: "object",
          properties: { id: { type: "string" } },
        },
      },
    },
    async (request, _reply) => {
      const { id } = request.params as { id: string };
      return getDocumentSetMembers(id, request.userId!);
    },
  );

  // ─── POST /:id/link/:conversationId — link set to conversation ───────────
  fastify.post(
    "/:id/link/:conversationId",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "Link a document set to a conversation for scoped search",
        tags: ["document-sets"],
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
            conversationId: { type: "string" },
          },
        },
      },
    },
    async (request, _reply) => {
      const { id, conversationId } = request.params as {
        id: string;
        conversationId: string;
      };
      await linkDocumentSetToConversation(conversationId, id);
      return { success: true };
    },
  );

  // ─── DELETE /:id/link/:conversationId — unlink set from conversation ──────
  fastify.delete(
    "/:id/link/:conversationId",
    {
      preHandler: [fastifyRequireAuth],
      schema: {
        description: "Unlink a document set from a conversation",
        tags: ["document-sets"],
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
            conversationId: { type: "string" },
          },
        },
      },
    },
    async (request, _reply) => {
      const { id, conversationId } = request.params as {
        id: string;
        conversationId: string;
      };
      await unlinkDocumentSetFromConversation(conversationId, id);
      return { success: true };
    },
  );
};

export default documentSetsPlugin;
