import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock ssrf - isPrivateIP checks IP addresses
vi.mock("../../src/lib/ssrf.js", () => ({
  isPrivateIP: vi.fn((ip: string) => {
    // Simulate private IP detection for common ranges
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("192.168.")) return true;
    if (ip.startsWith("172.16.")) return true;
    if (ip === "127.0.0.1") return true;
    if (ip === "::1") return true;
    return false;
  }),
}));

import {
  registerWebhook,
  removeWebhook,
  listWebhooks,
  getWebhook,
  clearWebhooks,
  getDeliveryLog,
  getFailedDeliveries,
  retryFailedDelivery,
  computeSignature,
  fireEvent,
  type WebhookEvent,
} from "../../src/services/webhooks.service.js";
import logger from "../../src/lib/logger.js";

describe("webhooks.service", () => {
  beforeEach(() => {
    clearWebhooks();
  });

  // ─── Registration ──────────────────────────────────────────────────────────

  describe("registerWebhook", () => {
    it("should register a webhook and return config with id and createdAt", () => {
      const wh = registerWebhook({
        url: "https://example.com/hook",
        events: ["deliberation.completed"],
        enabled: true,
        retries: 2,
      });

      expect(wh.id).toMatch(/^wh_/);
      expect(wh.createdAt).toBeDefined();
      expect(wh.url).toBe("https://example.com/hook");
      expect(wh.events).toEqual(["deliberation.completed"]);
      expect(wh.enabled).toBe(true);
      expect(wh.retries).toBe(2);
    });

    it("should generate unique IDs using crypto.randomUUID", () => {
      const wh1 = registerWebhook({ url: "https://a.com/1", events: ["verdict.reached"], enabled: true, retries: 0 });
      const wh2 = registerWebhook({ url: "https://a.com/2", events: ["verdict.reached"], enabled: true, retries: 0 });
      expect(wh1.id).not.toBe(wh2.id);
    });

    it("should store the webhook so getWebhook can retrieve it", () => {
      const wh = registerWebhook({ url: "https://example.com/hook", events: ["agent.error"], enabled: true, retries: 0 });
      const found = getWebhook(wh.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(wh.id);
    });

    it("should log registration", () => {
      registerWebhook({ url: "https://example.com/hook", events: ["task.completed"], enabled: true, retries: 0 });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ webhookId: expect.stringMatching(/^wh_/) }),
        "Webhook registered",
      );
    });

    it("should preserve the secret in config", () => {
      const wh = registerWebhook({
        url: "https://example.com/hook",
        events: ["verdict.reached"],
        enabled: true,
        retries: 0,
        secret: "my-secret-key",
      });
      expect(wh.secret).toBe("my-secret-key");
    });
  });

  // ─── URL Validation & SSRF ─────────────────────────────────────────────────

  describe("SSRF protection", () => {
    it("should reject invalid URLs", () => {
      expect(() =>
        registerWebhook({ url: "not-a-url", events: ["verdict.reached"], enabled: true, retries: 0 })
      ).toThrow("Invalid webhook URL");
    });

    it("should reject non-http/https protocols", () => {
      expect(() =>
        registerWebhook({ url: "ftp://example.com/hook", events: ["verdict.reached"], enabled: true, retries: 0 })
      ).toThrow("Webhook URL must use http or https protocol");
    });

    it("should reject localhost", () => {
      expect(() =>
        registerWebhook({ url: "http://localhost/hook", events: ["verdict.reached"], enabled: true, retries: 0 })
      ).toThrow("restricted hostname");
    });

    it("should reject .local hostnames", () => {
      expect(() =>
        registerWebhook({ url: "http://myservice.local/hook", events: ["verdict.reached"], enabled: true, retries: 0 })
      ).toThrow("restricted hostname");
    });

    it("should reject .internal hostnames", () => {
      expect(() =>
        registerWebhook({ url: "http://something.internal/hook", events: ["verdict.reached"], enabled: true, retries: 0 })
      ).toThrow("restricted hostname");
    });

    it("should reject metadata.google.internal", () => {
      expect(() =>
        registerWebhook({ url: "http://metadata.google.internal/compute", events: ["verdict.reached"], enabled: true, retries: 0 })
      ).toThrow("restricted hostname");
    });

    it("should reject private IPs via isPrivateIP", () => {
      expect(() =>
        registerWebhook({ url: "http://10.0.0.1/hook", events: ["verdict.reached"], enabled: true, retries: 0 })
      ).toThrow("restricted hostname");
    });

    it("should reject 127.0.0.1", () => {
      expect(() =>
        registerWebhook({ url: "http://127.0.0.1/hook", events: ["verdict.reached"], enabled: true, retries: 0 })
      ).toThrow("restricted hostname");
    });

    it("should allow public URLs", () => {
      const wh = registerWebhook({ url: "https://hooks.example.com/wh", events: ["verdict.reached"], enabled: true, retries: 0 });
      expect(wh.id).toMatch(/^wh_/);
    });

    it("should allow http protocol on public domains", () => {
      const wh = registerWebhook({ url: "http://public.example.com/wh", events: ["verdict.reached"], enabled: true, retries: 0 });
      expect(wh.url).toBe("http://public.example.com/wh");
    });
  });

  // ─── Remove / List / Get ───────────────────────────────────────────────────

  describe("removeWebhook", () => {
    it("should remove a webhook and return true", () => {
      const wh = registerWebhook({ url: "https://temp.com/hook", events: ["task.completed"], enabled: true, retries: 0 });
      expect(removeWebhook(wh.id)).toBe(true);
      expect(getWebhook(wh.id)).toBeUndefined();
    });

    it("should return false for non-existent ID", () => {
      expect(removeWebhook("wh_nonexistent")).toBe(false);
    });
  });

  describe("listWebhooks", () => {
    it("should return all registered webhooks", () => {
      registerWebhook({ url: "https://a.com/1", events: ["verdict.reached"], enabled: true, retries: 0 });
      registerWebhook({ url: "https://b.com/2", events: ["agent.error"], enabled: true, retries: 0 });
      expect(listWebhooks()).toHaveLength(2);
    });

    it("should return empty array when no webhooks registered", () => {
      expect(listWebhooks()).toEqual([]);
    });
  });

  describe("getWebhook", () => {
    it("should return undefined for unknown ID", () => {
      expect(getWebhook("wh_unknown")).toBeUndefined();
    });
  });

  // ─── clearWebhooks ────────────────────────────────────────────────────────

  describe("clearWebhooks", () => {
    it("should remove all webhooks and delivery logs", () => {
      registerWebhook({ url: "https://a.com/1", events: ["verdict.reached"], enabled: true, retries: 0 });
      clearWebhooks();
      expect(listWebhooks()).toHaveLength(0);
      expect(getDeliveryLog()).toHaveLength(0);
    });
  });

  // ─── computeSignature ─────────────────────────────────────────────────────

  describe("computeSignature", () => {
    it("should produce HMAC-SHA256 signature prefixed with sha256=", () => {
      const sig = computeSignature("payload", "secret");
      expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it("should produce consistent signatures for same inputs", () => {
      const sig1 = computeSignature("payload", "secret");
      const sig2 = computeSignature("payload", "secret");
      expect(sig1).toBe(sig2);
    });

    it("should produce different signatures for different payloads", () => {
      const sig1 = computeSignature("payload1", "secret");
      const sig2 = computeSignature("payload2", "secret");
      expect(sig1).not.toBe(sig2);
    });

    it("should produce different signatures for different secrets", () => {
      const sig1 = computeSignature("payload", "secret1");
      const sig2 = computeSignature("payload", "secret2");
      expect(sig1).not.toBe(sig2);
    });
  });

  // ─── fireEvent ─────────────────────────────────────────────────────────────

  describe("fireEvent", () => {
    it("should deliver to matching webhooks only", async () => {
      registerWebhook({ url: "https://a.com/hook", events: ["verdict.reached"], enabled: true, retries: 0 });
      registerWebhook({ url: "https://b.com/hook", events: ["agent.error"], enabled: true, retries: 0 });

      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      const deliveries = await fireEvent("verdict.reached", { topic: "test" }, mockFetch);

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].success).toBe(true);
      expect(deliveries[0].event).toBe("verdict.reached");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should deliver to multiple matching webhooks", async () => {
      registerWebhook({ url: "https://a.com/hook", events: ["verdict.reached"], enabled: true, retries: 0 });
      registerWebhook({ url: "https://b.com/hook", events: ["verdict.reached"], enabled: true, retries: 0 });

      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      const deliveries = await fireEvent("verdict.reached", {}, mockFetch);

      expect(deliveries).toHaveLength(2);
      expect(deliveries.every((d) => d.success)).toBe(true);
    });

    it("should skip disabled webhooks", async () => {
      registerWebhook({ url: "https://disabled.com/hook", events: ["verdict.reached"], enabled: false, retries: 0 });

      const mockFetch = vi.fn();
      const deliveries = await fireEvent("verdict.reached", {}, mockFetch);

      expect(deliveries).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should skip webhooks not subscribed to the event", async () => {
      registerWebhook({ url: "https://a.com/hook", events: ["agent.error"], enabled: true, retries: 0 });

      const mockFetch = vi.fn();
      const deliveries = await fireEvent("verdict.reached", {}, mockFetch);

      expect(deliveries).toHaveLength(0);
    });

    it("should retry on failure up to the configured retries count", async () => {
      registerWebhook({ url: "https://flaky.com/hook", events: ["task.completed"], enabled: true, retries: 2 });

      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ status: 200 });

      const deliveries = await fireEvent("task.completed", { taskId: "1" }, mockFetch);

      expect(deliveries[0].success).toBe(true);
      expect(deliveries[0].attempts).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should record failure after exhausting all retries", async () => {
      registerWebhook({ url: "https://down.com/hook", events: ["agent.error"], enabled: true, retries: 1 });

      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const deliveries = await fireEvent("agent.error", { error: "crash" }, mockFetch);

      expect(deliveries[0].success).toBe(false);
      expect(deliveries[0].error).toBe("ECONNREFUSED");
      expect(deliveries[0].attempts).toBe(2); // 1 initial + 1 retry
    });

    it("should treat non-2xx status codes as failures", async () => {
      registerWebhook({ url: "https://broken.com/hook", events: ["task.failed"], enabled: true, retries: 0 });

      const mockFetch = vi.fn().mockResolvedValue({ status: 500 });
      const deliveries = await fireEvent("task.failed", {}, mockFetch);

      expect(deliveries[0].success).toBe(false);
      expect(deliveries[0].statusCode).toBe(500);
      expect(deliveries[0].error).toBe("HTTP 500");
    });

    it("should include X-Webhook-Signature header when secret is set", async () => {
      registerWebhook({
        url: "https://signed.com/hook",
        events: ["verdict.reached"],
        enabled: true,
        retries: 0,
        secret: "my-secret",
      });

      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      await fireEvent("verdict.reached", { data: "test" }, mockFetch);

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers["X-Webhook-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it("should not include signature header when no secret is set", async () => {
      registerWebhook({
        url: "https://unsigned.com/hook",
        events: ["verdict.reached"],
        enabled: true,
        retries: 0,
      });

      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      await fireEvent("verdict.reached", {}, mockFetch);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["X-Webhook-Signature"]).toBeUndefined();
    });

    it("should send POST request with JSON content-type", async () => {
      registerWebhook({ url: "https://api.com/hook", events: ["task.completed"], enabled: true, retries: 0 });

      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      await fireEvent("task.completed", { result: "ok" }, mockFetch);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.com/hook");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(init.body);
      expect(body.event).toBe("task.completed");
      expect(body.data).toEqual({ result: "ok" });
      expect(body.timestamp).toBeDefined();
    });

    it("should log warning on failed delivery", async () => {
      registerWebhook({ url: "https://fail.com/hook", events: ["agent.error"], enabled: true, retries: 0 });

      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
      await fireEvent("agent.error", {}, mockFetch);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "network error" }),
        "Webhook delivery failed",
      );
    });
  });

  // ─── Delivery Log ──────────────────────────────────────────────────────────

  describe("getDeliveryLog", () => {
    it("should return recent delivery entries", async () => {
      registerWebhook({ url: "https://log.com/hook", events: ["verdict.reached"], enabled: true, retries: 0 });
      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      await fireEvent("verdict.reached", {}, mockFetch);

      const log = getDeliveryLog();
      expect(log).toHaveLength(1);
      expect(log[0].success).toBe(true);
    });

    it("should respect limit parameter", async () => {
      registerWebhook({ url: "https://log.com/hook", events: ["verdict.reached", "agent.error"], enabled: true, retries: 0 });
      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      await fireEvent("verdict.reached", {}, mockFetch);
      await fireEvent("verdict.reached", {}, mockFetch);
      await fireEvent("verdict.reached", {}, mockFetch);

      const log = getDeliveryLog(2);
      expect(log).toHaveLength(2);
    });
  });

  // ─── Failed Deliveries ────────────────────────────────────────────────────

  describe("getFailedDeliveries", () => {
    it("should return only failed deliveries", async () => {
      registerWebhook({ url: "https://mixed.com/hook", events: ["verdict.reached", "agent.error"], enabled: true, retries: 0 });
      const successFetch = vi.fn().mockResolvedValue({ status: 200 });
      const failFetch = vi.fn().mockRejectedValue(new Error("fail"));

      await fireEvent("verdict.reached", {}, successFetch);
      await fireEvent("agent.error", {}, failFetch);

      const failed = getFailedDeliveries();
      expect(failed).toHaveLength(1);
      expect(failed[0].success).toBe(false);
    });

    it("should return empty when all deliveries succeeded", async () => {
      registerWebhook({ url: "https://ok.com/hook", events: ["verdict.reached"], enabled: true, retries: 0 });
      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      await fireEvent("verdict.reached", {}, mockFetch);

      expect(getFailedDeliveries()).toHaveLength(0);
    });
  });

  // ─── retryFailedDelivery ──────────────────────────────────────────────────

  describe("retryFailedDelivery", () => {
    it("should return null for non-existent webhook", async () => {
      const result = await retryFailedDelivery("wh_nonexistent", "verdict.reached", {});
      expect(result).toBeNull();
    });

    it("should return null for disabled webhook", async () => {
      const wh = registerWebhook({ url: "https://retry.com/hook", events: ["verdict.reached"], enabled: false, retries: 0 });
      const result = await retryFailedDelivery(wh.id, "verdict.reached", {});
      expect(result).toBeNull();
    });
  });

  // ─── Delivery log bounding ─────────────────────────────────────────────────

  describe("delivery log bounding", () => {
    it("should keep delivery log bounded after many events", async () => {
      registerWebhook({ url: "https://spam.com/hook", events: ["verdict.reached"], enabled: true, retries: 0 });
      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });

      // Fire enough events to exceed the 1000-entry cap
      for (let i = 0; i < 50; i++) {
        await fireEvent("verdict.reached", { i }, mockFetch);
      }

      const log = getDeliveryLog(5000);
      expect(log.length).toBeLessThanOrEqual(1000);
    });
  });
});
