import type { FastifyPluginAsync } from "fastify";
import { TEMPLATES } from "../lib/templates.js";

const templatesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (_request, _reply) => {
    return TEMPLATES;
  });

  fastify.get<{ Params: { id: string } }>("/:id", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9_-]+$" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const template = TEMPLATES.find(t => t.id === request.params.id);
    if (!template) {
      return reply.code(404).send({ error: "Template not found" });
    }
    return template;
  });
};

export default templatesPlugin;
