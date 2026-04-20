import fastifyRateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCompress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// P8-08: Embed version at build time instead of runtime createRequire
const APP_VERSION = process.env.APP_VERSION || "0.0.0-dev";

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
import { fastifyCsrfProtection } from "./middleware/csrf.js";
import { fastifyPrometheusOnRequest, fastifyPrometheusOnResponse } from "./middleware/prometheusMiddleware.js";
import { fastifyErrorHandler } from "./middleware/errorHandler.js";
import { getRateLimitRedis, isRateLimitRedisHealthy } from "./middleware/rateLimit.js";

import { registerSwagger } from "./lib/swagger.js";

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
import providerHealthPlugin from "./routes/providerHealth.js";
import deliberationsPlugin from "./routes/deliberations.js";
import { ingestionQueue, researchQueue, repoQueue, compactionQueue } from "./queue/queues.js";

export async function buildApp() {
  const fastify = Fastify({
    logger: false,
    // P0-11: Only trust proxy when explicitly configured; prevents IP spoofing via X-Forwarded-For
    trustProxy: env.TRUST_PROXY === "true" ? true
      : env.TRUST_PROXY === "false" ? false
      : env.TRUST_PROXY && !isNaN(Number(env.TRUST_PROXY)) ? Number(env.TRUST_PROXY)
      : env.TRUST_PROXY || false,
    // P8-03: No global bodyLimit — each route sets its own limit via route config
    // Default Fastify limit is 1MB which is reasonable as a safety net
  });

  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:5173"];

  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      // P8-02: Only allow localhost origins in non-production environments
      if (env.NODE_ENV !== "production" && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
        return cb(null, true);
      }
      cb(new Error("CORS Policy: Origin not allowed"), false);
    },
    credentials: true,
  });

  await fastify.register(fastifyCompress);
  await fastify.register(fastifyCookie);
  // P4-02: Helmet with environment-configurable CSP and HSTS
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // CSP is handled by cspNonce middleware with per-request nonces
    crossOriginEmbedderPolicy: false, // Allow loading external resources (CDN scripts, images)
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // P4-02: Enable HSTS in production with configurable max-age
    hsts: env.NODE_ENV === "production"
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    // Security headers that are safe to enable everywhere
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xFrameOptions: { action: "sameorigin" as const },
    xPermittedCrossDomainPolicies: { permittedPolicies: "none" as const },
    xXssProtection: true,
  });

  const rateLimitRedis = getRateLimitRedis();
  await fastify.register(fastifyRateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => (request as unknown as { userId?: number }).userId?.toString() || request.ip,
    ...(rateLimitRedis ? { redis: rateLimitRedis } : {}),
  });

  // P8-05: Only register Swagger UI in non-production environments
  if (env.NODE_ENV !== "production") {
    await registerSwagger(fastify);
  }

  // P8-04: Static file paths defined here, but middleware registered AFTER API routes
  //         to prevent HTML 404s for API errors.
  const publicPath = fs.existsSync(path.join(process.cwd(), "frontend/dist"))
    ? path.join(process.cwd(), "frontend/dist")
    : path.join(process.cwd(), "dist/public");

  fastify.addHook("onRequest", fastifyRequestId);
  fastify.addHook("onRequest", fastifyCspNonce);
  fastify.addHook("onRequest", fastifyCsrfProtection);
  fastify.addHook("onRequest", fastifyPrometheusOnRequest);
  fastify.addHook("onResponse", fastifyPrometheusOnResponse);
  fastify.setErrorHandler(fastifyErrorHandler);

  // Health and Metrics
  // P8-01: Fixed with constant-time comparison and rate limiting
  fastify.get("/metrics", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const authHeader = request.headers.authorization;
    const metricsToken = process.env.METRICS_TOKEN;
    if (metricsToken) {
      // P8-01: Use crypto.timingSafeEqual to prevent timing oracle attacks
      const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const expected = metricsToken;
      const providedBuf = Buffer.from(provided.padEnd(expected.length));
      const expectedBuf = Buffer.from(expected.padEnd(provided.length));
      if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
        reply.code(401);
        return "Unauthorized";
      }
    } else {
      // No token configured — only allow from loopback (trusted proxy already validated by Fastify)
      const ip = request.ip;
      if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
        reply.code(403);
        return "Forbidden";
      }
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
    // P1-20: Include rate-limit Redis health
    checks.rateLimitRedis = isRateLimitRedisHealthy() ? "ok" : "fallback_inmemory";

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
      version: APP_VERSION,
    };
  });

  // P8-07: Liveness probe — always 200 if process is up (no dependency checks)
  fastify.get("/live", async (_request, reply) => {
    reply.code(200);
    return { live: true };
  });

  // P1-20: Readiness probe — returns 503 until critical dependencies are connected
  fastify.get("/ready", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      await redis.ping();
      reply.code(200);
      return { ready: true };
    } catch {
      reply.code(503);
      return { ready: false };
    }
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
  // P4-05: Sandbox gets a stricter rate limit (10/min) vs the global 120/min
  await fastify.register(async (scope) => {
    await scope.register(fastifyRateLimit, { max: 10, timeWindow: "1 minute" });
    await scope.register(sandboxPlugin, { prefix: "/api/sandbox" });
  });
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
  // P4-26: Provider health probes endpoint (mounted under admin prefix)
  await fastify.register(providerHealthPlugin,  { prefix: "/api/admin" });
  // P4-27: Consensus explainability API
  await fastify.register(deliberationsPlugin,   { prefix: "/api/deliberations" });
  // P4-24: Per-route rate limit differentiation.
  // /ask is the most expensive route (triggers full deliberation); cap at 30/min.
  // Uploads are I/O-heavy; cap at 20/min.
  // Other routes inherit the global 120/min limit.
  // Sandbox already has 10/min (P4-05), admin has 60/min (admin plugin internal).
  await fastify.register(async (scope) => {
    await scope.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });
    await scope.register(askPlugin, { prefix: "/api/ask" });
  });
  await fastify.register(async (scope) => {
    await scope.register(fastifyRateLimit, { max: 20, timeWindow: "1 minute" });
    await scope.register(uploadsPlugin, { prefix: "/api/uploads" });
  });

  // P8-04: Static middleware registered AFTER all API routes
  await fastify.register(fastifyStatic, {
    root: publicPath,
    prefix: "/",
    serve: true,
    index: false,
    wildcard: false,
    setHeaders: (res, filePath) => {
      if (/\/assets\//.test(filePath) && /\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg|jpg)/.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  });

  fastify.get("/", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const indexPath = path.join(publicPath, "index.html");
    try {
      let html = fs.readFileSync(indexPath, "utf8");
      const nonce = (request as unknown as { cspNonce?: string }).cspNonce || "";
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
