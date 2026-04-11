import templatesRouter from "./routes/templates.js";
import piiRouter from "./routes/pii.js";
import { env } from "./config/env.js";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import path from "path";
import fs from "fs";
import logger from "./lib/logger.js";
import pinoHttp from "pino-http";
import { askLimiter, authLimiter } from "./middleware/rateLimit.js";
import { perUserLimiter } from "./middleware/limiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/auth.js";
import { requestId } from "./middleware/requestId.js";
import { cspNonce } from "./middleware/cspNonce.js";
import askRouter from "./routes/ask.js";
import historyRouter from "./routes/history.js";
import authRouter from "./routes/auth.js";
import providersRouter from "./routes/providers.js";
import councilRouter from "./routes/council.js";
import metricsRouter from "./routes/metrics.js";
import exportRouter from "./routes/export.js";
import ttsRouter from "./routes/tts.js";
import { startSweepers } from "./lib/sweeper.js";
import "./lib/tools/builtin.js";
import "./adapters/registry.js"; // Initialize adapter registry on startup
import { initSocket } from "./lib/socket.js";
import prisma, { pool } from "./lib/db.js";
import redis from "./lib/redis.js";
import { requestContext } from "./lib/context.js";
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
import { startWorkers, stopWorkers } from "./queue/workers.js";
import { startMemoryCrons } from "./lib/memoryCrons.js";

const app = express();

app.use(cspNonce);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (_req: any, res: any) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "http://localhost:3000", "ws://localhost:3000", "http://localhost:5173"],
    },
  },
}));

const trustProxyConfig = env.TRUST_PROXY;
if (trustProxyConfig === "true") {
  app.set("trust proxy", true);
} else if (trustProxyConfig === "false") {
  app.set("trust proxy", false);
} else if (trustProxyConfig && !isNaN(Number(trustProxyConfig))) {
  app.set("trust proxy", Number(trustProxyConfig));
} else if (trustProxyConfig) {
  app.set("trust proxy", trustProxyConfig);
} else {
  app.set("trust proxy", 1); // Default to 1 hop
}

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173"];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS Policy: Origin not allowed"));
  },
  credentials: true,
}));

app.use(compression());
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
app.use(express.json({ limit: "200kb" }));

app.use(requestId);

app.use((req: any, res, next) => {
  requestContext.run({ requestId: req.requestId || res.getHeader('x-request-id') as string }, () => {
    next();
  });
});

const publicPath = fs.existsSync(path.join(process.cwd(), "frontend/dist"))
  ? path.join(process.cwd(), "frontend/dist")
  : path.join(process.cwd(), "dist/public");

app.use(express.static(publicPath, { index: false }));

app.get("/", (req, res) => {
  const indexPath = path.join(publicPath, "index.html");
  try {
    let html = fs.readFileSync(indexPath, "utf8");
    const nonce = res.locals.cspNonce as string;

    html = html
      .replace(/<script\b([^>]*)>/g, (_match, attrs) => {
        if (attrs.includes('nonce=')) return _match;
        return `<script nonce="${nonce}"${attrs}>`;
      });

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch {
    res.status(500).send("Failed to load application index");
  }
});

app.use(perUserLimiter);

app.use("/api/auth",      authLimiter, authRouter);
app.use("/api/ask",       askLimiter,  askRouter);
app.use("/api/council",   askLimiter,  councilRouter);
app.use("/api/history",   historyRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/providers", providersRouter);
app.use("/api/metrics",   metricsRouter);
app.use("/api/export",    exportRouter);
app.use("/api/tts",       askLimiter, ttsRouter);
app.use("/api/pii",       requireAuth, piiRouter);
app.use("/api/custom-providers", requireAuth, customProvidersRouter);
app.use("/api/usage",     requireAuth, usageRouter);
app.use("/api/uploads",   requireAuth, uploadsRouter);
app.use("/api/kb",        requireAuth, kbRouter);
app.use("/api/voice",     askLimiter, voiceRouter);
app.use("/api/research",  requireAuth, researchRouter);
app.use("/api/artifacts", requireAuth, artifactsRouter);
app.use("/api/sandbox",   requireAuth, sandboxRouter);
app.use("/api/workflows", requireAuth, workflowsRouter);
app.use("/api/prompts",   requireAuth, promptsRouter);
app.use("/api/personas",  requireAuth, personasRouter);
app.use("/api/prompt-dna", requireAuth, promptDnaRouter);
app.use("/api/memory",    requireAuth, memoryRouter);
app.use("/api/admin",     requireAuth, adminRouter);
app.use("/api/share",     shareRouter);
app.use("/api/marketplace", requireAuth, marketplaceRouter);
app.use("/api/skills",      requireAuth, skillsRouter);
app.use("/api/traces",      requireAuth, tracesRouter);
app.use("/api/analytics",   requireAuth, analyticsRouter);
app.use("/api/repos",       requireAuth, reposRouter);
app.use("/api/queue",       requireAuth, queueRouter);

app.get("/health", async (req, res) => {
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
  res.status(healthy ? 200 : 503).json({
    status,
    uptime: process.uptime(),
    env: env.NODE_ENV,
    checks,
    providers,
    version: "1.0.0",
  });
});

app.use((req, res) => {
  if (req.originalUrl.startsWith("/api/")) {
    res.status(404).json({ error: `Not Found: ${req.originalUrl}` });
  } else {
    res.status(404).sendFile(path.join(publicPath, "404.html"), (err) => {
      if (err) res.status(404).json({ error: "Not Found" });
    });
  }
});

app.use(errorHandler);

const server = app.listen(Number(env.PORT), () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Council server started");
  startSweepers();
  startMemoryCrons();
  startWorkers();
});

const io = initSocket(server);

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutdown signal received, shutting down gracefully");

  const forceTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out after 5s, forcing exit");
    process.exit(1);
  }, 5000);
  forceTimer.unref();

  server.close(async () => {
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
  });
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