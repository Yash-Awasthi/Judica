import client from "prom-client";

// Use the default registry from prom-client.
export const registry = client.register;

// Clear the registry to prevent double-registration errors in tests/hot-reload
registry.clear();

// Collect default Node.js metrics (GC, event loop, memory, etc.)
client.collectDefaultMetrics({ prefix: "judica_" });

// HTTP request duration histogram
export const httpRequestDuration = new client.Histogram({
  name: "judica_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],

});

// HTTP request counter
export const httpRequestTotal = new client.Counter({
  name: "judica_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,

});

// Deliberation (ask) duration histogram
// Extended buckets for long-running deliberations (multi-agent can take minutes)
export const deliberationDuration = new client.Histogram({
  name: "judica_deliberation_duration_seconds",
  help: "Duration of council deliberations in seconds",
  labelNames: ["status"] as const,
  buckets: [0.5, 1, 2.5, 5, 10, 15, 30, 60, 120, 300],

});

// Provider call latency histogram
export const providerCallDuration = new client.Histogram({
  name: "judica_provider_call_duration_seconds",
  help: "Duration of AI provider API calls in seconds",
  labelNames: ["provider", "model"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],

});

// Token usage counter
export const tokenUsageTotal = new client.Counter({
  name: "judica_tokens_total",
  help: "Total tokens consumed",
  labelNames: ["provider", "model", "type"] as const,

});

// Active SSE connections gauge — updated on connection open/close events.
// Stale if server crashes without cleanup; consider periodic reconciliation.
export const activeSSEConnections = new client.Gauge({
  name: "judica_active_sse_connections",
  help: "Number of active SSE streaming connections",

});

// Queue depth gauge — must be updated by a periodic collector (e.g., every 10s)
// to avoid stale values. Consider using a collect() callback for on-demand refresh.
export const queueDepth = new client.Gauge({
  name: "judica_queue_depth",
  help: "Number of jobs in queue",
  labelNames: ["queue"] as const,

});

// Cache hit/miss counter with `backend` label to distinguish Redis vs Postgres
export const cacheOperations = new client.Counter({
  name: "judica_cache_operations_total",
  help: "Cache hit/miss counter",
  labelNames: ["operation", "backend"] as const,

});

// Anonymous request tracking counter
export const anonymousRequests = new client.Counter({
  name: "judica_anonymous_requests_total",
  help: "Total anonymous (unauthenticated) requests",
  labelNames: ["mode", "status"] as const,

});

// Database pool stats gauge
export const dbPoolStats = new client.Gauge({
  name: "judica_db_pool_connections",
  help: "Database connection pool statistics",
  labelNames: ["state"] as const,

});

// CARDINALITY WARNING — tenant_id labels create O(tenants) time series.
// At >1000 tenants, this WILL degrade Prometheus performance.
// Mitigation options:
//   1. Use recording rules to pre-aggregate by tenant bucket (small/medium/large)
//   2. Use exemplars instead of labels for per-tenant drill-down
//   3. Cap tenant_id labels to top-N tenants by volume, bucket rest as "other"
// Monitor judica_tenant_* series count via `count({__name__=~"judica_tenant_.*"})`.

// Per-tenant metrics for SLO tracking.
// Use userId or orgId as the tenant label to enable per-tenant dashboards.
export const tenantRequestDuration = new client.Histogram({
  name: "judica_tenant_request_duration_seconds",
  help: "Request duration per tenant (for per-tenant SLO tracking)",
  labelNames: ["tenant_id", "route"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],

});

export const tenantTokenUsage = new client.Counter({
  name: "judica_tenant_tokens_total",
  help: "Token usage per tenant",
  labelNames: ["tenant_id", "provider"] as const,

});

export const tenantRequestTotal = new client.Counter({
  name: "judica_tenant_requests_total",
  help: "Total requests per tenant",
  labelNames: ["tenant_id", "status_code"] as const,

});

// Router exhaustion counter — tracks when all providers are unavailable.
export const routerExhaustedTotal = new client.Counter({
  name: "judica_router_exhausted_total",
  help: "Number of times all providers were exhausted (no available provider)",
  labelNames: ["chain"] as const,

});

// Worker autoscaling signals — expose BullMQ job-lag metrics for HPA.
// Extended buckets to capture workflow durations up to 5 minutes.
export const queueJobLag = new client.Histogram({
  name: "judica_queue_job_lag_seconds",
  help: "Time jobs spend waiting in queue before being picked up (seconds)",
  labelNames: ["queue"] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],

});

export const queueWaitingJobs = new client.Gauge({
  name: "judica_queue_waiting_jobs",
  help: "Number of jobs waiting to be processed (for autoscaling decisions)",
  labelNames: ["queue"] as const,

});

export const queueActiveJobs = new client.Gauge({
  name: "judica_queue_active_jobs",
  help: "Number of jobs currently being processed",
  labelNames: ["queue"] as const,

});
