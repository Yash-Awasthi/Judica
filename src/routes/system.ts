import type { FastifyPluginAsync } from "fastify";
import { DEPLOYMENT_MODE, features } from "../lib/deploymentMode.js";

// Embed version at build time
const APP_VERSION = process.env.APP_VERSION || "0.0.0-dev";

const systemPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/system/info
   * Returns deployment mode, version, and feature availability flags.
   * No authentication required — safe to expose as it contains no secrets.
   */
  fastify.get("/info", async (_request, reply) => {
    reply.code(200);
    return {
      mode: DEPLOYMENT_MODE,
      version: APP_VERSION,
      features,
    };
  });
};

export default systemPlugin;
