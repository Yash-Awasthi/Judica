import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

import {
  registerWebhook,
  removeWebhook,
  listWebhooks,
  getWebhook,
  clearWebhooks,
  getDeliveryLog,
  computeSignature,
  fireEvent,
} from "../../src/services/webhooks.service.js";

describe("webhooks.service", () => {
  beforeEach(() => {
    clearWebhooks();
  });

  describe("webhook registry", () => {
    it("should register a webhook", () => {
      const wh = registerWebhook({
        url: "https://example.com/hook",
        events: ["deliberation.completed"],
        enabled: true,
        retries: 2,
      });

      expect(wh.id).toMatch(/^wh_/);
      expect(getWebhook(wh.id)).toBeDefined();
    });

    it("should list all webhooks", () => {
      registerWebhook({ url: "http://a", events: ["verdict.reached"], enabled: true, retries: 0 });
      registerWebhook({ url: "http://b", events: ["agent.error"], enabled: true, retries: 0 });

      expect(listWebhooks()).toHaveLength(2);
    });

    it("should remove a webhook", () => {
      const wh = registerWebhook({ url: "http://temp", events: ["task.completed"], enabled: true, retries: 0 });

      expect(removeWebhook(wh.id)).toBe(true);
      expect(getWebhook(wh.id)).toBeUndefined();
    });
  });

  describe("computeSignature", () => {
    it("should produce consistent signatures", () => {
      const sig1 = computeSignature("payload", "secret");
      const sig2 = computeSignature("payload", "secret");
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^sha256=/);
    });

    it("should produce different signatures for different secrets", () => {
      const sig1 = computeSignature("payload", "secret1");
      const sig2 = computeSignature("payload", "secret2");
      expect(sig1).not.toBe(sig2);
    });
  });

  describe("fireEvent", () => {
    it("should deliver to matching webhooks", async () => {
      registerWebhook({ url: "http://a", events: ["verdict.reached"], enabled: true, retries: 0 });
      registerWebhook({ url: "http://b", events: ["agent.error"], enabled: true, retries: 0 });

      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });

      const deliveries = await fireEvent("verdict.reached", { topic: "test" }, mockFetch);

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].success).toBe(true);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("should skip disabled webhooks", async () => {
      registerWebhook({ url: "http://disabled", events: ["verdict.reached"], enabled: false, retries: 0 });

      const mockFetch = vi.fn();
      const deliveries = await fireEvent("verdict.reached", {}, mockFetch);

      expect(deliveries).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should retry on failure", async () => {
      registerWebhook({ url: "http://flaky", events: ["task.completed"], enabled: true, retries: 2 });

      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ status: 200 });

      const deliveries = await fireEvent("task.completed", { taskId: "1" }, mockFetch);

      expect(deliveries[0].success).toBe(true);
      expect(deliveries[0].attempts).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should record failed deliveries", async () => {
      registerWebhook({ url: "http://down", events: ["agent.error"], enabled: true, retries: 1 });

      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const deliveries = await fireEvent("agent.error", { error: "crash" }, mockFetch);

      expect(deliveries[0].success).toBe(false);
      expect(deliveries[0].error).toBe("ECONNREFUSED");
      expect(deliveries[0].attempts).toBe(2); // 1 + 1 retry

      const log = getDeliveryLog();
      expect(log).toHaveLength(1);
    });

    it("should include signature header when secret is set", async () => {
      registerWebhook({ url: "http://signed", events: ["verdict.reached"], enabled: true, retries: 0, secret: "my-secret" });

      const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
      await fireEvent("verdict.reached", { data: "test" }, mockFetch);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["X-Webhook-Signature"]).toMatch(/^sha256=/);
    });
  });
});
