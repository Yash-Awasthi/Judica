import Fastify from "fastify";
import fastifyExpress from "@fastify/express";
import fastifyCors from "@fastify/cors";
import fastifyCompress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";

import { env } from "./config/env.js";
import logger from "./lib/logger.js";
import { pool } from "./lib/db.js";
import redis from "./lib/redis.js";
import { initSocket } from "./lib/socket.js";
import { startSweepers } from "./lib/sweeper.js";
import { startWorkers, stopWorkers } from "./queue/workers.js";
import { startMemoryCrons } from "./lib/memoryCrons.js";
import { registry } from "./lib/prometheusMetrics.js";

// Side-effect imports
import "./lib/tools/builtin.js";
import "./adapters/registry.js";

// Express middleware (still needed for swagger-ui and BullMQ Board compat layer)
import { perUserLimiter } from "./middleware/limiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/auth.js";
import { requestId } from "./middleware/requestId.js";
import { cspNonce } from "./middleware/cspNonce.js";
import { prometheusMiddleware } from "./middleware/prometheusMiddleware.js";

// Express (for swagger-ui compat layer only)
import express from "express";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./lib/swagger.js";
import { requestContext } from "./lib/context.js";

// Native Fastify plugins (all routes now converted)
import askPlugin from "./routes/ask.js";
import uploadsPlugin from "./routes/uploads.js";

// Native Fastify plugins
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
import { ingestionQueue, researchQueue, repoQueue, compactionQueue } from "./queue/queues.js";

// ─── Build the Fastify server ───────────────────────────────────────────────

const fastify = Fastify({
  logger: false, // We use our own Pino logger
  trustProxy: env.TRUST_PROXY === "true" ? true
    : env.TRUST_PROXY === "false" ? false
    : env.TRUST_PROXY && !isNaN(Number(env.TRUST_PROXY)) ? Number(env.TRUST_PROXY)
    : env.TRUST_PROXY || true,
  bodyLimit: 200 * 1024, // 200KB
});

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173"];

// ─── Native Fastify plugins (bypass Express overhead) ───────────────────────

await fastify.register(fastifyCors, {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS Policy: Origin not allowed"), false);
  },
  credentials: true,
});

await fastify.register(fastifyCompress);
await fastify.register(fastifyCookie);
await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: false, // CSP is handled separately via cspNonce middleware
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
});

// ─── Native Fastify routes (no Express overhead) ────────────────────────────

// Prometheus metrics endpoint
fastify.get("/metrics", async (_request, reply) => {
  try {
    reply.type(registry.contentType);
    return await registry.metrics();
  } catch {
    reply.code(500);
    return "";
  }
});

// Health check
fastify.get("/health", async (_request, reply) => {
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
    version: "1.0.0",
  };
});

// ─── Register all native Fastify route plugins ─────────────────────────────
// These MUST be registered BEFORE the @fastify/express compat layer.

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
await fastify.register(askPlugin,             { prefix: "/api/ask" });
await fastify.register(uploadsPlugin,         { prefix: "/api/uploads" });

// ─── Express compatibility layer ────────────────────────────────────────────
// Only needed for swagger-ui-express and BullMQ Board (dev only).

await fastify.register(fastifyExpress);

// Express middleware chain (for swagger and dev tools)
fastify.use(cspNonce);
fastify.use((pinoHttp as any)({ logger, autoLogging: { ignore: (req: any) => req.url === '/health' } }));
fastify.use(express.json({ limit: "200kb" }));
fastify.use(requestId);
fastify.use(prometheusMiddleware);

fastify.use((req: any, res: any, next: any) => {
  requestContext.run({ requestId: req.requestId || res.getHeader('x-request-id') as string }, () => {
    next();
  });
});

// Index route with CSP nonce injection
fastify.use("/", (req: any, res: any, next: any) => {
  if (req.method === "GET" && req.url === "/") {
    const indexPath = path.join(publicPath, "index.html");
    try {
      let html = fs.readFileSync(indexPath, "utf8");
      const nonce = res.locals.cspNonce as string;

      html = html
        .replace(/<script\b([^>]*)>/g, (_match: string, attrs: string) => {
          if (attrs.includes('nonce=')) return _match;
          return `<script nonce="${nonce}"${attrs}>`;
        });

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch {
      res.status(500).send("Failed to load application index");
    }
    return;
  }
  next();
});

// Swagger docs
fastify.use("/api/docs", swaggerUi.serve);
fastify.use("/api/docs", swaggerUi.setup(swaggerSpec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "AIBYAI API Documentation",
}));

// Per-user rate limiting (Express compat for swagger/docs)
fastify.use(perUserLimiter);

// BullMQ Board (dev only)
if (env.NODE_ENV === "development") {
  import("@bull-board/api").then(async ({ createBullBoard, BullMQAdapter }) => {
    const { ExpressAdapter } = await import("@bull-board/express");
    const serverAdapter = new ExpressAdapter();
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
    fastify.use("/admin/queues", requireAuth, serverAdapter.getRouter());
    logger.info("BullMQ Board mounted at /admin/queues");
  }).catch((err) => {
    logger.warn({ err }, "BullMQ Board not available (install @bull-board/api @bull-board/express as dev deps)");
  });
}

// Express error handler (must be last .use())
fastify.use(errorHandler);

// ─── Fastify 404 handler ────────────────────────────────────────────────────

fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith("/api/")) {
    reply.code(404).send({ error: `Not Found: ${request.url}` });
  } else {
    reply.code(404).sendFile("404.html");
  }
});

// ─── Start server ───────────────────────────────────────────────────────────

try {
  await fastify.listen({ port: Number(env.PORT), host: "0.0.0.0" });
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Council server started (Fastify)");

  startSweepers();
  startMemoryCrons();
  startWorkers();

  // Initialize WebSocket on the underlying Node.js HTTP server
  initSocket(fastify.server);
} catch (err) {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
}

// ─── Graceful shutdown ──────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutdown signal received, shutting down gracefully");

  const forceTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out after 5s, forcing exit");
    process.exit(1);
  }, 5000);
  forceTimer.unref();

  try {
    await fastify.close();
    logger.info("Fastify server closed");
  } catch (err) {
    logger.error({ err }, "Error closing Fastify server");
  }

  try {
    await stopWorkers();
    logger.info("BullMQ workers stopped");
  } catch (err) {
    logger.error({ err }, "Error stopping workers");
  }

  try {
    await pool.end();
    logger.info("Database pool closed");
  } catch (err) {
    logger.error({ err }, "Error closing database pool");
  }

  try {
    await redis.quit();
    logger.info("Redis connection closed");
  } catch (err) {
    logger.error({ err }, "Error closing Redis connection");
  }

  logger.info("Server closed");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection");
  process.exit(1);
});
