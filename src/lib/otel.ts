/**
 * OpenTelemetry SDK initialization
 * Supports OTLP export (Jaeger, Grafana Tempo, Honeycomb, etc.)
 * Enabled when OTEL_ENABLED=true
 */

import { context, trace, SpanStatusCode, type Span, type Attributes } from "@opentelemetry/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SpanFn<T> = (span: Span) => Promise<T> | T;

// ─── No-op implementations (used when OTEL_ENABLED != true) ──────────────────

const noopSpan: Span = {
  setAttribute: () => noopSpan,
  setAttributes: () => noopSpan,
  addEvent: () => noopSpan,
  setStatus: () => noopSpan,
  updateName: () => noopSpan,
  end: () => {},
  isRecording: () => false,
  recordException: () => {},
  spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
  addLink: () => noopSpan,
  addLinks: () => noopSpan,
};

async function noopStartSpan<T>(
  _name: string,
  fn: SpanFn<T>,
): Promise<T> {
  return fn(noopSpan);
}

async function noopWithSpan<T>(
  _name: string,
  _attrs: Attributes,
  fn: SpanFn<T>,
): Promise<T> {
  return fn(noopSpan);
}

// ─── Singleton tracer ─────────────────────────────────────────────────────────

let _initialized = false;

export let tracer = trace.getTracer("aibyai");

/**
 * Initialize the OpenTelemetry SDK.
 * Must be called before any other imports when OTEL_ENABLED=true.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initOtel(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  const enabled = process.env.OTEL_ENABLED === "true";
  if (!enabled) return;

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";

  // Dynamically import version from package.json (avoids top-level await issues)
  let serviceVersion = "0.0.0";
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    serviceVersion = pkg.version ?? "0.0.0";
  } catch {
    // Ignore — version is best-effort
  }

  try {
    const [
      { NodeSDK },
      { OTLPTraceExporter },
      { BatchSpanProcessor },
      { Resource },
      { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION },
    ] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/sdk-trace-base"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/semantic-conventions"),
    ]);

    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: "aibyai",
      [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
    });

    const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
    const spanProcessor = new BatchSpanProcessor(exporter);

    // Try to load auto-instrumentations — optional peer dependency
    let instrumentations: unknown[] = [];
    try {
      const { getNodeAutoInstrumentations } = await import(
        "@opentelemetry/auto-instrumentations-node"
      );
      instrumentations = getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false }, // Too noisy
      });
    } catch {
      // Auto-instrumentations not installed — use manual spans only
    }

    const sdk = new NodeSDK({
      resource,
      spanProcessor,
      instrumentations: instrumentations as unknown[],
    } as ConstructorParameters<typeof NodeSDK>[0]);

    sdk.start();

    // Update the module-level tracer to use the initialized provider
    tracer = trace.getTracer("aibyai", serviceVersion);

    // Graceful shutdown
    process.on("SIGTERM", () => {
      sdk.shutdown().catch(() => {});
    });
  } catch (err) {
    // OTEL packages not installed — silently fall back to no-op
    process.stderr.write(
      `[otel] Failed to initialize OpenTelemetry SDK: ${(err as Error).message}\n`,
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Start a named span and run fn inside it.
 * Always calls span.end(), even on error.
 * Falls back to no-op when OTEL is disabled.
 */
export async function startSpan<T>(name: string, fn: SpanFn<T>): Promise<T> {
  if (process.env.OTEL_ENABLED !== "true") return noopStartSpan(name, fn);

  const span = tracer.startSpan(name);
  const ctx = trace.setSpan(context.active(), span);

  return context.with(ctx, async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Start a named span with initial attributes and run fn inside it.
 * Falls back to no-op when OTEL is disabled.
 */
export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: SpanFn<T>,
): Promise<T> {
  if (process.env.OTEL_ENABLED !== "true") return noopWithSpan(name, attrs, fn);

  const span = tracer.startSpan(name, { attributes: attrs });
  const ctx = trace.setSpan(context.active(), span);

  return context.with(ctx, async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Get the active trace ID from the current context.
 * Returns undefined when OTEL is disabled or no span is active.
 */
export function getActiveTraceId(): string | undefined {
  if (process.env.OTEL_ENABLED !== "true") return undefined;
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const id = span.spanContext().traceId;
  return id || undefined;
}

/**
 * Get the active span ID from the current context.
 * Returns undefined when OTEL is disabled or no span is active.
 */
export function getActiveSpanId(): string | undefined {
  if (process.env.OTEL_ENABLED !== "true") return undefined;
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const id = span.spanContext().spanId;
  return id || undefined;
}
