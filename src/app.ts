import fastifyRateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCompress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

import { env } from "./config/env.js";
import logger from "./lib/logger.js";
import { pool } from "./lib/db.js";
import redis from "./lib/redis.js";
import { registry } from "./lib/prometheusMetrics.js";

// Side-effect imports
import "./lib/tools/builtin.js";
import "./adapters/registry.js";

// Fastify-native middleware
import { fastifyRequestId } from "./middleware/requestId.js";
import { fastifyCspNonce } from "./middleware/cspNonce.js";
import { fastifyPrometheusOnRequest, fastifyPrometheusOnResponse } from "./middleware/prometheusMiddleware.js";
import { fastifyErrorHandler } from "./middleware/errorHandler.js";
import { getRateLimitRedis } from "./middleware/rateLimit.js";

import { swaggerSpec } from "./lib/swagger.js";

// Routes
import askPlugin from "./routes/ask.js";
import uploadsPlugin from "./routes/uploads.js";
import templatesPlugin from "./routes/templates.js";
import metricsPlugin from "./routes/metrics.js";
import exportPlugin from "./routes/export.js";
import providersPlugin from "./routes/providers.js";
import authPlugin from "./routes/auth.js";
import councilPlugin from "./routes/council.js";
import historyPlugin from "./routes/history.js";
import ttsPlugin from "./routes/tts.js";
import piiPlugin from "./routes/pii.js";
import customProvidersPlugin from "./routes/customProviders.js";
import usagePlugin from "./routes/usage.js";
import kbPlugin from "./routes/kb.js";
import voicePlugin from "./routes/voice.js";
import researchPlugin from "./routes/research.js";
import artifactsPlugin from "./routes/artifacts.js";
import sandboxPlugin from "./routes/sandbox.js";
import workflowsPlugin from "./routes/workflows.js";
import promptsPlugin from "./routes/prompts.js";
import personasPlugin from "./routes/personas.js";
import promptDnaPlugin from "./routes/promptDna.js";
import memoryPlugin from "./routes/memory.js";
import adminPlugin from "./routes/admin.js";
import sharePlugin from "./routes/share.js";
import marketplacePlugin from "./routes/marketplace.js";
import skillsPlugin from "./routes/skills.js";
import tracesPlugin from "./routes/traces.js";
import analyticsPlugin from "./routes/analytics.js";
import reposPlugin from "./routes/repos.js";
import queuePlugin from "./routes/queue.js";
import costsPlugin from "./routes/costs.js";
import evaluationPlugin from "./routes/evaluation.js";
import projectsPlugin from "./routes/projects.js";
import { ingestionQueue, researchQueue, repoQueue, compactionQueue } from "./queue/queues.js";

export async function buildApp() {
  const fastify = Fastify({
    logger: false,
    trustProxy: env.TRUST_PROXY === "true" ? true
      : env.TRUST_PROXY === "false" ? false
      : env.TRUST_PROXY && !isNaN(Number(env.TRUST_PROXY)) ? Number(env.TRUST_PROXY)
      : env.TRUST_PROXY || true,
    bodyLimit: 200 * 1024,
  });

  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:5173"];

  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin) || (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
        return cb(null, true);
      }
      cb(new Error("CORS Policy: Origin not allowed"), false);
    },
    credentials: true,
  });

  await fastify.register(fastifyCompress);
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // CSP is handled by cspNonce middleware with per-request nonces
    crossOriginEmbedderPolicy: false, // Allow loading external resources (CDN scripts, images)
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });

  const rateLimitRedis = getRateLimitRedis();
  await fastify.register(fastifyRateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => (request as any).userId?.toString() || request.ip,
    ...(rateLimitRedis ? { redis: rateLimitRedis } : {}),
  });

  const publicPath = fs.existsSync(path.join(process.cwd(), "frontend/dist"))
    ? path.join(process.cwd(), "frontend/dist")
    : path.join(process.cwd(), "dist/public");

  await fastify.register(fastifyStatic, {
    root: publicPath,
    prefix: "/",
    serve: true,
    index: false,
    wildcard: false,
    setHeaders: (res, filePath) => {
      // Vite hashed assets get aggressive caching
      if (/\/assets\//.test(filePath) && /\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg|jpg)/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  });

  fastify.addHook("onRequest", fastifyRequestId);
  fastify.addHook("onRequest", fastifyCspNonce);
  fastify.addHook("onRequest", fastifyPrometheusOnRequest);
  fastify.addHook("onResponse", fastifyPrometheusOnResponse);
  fastify.setErrorHandler(fastifyErrorHandler);

  // Health and Metrics
  fastify.get("/metrics", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const metricsToken = process.env.METRICS_TOKEN;
    if (metricsToken && authHeader === `Bearer ${metricsToken}`) {
    } else if (!metricsToken) {
      const ip = request.ip;
      if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
        reply.code(403);
        return "Forbidden";
      }
    } else {
      reply.code(401);
      return "Unauthorized";
    }
    try {
      reply.type(registry.contentType);
      return await registry.metrics();
    } catch {
      reply.code(500);
      return "";
    }
  });

  fastify.get("/health", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (_request, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;
    try {
      await pool.query("SELECT 1");
      checks.database = "ok";
    } catch {
      checks.database = "unreachable";
      healthy = false;
    }
    try {
      await redis.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "unreachable";
      healthy = false;
    }
    const status = healthy ? "ok" : "degraded";
    const { listAvailableProviders } = await import("./adapters/registry.js");
    const providers = listAvailableProviders();

    reply.code(healthy ? 200 : 503);
    return {
      status,
      uptime: process.uptime(),
      env: env.NODE_ENV,
      checks,
      providers,
      version: pkg.version,
    };
  });

  // Register Routes
  await fastify.register(templatesPlugin,       { prefix: "/api/templates" });
  await fastify.register(metricsPlugin,         { prefix: "/api/metrics" });
  await fastify.register(exportPlugin,          { prefix: "/api/export" });
  await fastify.register(providersPlugin,       { prefix: "/api/providers" });
  await fastify.register(authPlugin,            { prefix: "/api/auth" });
  await fastify.register(councilPlugin,         { prefix: "/api/council" });
  await fastify.register(historyPlugin,         { prefix: "/api/history" });
  await fastify.register(ttsPlugin,             { prefix: "/api/tts" });
  await fastify.register(piiPlugin,             { prefix: "/api/pii" });
  await fastify.register(customProvidersPlugin, { prefix: "/api/custom-providers" });
  await fastify.register(usagePlugin,           { prefix: "/api/usage" });
  await fastify.register(kbPlugin,              { prefix: "/api/kb" });
  await fastify.register(voicePlugin,           { prefix: "/api/voice" });
  await fastify.register(researchPlugin,        { prefix: "/api/research" });
  await fastify.register(artifactsPlugin,       { prefix: "/api/artifacts" });
  await fastify.register(sandboxPlugin,         { prefix: "/api/sandbox" });
  await fastify.register(workflowsPlugin,       { prefix: "/api/workflows" });
  await fastify.register(promptsPlugin,         { prefix: "/api/prompts" });
  await fastify.register(personasPlugin,        { prefix: "/api/personas" });
  await fastify.register(promptDnaPlugin,       { prefix: "/api/prompt-dna" });
  await fastify.register(memoryPlugin,          { prefix: "/api/memory" });
  await fastify.register(adminPlugin,           { prefix: "/api/admin" });
  await fastify.register(sharePlugin,           { prefix: "/api/share" });
  await fastify.register(marketplacePlugin,     { prefix: "/api/marketplace" });
  await fastify.register(skillsPlugin,          { prefix: "/api/skills" });
  await fastify.register(tracesPlugin,          { prefix: "/api/traces" });
  await fastify.register(analyticsPlugin,       { prefix: "/api/analytics" });
  await fastify.register(reposPlugin,           { prefix: "/api/repos" });
  await fastify.register(queuePlugin,           { prefix: "/api/queue" });
  await fastify.register(costsPlugin,           { prefix: "/api/costs" });
  await fastify.register(evaluationPlugin,      { prefix: "/api/evaluation" });
  await fastify.register(projectsPlugin,        { prefix: "/api/v1/projects" });
  await fastify.register(askPlugin,             { prefix: "/api/ask" });
  await fastify.register(uploadsPlugin,         { prefix: "/api/uploads" });

  fastify.get("/api/docs/swagger.json", async (_request, reply) => {
    reply.type("application/json").send(swaggerSpec);
  });

  fastify.get("/api/docs", async (_request, reply) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AIBYAI API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
  <style>.swagger-ui .topbar { display: none }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: "/api/docs/swagger.json", dom_id: "#swagger-ui" });</script>
</body>
</html>`;
    reply.type("text/html").send(html);
  });

  fastify.get("/", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const indexPath = path.join(publicPath, "index.html");
    try {
      let html = fs.readFileSync(indexPath, "utf8");
      const nonce = (request as any).cspNonce as string || "";
      html = html.split("<script").join(`<script nonce="${nonce}"`);
      html = html.split(`nonce="${nonce}" nonce="`).join(`nonce="`);
      reply.type("text/html").send(html);
    } catch {
      reply.code(500).send("Failed to load application index");
    }
  });

  if (env.NODE_ENV === "development") {
    import("@bull-board/api").then(async ({ createBullBoard, BullMQAdapter }) => {
      try {
        // @ts-expect-error — @bull-board/fastify is an optional dev dependency
        const { FastifyAdapter } = await import("@bull-board/fastify");
        const serverAdapter = new FastifyAdapter();
        serverAdapter.setBasePath("/admin/queues");
        createBullBoard({
          queues: [
            new BullMQAdapter(ingestionQueue),
            new BullMQAdapter(researchQueue),
            new BullMQAdapter(repoQueue),
            new BullMQAdapter(compactionQueue),
          ],
          serverAdapter,
        });
        await fastify.register(serverAdapter.registerPlugin(), {
          basePath: "/admin/queues",
          prefix: "/admin/queues",
        });
        logger.info("BullMQ Board mounted at /admin/queues (Fastify adapter)");
      } catch {
        logger.warn("BullMQ Board not available");
      }
    }).catch(() => {
      logger.warn("BullMQ Board not available");
    });
  }

  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply.code(404).send({ error: `Not Found: ${request.url}` });
    } else {
      reply.code(404).sendFile("404.html");
    }
  });

  return fastify;
}
