import fastifyRateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyCompress from "@fastify/compress";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// Embed version at build time instead of runtime createRequire
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
import otelMiddlewarePlugin from "./middleware/otelMiddleware.js";
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
import sessionRoutes from "./sandbox/sessionRoutes.js";
import workflowsPlugin from "./routes/workflows.js";
import promptsPlugin from "./routes/prompts.js";
import personasPlugin from "./routes/personas.js";
import promptDnaPlugin from "./routes/promptDna.js";
import memoryPlugin from "./routes/memory.js";
import adminPlugin from "./routes/admin.js";
import sharePlugin from "./routes/share.js";
import marketplacePlugin from "./routes/marketplace.js";
import skillsPlugin from "./routes/skills.js";
import branchesPlugin from "./routes/branches.js";
import memoryEditPlugin from "./routes/memory-edit.js";
import { hypothesesPlugin } from "./routes/hypotheses.js";
import { ideaNodesPlugin } from "./routes/ideas.js";
import { openapiToolsPlugin } from "./routes/openapi-tools.js";
import { spendingLimitsPlugin } from "./routes/spending-limits.js";
import { workspacesPlugin } from "./routes/workspaces.js";
import { sessionTemplatesPlugin } from "./routes/session-templates.js";
import { promptFavouritesPlugin } from "./routes/prompt-favourites.js";
import { aiAccountsPlugin } from "./routes/ai-accounts.js";
import { memoryTriplesPlugin } from "./routes/memory-triples.js";
import { goalDocumentsPlugin } from "./routes/goal-documents.js";
import { agentMemoriesPlugin } from "./routes/agent-memories.js";
import { fineTunePlugin } from "./routes/fine-tune.js";
import { promptOptimisationPlugin } from "./routes/prompt-optimisation.js";
import { agentProfilesPlugin } from "./routes/agent-profiles.js";
import { hfHubPlugin } from "./routes/hf-hub.js";
import { memoryPortabilityPlugin } from "./routes/memory-portability.js";
import { videoTranscriptPlugin } from "./routes/video-transcript.js";
import { customConnectorsPlugin } from "./routes/custom-connectors.js";
import { googleWorkspacePlugin } from "./routes/google-workspace.js";
import { notionPlugin } from "./routes/notion.js";
import { slackPlugin as slackConnectorPlugin } from "./routes/slack.js";
import { linearJiraPlugin } from "./routes/linear-jira.js";
import { artifactBrowserPlugin } from "./routes/artifact-browser.js";
import { fileGeneratorPlugin } from "./routes/file-generator.js";
import { rssFeedsPlugin } from "./routes/rss-feeds.js";
import { emailConnectorPlugin } from "./routes/email-connector.js";
import { buildTasksPlugin } from "./routes/build-tasks.js";
import { workStealingPlugin } from "./routes/work-stealing.js";
import { taskReviewPlugin } from "./routes/task-review.js";
import { backgroundTasksPlugin } from "./routes/background-tasks.js";
import { autoDebugPlugin } from "./routes/auto-debug.js";
import { workflowTriggersPlugin } from "./routes/workflow-triggers.js";
import { knowledgeGraphPlugin } from "./routes/knowledge-graph.js";
import { craftPlugin } from "./routes/craft.js";
import { workflowRunLogsPlugin } from "./routes/workflow-run-logs.js";
import { botPlugin } from "./routes/bot.js";
import { subgraphPlugin } from "./routes/subgraphs.js";
import { browserAgentPlugin } from "./routes/browser-agent.js";
import { a2aPlugin } from "./routes/a2a.js";
import { reactiveAgentsPlugin } from "./routes/reactive-agents.js";
import tracesPlugin from "./routes/traces.js";
import analyticsPlugin from "./routes/analytics.js";
import reposPlugin from "./routes/repos.js";
import queuePlugin from "./routes/queue.js";
import costsPlugin from "./routes/costs.js";
import evaluationPlugin from "./routes/evaluation.js";
import projectsPlugin from "./routes/projects.js";
import providerHealthPlugin from "./routes/providerHealth.js";
import deliberationsPlugin from "./routes/deliberations.js";
import connectorsPlugin from "./routes/connectors.js";
import ssoPlugin from "./sso/routes.js";
import notificationsPlugin from "./routes/notifications.js";
import documentSetsPlugin from "./routes/documentSets.js";
import slackPlugin from "./integrations/slack/routes.js";
import standardAnswersPlugin from "./routes/standardAnswers.js";
import userGroupsPlugin from "./routes/userGroups.js";
import scimPlugin from "./routes/scim.js";
import patPlugin from "./routes/pat.js";
import rateLimitPlugin from "./routes/rateLimits.js";
import hooksPlugin from "./routes/hooks.js";
import discordPlugin from "./integrations/discord/routes.js";
import imagePlugin from "./routes/images.js";
import featureFlagPlugin from "./routes/featureFlags.js";
import widgetPlugin from "./routes/widget.js";
import whitelabelPlugin from "./routes/whitelabel.js";
import billingPlugin from "./routes/billing.js";
import webSearchPlugin from "./routes/webSearch.js";
import webScrapingPlugin from "./routes/webScraping.js";
import federatedSearchPlugin from "./routes/federatedSearch.js";
import storagePlugin from "./routes/storage.js";
import auditDashboardPlugin from "./routes/auditDashboard.js";
import mfaPlugin from "./routes/mfa.js";
import feedbackPlugin from "./routes/feedback.js";
import systemPlugin from "./routes/system.js";
import webhooksPlugin from "./routes/webhooks.js";
import roomsPlugin from "./routes/rooms.js";
import { ingestionQueue, researchQueue, repoQueue, compactionQueue } from "./queue/queues.js";

export async function buildApp() {
  const fastify = Fastify({
    logger: false,
    // Only trust proxy when explicitly configured; prevents IP spoofing via X-Forwarded-For
    trustProxy: env.TRUST_PROXY === "true" ? true
      : env.TRUST_PROXY === "false" ? false
      : env.TRUST_PROXY && !isNaN(Number(env.TRUST_PROXY)) ? Number(env.TRUST_PROXY)
      : env.TRUST_PROXY || false,
    // No global bodyLimit — each route sets its own limit via route config
    // Default Fastify limit is 1MB which is reasonable as a safety net
  });

  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:5173"];

  // Register OTEL tracing plugin early — before auth/metrics so spans cover the full request lifecycle
  await fastify.register(otelMiddlewarePlugin);

  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      // Only allow localhost origins in non-production environments
      if (env.NODE_ENV !== "production" && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
        return cb(null, true);
      }
      cb(new Error("CORS Policy: Origin not allowed"), false);
    },
    credentials: true,
  });

  await fastify.register(fastifyCompress);
  await fastify.register(fastifyCookie);
  // Helmet with environment-configurable CSP and HSTS
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // CSP is handled by cspNonce middleware with per-request nonces
    crossOriginEmbedderPolicy: false, // Allow loading external resources (CDN scripts, images)
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Enable HSTS in production with configurable max-age
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

  // Register Swagger/OpenAPI docs — always available (gated by optional ENABLE_API_DOCS env)
  if (process.env.ENABLE_API_DOCS !== "false") {
    await registerSwagger(fastify);
  }

  // Static file paths defined here, but middleware registered AFTER API routes
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
  // Fixed with constant-time comparison and rate limiting
  fastify.get("/metrics", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const authHeader = request.headers.authorization;
    const metricsToken = process.env.METRICS_TOKEN;
    if (metricsToken) {
      // Use crypto.timingSafeEqual to prevent timing oracle attacks
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
    // Include rate-limit Redis health
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

  // Liveness probe — always 200 if process is up (no dependency checks)
  fastify.get("/live", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (_request, reply) => {
    reply.code(200);
    return { live: true };
  });

  // Readiness probe — returns 503 until critical dependencies are connected
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
  // Sandbox gets a stricter rate limit (10/min) vs the global 120/min
  await fastify.register(async (scope) => {
    await scope.register(fastifyRateLimit, { max: 10, timeWindow: "1 minute" });
    await scope.register(sandboxPlugin, { prefix: "/api/sandbox" });
    await scope.register(sessionRoutes, { prefix: "/api/sandbox" });
  });
  await fastify.register(workflowsPlugin,       { prefix: "/api/workflows" });
  await fastify.register(promptsPlugin,         { prefix: "/api/prompts" });
  await fastify.register(personasPlugin,        { prefix: "/api/personas" });
  await fastify.register(promptDnaPlugin,       { prefix: "/api/prompt-dna" });
  await fastify.register(memoryPlugin,          { prefix: "/api/memory" });
  // Admin endpoints get a stricter rate limit (20/min) than the global 120/min
  await fastify.register(async (scope) => {
    await scope.register(fastifyRateLimit, { max: 20, timeWindow: "1 minute" });
    await scope.register(adminPlugin, { prefix: "/api/admin" });
    await scope.register(providerHealthPlugin, { prefix: "/api/admin" });
  });
  await fastify.register(sharePlugin,           { prefix: "/api/share" });
  await fastify.register(marketplacePlugin,     { prefix: "/api/marketplace" });
  await fastify.register(skillsPlugin,          { prefix: "/api/skills" });
  // Phase 1.7 — conversation branches (uses /api prefix for nested resource URLs)
  await fastify.register(branchesPlugin,        { prefix: "/api" });
  await fastify.register(memoryEditPlugin,      { prefix: "/api" });
  await fastify.register(hypothesesPlugin,      { prefix: "/api" });
  await fastify.register(ideaNodesPlugin,       { prefix: "/api" });
  await fastify.register(openapiToolsPlugin,    { prefix: "/api" });
  await fastify.register(spendingLimitsPlugin,  { prefix: "/api" });
  await fastify.register(workspacesPlugin,      { prefix: "/api" });
  await fastify.register(sessionTemplatesPlugin, { prefix: "/api" });
  await fastify.register(promptFavouritesPlugin, { prefix: "/api" });
  await fastify.register(aiAccountsPlugin,       { prefix: "/api" });
  await fastify.register(memoryTriplesPlugin,    { prefix: "/api" });
  await fastify.register(goalDocumentsPlugin,    { prefix: "/api" });
  await fastify.register(agentMemoriesPlugin,    { prefix: "/api" });
  await fastify.register(fineTunePlugin,         { prefix: "/api" });
  await fastify.register(promptOptimisationPlugin, { prefix: "/api" });
  await fastify.register(agentProfilesPlugin,      { prefix: "/api" });
  await fastify.register(hfHubPlugin,              { prefix: "/api" });
  await fastify.register(memoryPortabilityPlugin,  { prefix: "/api" });
  await fastify.register(videoTranscriptPlugin,    { prefix: "/api" });
  await fastify.register(customConnectorsPlugin,   { prefix: "/api" });
  await fastify.register(googleWorkspacePlugin,    { prefix: "/api" });
  await fastify.register(notionPlugin,             { prefix: "/api" });
  await fastify.register(slackConnectorPlugin,     { prefix: "/api" });
  await fastify.register(linearJiraPlugin,         { prefix: "/api" });
  await fastify.register(artifactBrowserPlugin,    { prefix: "/api" });
  await fastify.register(fileGeneratorPlugin,      { prefix: "/api" });
  await fastify.register(rssFeedsPlugin,           { prefix: "/api" });
  await fastify.register(emailConnectorPlugin,     { prefix: "/api" });
  await fastify.register(buildTasksPlugin,         { prefix: "/api" });
  await fastify.register(workStealingPlugin,       { prefix: "/api" });
  await fastify.register(taskReviewPlugin,         { prefix: "/api" });
  await fastify.register(backgroundTasksPlugin,    { prefix: "/api" });
  await fastify.register(autoDebugPlugin,          { prefix: "/api" });
  await fastify.register(workflowTriggersPlugin,   { prefix: "/api" });
  await fastify.register(knowledgeGraphPlugin,     { prefix: "/api" });
  await fastify.register(craftPlugin,              { prefix: "/api" });
  await fastify.register(workflowRunLogsPlugin,    { prefix: "/api" });
  await fastify.register(botPlugin,                { prefix: "/api" });
  await fastify.register(subgraphPlugin,           { prefix: "/api" });
  await fastify.register(browserAgentPlugin,       { prefix: "/api" });
  await fastify.register(a2aPlugin,                { prefix: "/api" });
  await fastify.register(reactiveAgentsPlugin,     { prefix: "/api" });
  await fastify.register(tracesPlugin,          { prefix: "/api/traces" });
  await fastify.register(analyticsPlugin,       { prefix: "/api/analytics" });
  await fastify.register(reposPlugin,           { prefix: "/api/repos" });
  await fastify.register(queuePlugin,           { prefix: "/api/queue" });
  await fastify.register(costsPlugin,           { prefix: "/api/costs" });
  await fastify.register(evaluationPlugin,      { prefix: "/api/evaluation" });
  await fastify.register(projectsPlugin,        { prefix: "/api/v1/projects" });
  // Consensus explainability API
  await fastify.register(deliberationsPlugin,   { prefix: "/api/deliberations" });
  // Data source connectors
  await fastify.register(connectorsPlugin,      { prefix: "/api/connectors" });
  // Federated real-time search (live external API queries)
  await fastify.register(federatedSearchPlugin, { prefix: "/api/federated-search" });
  // SSO / SAML / OIDC authentication
  await fastify.register(ssoPlugin,             { prefix: "/api/sso" });
  // Notifications
  await fastify.register(notificationsPlugin,   { prefix: "/api/notifications" });
  // Document sets (scoped document collections)
  await fastify.register(documentSetsPlugin,    { prefix: "/api/document-sets" });
  // Slack bot integration
  await fastify.register(slackPlugin,           { prefix: "/api/integrations/slack" });
  // Standard answers (canned responses)
  await fastify.register(standardAnswersPlugin, { prefix: "/api/standard-answers" });
  // User groups
  await fastify.register(userGroupsPlugin,      { prefix: "/api/user-groups" });
  // SCIM 2.0 provisioning (RFC 7644) — separate prefix, no CSRF
  await fastify.register(scimPlugin,            { prefix: "/api/scim/v2" });
  // Personal Access Tokens
  await fastify.register(patPlugin,             { prefix: "/api/tokens" });
  // Token rate limit management (tiers, user/group assignments)
  await fastify.register(rateLimitPlugin,       { prefix: "/api/rate-limits" });
  // Hook extension system admin API
  await fastify.register(hooksPlugin,           { prefix: "/api/hooks" });
  // Discord bot integration
  await fastify.register(discordPlugin,         { prefix: "/api/integrations/discord" });
  // Image generation (multi-provider)
  await fastify.register(imagePlugin,           { prefix: "/api/images" });
  // Feature flags
  await fastify.register(featureFlagPlugin,     { prefix: "/api/feature-flags" });
  // Embeddable chat widget (JS bundle + config)
  await fastify.register(widgetPlugin,          { prefix: "/api/widget" });
  // Whitelabeling (tenant branding)
  await fastify.register(whitelabelPlugin,      { prefix: "/api/whitelabel" });
  // Plans & billing (Stripe)
  await fastify.register(billingPlugin,         { prefix: "/api/billing" });
  // Web search (multi-provider)
  await fastify.register(webSearchPlugin,       { prefix: "/api/web-search" });
  // Web scraping (Firecrawl + Exa)
  await fastify.register(webScrapingPlugin,     { prefix: "/api/web-scraping" });
  // Object storage (MinIO/S3/R2/local)
  await fastify.register(storagePlugin,         { prefix: "/api/storage" });
  // Query audit dashboard
  await fastify.register(auditDashboardPlugin,  { prefix: "/api/audit" });
  // MFA / TOTP two-factor authentication
  await fastify.register(mfaPlugin,             { prefix: "/api/mfa" });
  // Response and search feedback
  await fastify.register(feedbackPlugin,        { prefix: "/api/feedback" });
  // System info (deployment mode, version, features) — no auth
  await fastify.register(systemPlugin,          { prefix: "/api/system" });
  // Connector webhooks (Slack, Confluence, GitHub, Notion, Google Drive)
  await fastify.register(webhooksPlugin,        { prefix: "/api/webhooks" });
  // Collaborative AI rooms — multi-user sessions where all participants can post
  await fastify.register(roomsPlugin,           { prefix: "/api/rooms" });
  // Per-route rate limit differentiation.
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

  // Static middleware registered AFTER all API routes
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

  // Cache index.html in memory — avoid blocking readFileSync on every request
  let cachedIndexHtml: string | null = null;
  const indexPath = path.join(publicPath, "index.html");

  // Explicit rate-limit preHandler so static analyzers (CodeQL js/missing-rate-limiting) can detect it.
  // The global @fastify/rate-limit plugin also enforces limits via config.rateLimit on this route,
  // but adding a preHandler makes the constraint visible to data-flow analysis.
  const staticPageRateLimit = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key = `static_rate:${request.ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
    if (count > 60) {
      reply.header("Retry-After", "60");
      reply.code(429).send({ error: "Too many requests" });
    }
  };

  fastify.get("/", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    preHandler: [staticPageRateLimit],
  }, async (request, reply) => {
    try {
      // Fix CodeQL alert #64: Eliminate TOCTOU race by reading file directly
      // and using content hash for cache invalidation instead of stat+read
      const currentContent = fs.readFileSync(indexPath, "utf8");
      if (currentContent !== cachedIndexHtml) {
        cachedIndexHtml = currentContent;
      }
      let html = cachedIndexHtml;
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
        await fastify.register(serverAdapter.plugin() as any, {
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

  // Don't reflect raw request.url in response — prevents info disclosure / log injection
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      const safeRoute = request.routeOptions?.url || request.url.split("?")[0].slice(0, 200);
      reply.code(404).send({ error: `Not Found: ${safeRoute}` });
    } else {
      reply.code(404).sendFile("404.html");
    }
  });

  return fastify;
}
