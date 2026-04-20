import client from "prom-client";

// P9-62: Use the default registry from prom-client.
export const registry = client.register;

// Clear the registry to prevent double-registration errors in tests/hot-reload
registry.clear();

// Collect default Node.js metrics (GC, event loop, memory, etc.)
client.collectDefaultMetrics({ prefix: "aibyai_" });

// HTTP request duration histogram
export const httpRequestDuration = new client.Histogram({
  name: "aibyai_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],

});

// HTTP request counter
export const httpRequestTotal = new client.Counter({
  name: "aibyai_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,

});

// Deliberation (ask) duration histogram
// P9-61: Extended buckets for long-running deliberations (multi-agent can take minutes)
export const deliberationDuration = new client.Histogram({
  name: "aibyai_deliberation_duration_seconds",
  help: "Duration of council deliberations in seconds",
  labelNames: ["status"] as const,
  buckets: [0.5, 1, 2.5, 5, 10, 15, 30, 60, 120, 300],

});

// Provider call latency histogram
export const providerCallDuration = new client.Histogram({
  name: "aibyai_provider_call_duration_seconds",
  help: "Duration of AI provider API calls in seconds",
  labelNames: ["provider", "model"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],

});

// Token usage counter
export const tokenUsageTotal = new client.Counter({
  name: "aibyai_tokens_total",
  help: "Total tokens consumed",
  labelNames: ["provider", "model", "type"] as const,

});

// P9-63: Active SSE connections gauge — updated on connection open/close events.
// Stale if server crashes without cleanup; consider periodic reconciliation.
export const activeSSEConnections = new client.Gauge({
  name: "aibyai_active_sse_connections",
  help: "Number of active SSE streaming connections",

});

// P9-63: Queue depth gauge — must be updated by a periodic collector (e.g., every 10s)
// to avoid stale values. Consider using a collect() callback for on-demand refresh.
export const queueDepth = new client.Gauge({
  name: "aibyai_queue_depth",
  help: "Number of jobs in queue",
  labelNames: ["queue"] as const,

});

// P9-64: Cache hit/miss counter with `backend` label to distinguish Redis vs Postgres
export const cacheOperations = new client.Counter({
  name: "aibyai_cache_operations_total",
  help: "Cache hit/miss counter",
  labelNames: ["operation", "backend"] as const,

});

// P0-43: Anonymous request tracking counter
export const anonymousRequests = new client.Counter({
  name: "aibyai_anonymous_requests_total",
  help: "Total anonymous (unauthenticated) requests",
  labelNames: ["mode", "status"] as const,

});

// Database pool stats gauge
export const dbPoolStats = new client.Gauge({
  name: "aibyai_db_pool_connections",
  help: "Database connection pool statistics",
  labelNames: ["state"] as const,

});

// P4-12: Per-tenant metrics for SLO tracking.
// Use userId or orgId as the tenant label to enable per-tenant dashboards.
export const tenantRequestDuration = new client.Histogram({
  name: "aibyai_tenant_request_duration_seconds",
  help: "Request duration per tenant (for per-tenant SLO tracking)",
  labelNames: ["tenant_id", "route"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],

});

export const tenantTokenUsage = new client.Counter({
  name: "aibyai_tenant_tokens_total",
  help: "Token usage per tenant",
  labelNames: ["tenant_id", "provider"] as const,

});

export const tenantRequestTotal = new client.Counter({
  name: "aibyai_tenant_requests_total",
  help: "Total requests per tenant",
  labelNames: ["tenant_id", "status_code"] as const,

});

// P4-13: Router exhaustion counter — tracks when all providers are unavailable.
export const routerExhaustedTotal = new client.Counter({
  name: "aibyai_router_exhausted_total",
  help: "Number of times all providers were exhausted (no available provider)",
  labelNames: ["chain"] as const,

});

// P4-16: Worker autoscaling signals — expose BullMQ job-lag metrics for HPA.
// P9-61: Extended buckets to capture workflow durations up to 5 minutes.
export const queueJobLag = new client.Histogram({
  name: "aibyai_queue_job_lag_seconds",
  help: "Time jobs spend waiting in queue before being picked up (seconds)",
  labelNames: ["queue"] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],

});

export const queueWaitingJobs = new client.Gauge({
  name: "aibyai_queue_waiting_jobs",
  help: "Number of jobs waiting to be processed (for autoscaling decisions)",
  labelNames: ["queue"] as const,

});

export const queueActiveJobs = new client.Gauge({
  name: "aibyai_queue_active_jobs",
  help: "Number of jobs currently being processed",
  labelNames: ["queue"] as const,

});
