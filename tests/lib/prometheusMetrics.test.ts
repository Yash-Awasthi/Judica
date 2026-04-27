import { describe, it, expect, vi } from "vitest";

// Mock prom-client
vi.mock("prom-client", () => {
  return {
    default: {
      collectDefaultMetrics: vi.fn(),
      Histogram: vi.fn().mockImplementation(function(this: any) {
        this.observe = vi.fn();
        this.labels = vi.fn().mockReturnThis();
      }),
      Counter: vi.fn().mockImplementation(function(this: any) {
        this.inc = vi.fn();
        this.labels = vi.fn().mockReturnThis();
      }),
      Gauge: vi.fn().mockImplementation(function(this: any) {
        this.set = vi.fn();
        this.inc = vi.fn();
        this.dec = vi.fn();
        this.labels = vi.fn().mockReturnThis();
      }),
      register: {
        metrics: vi.fn().mockResolvedValue("mock metrics data"),
        getSingleMetric: vi.fn(),
        clear: vi.fn(),
      }
    }
  };
});

describe("Prometheus Metrics Utility", () => {
  it("should initialize metrics", async () => {
    const metrics = await import("../../src/lib/prometheusMetrics.js");
    const { default: client } = await import("prom-client");

    expect(client.collectDefaultMetrics).toHaveBeenCalledWith({ prefix: "judica_" });
    expect(metrics.httpRequestDuration).toBeDefined();
    expect(metrics.httpRequestTotal).toBeDefined();
    expect(metrics.deliberationDuration).toBeDefined();
    expect(metrics.tokenUsageTotal).toBeDefined();
    expect(metrics.activeSSEConnections).toBeDefined();
    expect(metrics.queueDepth).toBeDefined();
    expect(metrics.cacheOperations).toBeDefined();
    expect(metrics.dbPoolStats).toBeDefined();
    expect(metrics.registry).toBeDefined();
  });
});
