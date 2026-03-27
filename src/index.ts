import templatesRouter from "./routes/templates.js";
import streamRouter from "./routes/stream.js";
import { env } from "./config/env.js";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import logger from "./lib/logger.js";
import { askLimiter, authLimiter } from "./middleware/rateLimit.js";
import { errorHandler } from "./middleware/errorHandler.js";
import askRouter from "./routes/ask.js";
import historyRouter from "./routes/history.js";
import authRouter from "./routes/auth.js";

const app = express();

// ── Security headers ─────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
}));

// ── Trust proxy (for rate limiter behind nginx/reverse proxy) ──
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "50kb" }));


const publicPath = process.env.NODE_ENV === "production"
  ? path.join(process.cwd(), "dist/public")
  : path.join(process.cwd(), "public");

app.use(express.static(publicPath));

// ── Request logging ──────────────────────────────────────
app.use((req, res, next) => {
  logger.debug({ method: req.method, path: req.path }, "Incoming request");
  next();
});

// ── Routes ───────────────────────────────────────────────
app.use("/auth",    authLimiter, authRouter);
app.use("/ask",     askLimiter,  askRouter);
app.use("/history", historyRouter);
app.use("/stream", askLimiter, streamRouter);
app.use("/templates", templatesRouter);

// ── Health check ─────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), env: env.NODE_ENV });
});

// ── Centralized error handler (must be last) ─────────────
app.use(errorHandler);

// ── Graceful shutdown ────────────────────────────────────
const server = app.listen(Number(env.PORT), () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Council server started");
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection");
  process.exit(1);
});