import { FastifyPluginAsync } from "fastify";
import { TEMPLATES } from "../lib/templates.js";

/**
 * @openapi
 * /api/templates:
 *   get:
 *     tags:
 *       - Templates
 *     summary: List all prompt templates
 *     responses:
 *       200:
 *         description: Array of templates
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   prompt:
 *                     type: string
 */

/**
 * @openapi
 * /api/templates/{id}:
 *   get:
 *     tags:
 *       - Templates
 *     summary: Get a template by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Template details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: Template not found
 */

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
