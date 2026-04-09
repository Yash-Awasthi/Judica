import client from "prom-client";

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
export const deliberationDuration = new client.Histogram({
  name: "aibyai_deliberation_duration_seconds",
  help: "Duration of council deliberations in seconds",
  labelNames: ["status"] as const,
  buckets: [0.5, 1, 2.5, 5, 10, 15, 30, 60],
});

// Provider call latency histogram
export const providerCallDuration = new client.Histogram({
  name: "aibyai_provider_call_duration_seconds",
  help: "Duration of AI provider API calls in seconds",
  labelNames: ["provider", "model"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
});

// Token usage counter
export const tokenUsageTotal = new client.Counter({
  name: "aibyai_tokens_total",
  help: "Total tokens consumed",
  labelNames: ["provider", "model", "type"] as const,
});

// Active SSE connections gauge
export const activeSSEConnections = new client.Gauge({
  name: "aibyai_active_sse_connections",
  help: "Number of active SSE streaming connections",
});

// Queue depth gauge
export const queueDepth = new client.Gauge({
  name: "aibyai_queue_depth",
  help: "Number of jobs in queue",
  labelNames: ["queue"] as const,
});

// Cache hit/miss counter
export const cacheOperations = new client.Counter({
  name: "aibyai_cache_operations_total",
  help: "Cache hit/miss counter",
  labelNames: ["operation"] as const,
});

// Database pool stats gauge
export const dbPoolStats = new client.Gauge({
  name: "aibyai_db_pool_connections",
  help: "Database connection pool statistics",
  labelNames: ["state"] as const,
});

export const registry = client.register;
