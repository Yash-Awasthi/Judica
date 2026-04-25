/**
 * Image Generation Routes
 *
 * Endpoints:
 *   POST   /generate      — Generate image from prompt
 *   GET    /providers      — List available providers
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { generateImage, getAvailableImageProviders } from "../services/imageGeneration.service.js";
import type { ImageGenerationRequest } from "../services/imageGeneration.service.js";

const imagePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastifyRequireAuth);

  fastify.get("/providers", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => {
    return { providers: getAvailableImageProviders() };
  });

  fastify.post("/generate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = request.body as Partial<ImageGenerationRequest>;

    if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      reply.code(400);
      return { error: "prompt is required" };
    }

    if (body.prompt.length > 4000) {
      reply.code(400);
      return { error: "prompt must be 4000 characters or fewer" };
    }

    const validSizes = ["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"];
    if (body.size && !validSizes.includes(body.size)) {
      reply.code(400);
      return { error: `Invalid size. Valid options: ${validSizes.join(", ")}` };
    }

    try {
      const result = await generateImage({
        prompt: body.prompt.trim(),
        provider: body.provider,
        model: body.model,
        size: body.size,
        quality: body.quality,
        style: body.style,
        n: body.n ?? 1,
      });
      return result;
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });
};

export default imagePlugin;
