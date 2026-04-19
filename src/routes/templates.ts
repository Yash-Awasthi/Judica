import { FastifyPluginAsync } from "fastify";
import { TEMPLATES } from "../lib/templates.js";

const templatesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async (request, reply) => {
    return TEMPLATES;
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const template = TEMPLATES.find(t => t.id === request.params.id);
    if (!template) {
      reply.code(404);
      return { error: "Template not found" };
    }
    return template;
  });
};

export default templatesPlugin;
