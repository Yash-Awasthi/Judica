import templatesRouter from "./routes/templates.js";
import { env } from "./config/env.js";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import path from "path";
import fs from "fs";
import logger from "./lib/logger.js";
import { askLimiter, authLimiter } from "./middleware/rateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
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
import { initSocket } from "./lib/socket.js";
import prisma, { pool } from "./lib/db.js";
import redis from "./lib/redis.js";

const app = express();

// ── CSP Nonce (must be before Helmet) ─────────────────────────────────────────
app.use(cspNonce);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (_req: any, res: any) => `'nonce-${res.locals.cspNonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
    },
  },
}));

// ── Trust proxy (for rate limiter behind nginx/reverse proxy) ─────────────────
const trustProxyConfig = env.TRUST_PROXY || 1;
app.set("trust proxy", !isNaN(Number(trustProxyConfig)) ? Number(trustProxyConfig) : trustProxyConfig);

// ── CORS — reads ALLOWED_ORIGINS from env, falls back to localhost:3000 ─────
const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173"];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS Policy: Origin not allowed"));
  },
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: "200kb" }));

// ── Request ID (attach before logging so it can be threaded through) ──────────
app.use(requestId);

const publicPath = fs.existsSync(path.join(process.cwd(), "frontend/dist"))
  ? path.join(process.cwd(), "frontend/dist")
  : path.join(process.cwd(), "dist/public");

// Serve static assets (JS, CSS, images) — but NOT index.html (served via nonce route below)
app.use(express.static(publicPath, { index: false }));

// Serve index.html with injected CSP nonce 
app.get("/", (req, res) => {
  const indexPath = path.join(publicPath, "index.html");
  try {
    let html = fs.readFileSync(indexPath, "utf8");
    const nonce = res.locals.cspNonce as string;
    
    // Inject nonce into script tags (legacy and Vite-generated)
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

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req: any, res, next) => {
  logger.debug({ method: req.method, path: req.path }, "Incoming request");
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",      authLimiter, authRouter);
app.use("/api/ask",       askLimiter,  askRouter);
app.use("/api/council",   askLimiter,  councilRouter);
app.use("/api/history",   historyRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/providers", providersRouter);
app.use("/api/metrics",   metricsRouter);
app.use("/api/export",    exportRouter);
app.use("/api/tts",       askLimiter, ttsRouter);

// ── Deep Health Check ─────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  // Check PostgreSQL
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    checks.database = "ok";
  } catch {
    checks.database = "unreachable";
    healthy = false;
  }

  // Check Redis
  try {
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "unreachable";
    healthy = false;
  }

  const status = healthy ? "ok" : "degraded";
  res.status(healthy ? 200 : 503).json({ status, uptime: process.uptime(), env: env.NODE_ENV, checks });
});

// ── 404 Handler for all routes ────────────────────────────────────────────────
app.use((req, res) => {
  if (req.originalUrl.startsWith("/api/")) {
    res.status(404).json({ error: `Not Found: ${req.originalUrl}` });
  } else {
    res.status(404).sendFile(path.join(publicPath, "404.html"), (err) => {
      if (err) res.status(404).json({ error: "Not Found" });
    });
  }
});

// ── Centralized error handler (must be last) ──────────────────────────────────
app.use(errorHandler);

const server = app.listen(Number(env.PORT), () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Council server started");
  startSweepers();
});

// Initialize WebSockets
const io = initSocket(server);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutdown signal received, shutting down gracefully");

  // Force exit after 5 seconds if cleanup hangs
  const forceTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out after 5s, forcing exit");
    process.exit(1);
  }, 5000);
  forceTimer.unref();

  server.close(async () => {
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