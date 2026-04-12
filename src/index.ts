import Fastify from "fastify";
import fastifyExpress from "@fastify/express";
import fastifyCors from "@fastify/cors";
import fastifyCompress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";

import { env } from "./config/env.js";
import logger from "./lib/logger.js";
import prisma, { pool } from "./lib/db.js";
import redis from "./lib/redis.js";
import { initSocket } from "./lib/socket.js";
import { startSweepers } from "./lib/sweeper.js";
import { startWorkers, stopWorkers } from "./queue/workers.js";
import { startMemoryCrons } from "./lib/memoryCrons.js";
import { registry } from "./lib/prometheusMetrics.js";

// Side-effect imports
import "./lib/tools/builtin.js";
import "./adapters/registry.js";

// Express middleware (run inside @fastify/express compat layer)
import { askLimiter, authLimiter } from "./middleware/rateLimit.js";
import { perUserLimiter } from "./middleware/limiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/auth.js";
import { requestId } from "./middleware/requestId.js";
import { cspNonce } from "./middleware/cspNonce.js";
import { prometheusMiddleware } from "./middleware/prometheusMiddleware.js";

// Express routers (work as-is via @fastify/express)
import express from "express";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./lib/swagger.js";
import { requestContext } from "./lib/context.js";

import askRouter from "./routes/ask.js";
import historyRouter from "./routes/history.js";
import authRouter from "./routes/auth.js";
import providersPlugin from "./routes/providers.js";
import councilRouter from "./routes/council.js";
import metricsPlugin from "./routes/metrics.js";
import exportPlugin from "./routes/export.js";
import ttsRouter from "./routes/tts.js";
import templatesPlugin from "./routes/templates.js";
import piiRouter from "./routes/pii.js";
import customProvidersRouter from "./routes/customProviders.js";
import usageRouter from "./routes/usage.js";
import uploadsRouter from "./routes/uploads.js";
import kbRouter from "./routes/kb.js";
import voiceRouter from "./routes/voice.js";
import researchRouter from "./routes/research.js";
import artifactsRouter from "./routes/artifacts.js";
import sandboxRouter from "./routes/sandbox.js";
import workflowsRouter from "./routes/workflows.js";
import promptsRouter from "./routes/prompts.js";
import personasRouter from "./routes/personas.js";
import promptDnaRouter from "./routes/promptDna.js";
import memoryRouter from "./routes/memory.js";
import adminRouter from "./routes/admin.js";
import shareRouter from "./routes/share.js";
import marketplaceRouter from "./routes/marketplace.js";
import skillsRouter from "./routes/skills.js";
import tracesRouter from "./routes/traces.js";
import analyticsRouter from "./routes/analytics.js";
import reposRouter from "./routes/repos.js";
import queueRouter from "./routes/queue.js";
import costsRouter from "./routes/costs.js";
import evaluationRouter from "./routes/evaluation.js";
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
    await prisma.$queryRawUnsafe("SELECT 1");
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

// ─── Express compatibility layer ────────────────────────────────────────────
// All existing Express routers and middleware run inside this layer.
// This lets us migrate incrementally — move routes to native Fastify one by one.

await fastify.register(templatesPlugin, { prefix: "/api/templates" });
await fastify.register(metricsPlugin, { prefix: "/api/metrics" });
await fastify.register(exportPlugin, { prefix: "/api/export" });
await fastify.register(providersPlugin, { prefix: "/api/providers" });

await fastify.register(fastifyExpress);

// Express middleware chain
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

// Per-user rate limiting
fastify.use(perUserLimiter);

// Mount all Express routers
fastify.use("/api/auth",      authLimiter, authRouter);
fastify.use("/api/ask",       askLimiter,  askRouter);
fastify.use("/api/council",   askLimiter,  councilRouter);
fastify.use("/api/history",   historyRouter);
fastify.use("/api/tts",       askLimiter, ttsRouter);
fastify.use("/api/pii",       requireAuth, piiRouter);
fastify.use("/api/custom-providers", requireAuth, customProvidersRouter);
fastify.use("/api/usage",     requireAuth, usageRouter);
fastify.use("/api/uploads",   requireAuth, uploadsRouter);
fastify.use("/api/kb",        requireAuth, kbRouter);
fastify.use("/api/voice",     askLimiter, voiceRouter);
fastify.use("/api/research",  requireAuth, researchRouter);
fastify.use("/api/artifacts", requireAuth, artifactsRouter);
fastify.use("/api/sandbox",   requireAuth, sandboxRouter);
fastify.use("/api/workflows", requireAuth, workflowsRouter);
fastify.use("/api/prompts",   requireAuth, promptsRouter);
fastify.use("/api/personas",  requireAuth, personasRouter);
fastify.use("/api/prompt-dna", requireAuth, promptDnaRouter);
fastify.use("/api/memory",    requireAuth, memoryRouter);
fastify.use("/api/admin",     requireAuth, adminRouter);
fastify.use("/api/share",     shareRouter);
fastify.use("/api/marketplace", requireAuth, marketplaceRouter);
fastify.use("/api/skills",      requireAuth, skillsRouter);
fastify.use("/api/traces",      requireAuth, tracesRouter);
fastify.use("/api/analytics",   requireAuth, analyticsRouter);
fastify.use("/api/repos",       requireAuth, reposRouter);
fastify.use("/api/queue",       requireAuth, queueRouter);
fastify.use("/api/costs",       requireAuth, costsRouter);
fastify.use("/api/evaluation",  requireAuth, evaluationRouter);

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
