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
  registerMiddleware,
  removeMiddleware,
  listMiddleware,
  clearMiddleware,
  setMiddlewareEnabled,
  runMiddleware,
  piiRedactionMiddleware,
  auditLogMiddleware,
  contentLengthGuard,
} from "../../src/services/middleware.service.js";

describe("middleware.service", () => {
  beforeEach(() => {
    clearMiddleware();
  });

  describe("middleware registry", () => {
    it("should register and list middleware", () => {
      registerMiddleware({
        name: "test",
        stage: "pre_response",
        priority: 10,
        handler: async (ctx) => ctx,
      });

      const list = listMiddleware();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("test");
      expect(list[0].enabled).toBe(true);
    });

    it("should sort by priority", () => {
      registerMiddleware({ name: "low", stage: "pre_response", priority: 100, handler: async (ctx) => ctx });
      registerMiddleware({ name: "high", stage: "pre_response", priority: 1, handler: async (ctx) => ctx });
      registerMiddleware({ name: "mid", stage: "pre_response", priority: 50, handler: async (ctx) => ctx });

      const names = listMiddleware().map((m) => m.name);
      expect(names).toEqual(["high", "mid", "low"]);
    });

    it("should remove middleware", () => {
      registerMiddleware({ name: "temp", stage: "pre_response", priority: 10, handler: async (ctx) => ctx });

      expect(removeMiddleware("temp")).toBe(true);
      expect(listMiddleware()).toHaveLength(0);
    });

    it("should enable/disable middleware", () => {
      registerMiddleware({ name: "toggle", stage: "pre_response", priority: 10, handler: async (ctx) => ctx });

      setMiddlewareEnabled("toggle", false);
      expect(listMiddleware()[0].enabled).toBe(false);

      setMiddlewareEnabled("toggle", true);
      expect(listMiddleware()[0].enabled).toBe(true);
    });
  });

  describe("runMiddleware", () => {
    it("should run hooks in priority order", async () => {
      const order: string[] = [];

      registerMiddleware({
        name: "second",
        stage: "pre_response",
        priority: 20,
        handler: async (ctx) => { order.push("second"); return ctx; },
      });
      registerMiddleware({
        name: "first",
        stage: "pre_response",
        priority: 10,
        handler: async (ctx) => { order.push("first"); return ctx; },
      });

      await runMiddleware("pre_response", { data: {}, metadata: {} });

      expect(order).toEqual(["first", "second"]);
    });

    it("should pass context through the chain", async () => {
      registerMiddleware({
        name: "adder",
        stage: "pre_deliberation",
        priority: 10,
        handler: async (ctx) => ({
          ...ctx,
          data: { ...ctx.data, added: true },
        }),
      });

      const result = await runMiddleware("pre_deliberation", { data: { original: true }, metadata: {} });

      expect(result.data.original).toBe(true);
      expect(result.data.added).toBe(true);
    });

    it("should skip disabled hooks", async () => {
      const handler = vi.fn().mockImplementation(async (ctx) => ctx);
      registerMiddleware({ name: "disabled", stage: "pre_response", priority: 10, handler, enabled: false });

      await runMiddleware("pre_response", { data: {}, metadata: {} });

      expect(handler).not.toHaveBeenCalled();
    });

    it("should only run hooks for the matching stage", async () => {
      const preHandler = vi.fn().mockImplementation(async (ctx) => ctx);
      const postHandler = vi.fn().mockImplementation(async (ctx) => ctx);

      registerMiddleware({ name: "pre", stage: "pre_response", priority: 10, handler: preHandler });
      registerMiddleware({ name: "post", stage: "post_response", priority: 10, handler: postHandler });

      await runMiddleware("pre_response", { data: {}, metadata: {} });

      expect(preHandler).toHaveBeenCalledOnce();
      expect(postHandler).not.toHaveBeenCalled();
    });

    it("should continue on hook failure", async () => {
      registerMiddleware({
        name: "failing",
        stage: "pre_response",
        priority: 10,
        handler: async () => { throw new Error("crash"); },
      });
      registerMiddleware({
        name: "surviving",
        stage: "pre_response",
        priority: 20,
        handler: async (ctx) => ({ ...ctx, data: { ...ctx.data, survived: true } }),
      });

      const result = await runMiddleware("pre_response", { data: {}, metadata: {} });
      expect(result.data.survived).toBe(true);
    });
  });

  describe("built-in middleware", () => {
    it("piiRedactionMiddleware should redact emails", async () => {
      registerMiddleware(piiRedactionMiddleware());

      const result = await runMiddleware("pre_response", {
        data: { content: "Contact user@example.com for details" },
        metadata: {},
      });

      expect(result.data.content).toContain("[EMAIL_REDACTED]");
      expect(result.data.content).not.toContain("user@example.com");
    });

    it("piiRedactionMiddleware should redact phone numbers", async () => {
      registerMiddleware(piiRedactionMiddleware());

      const result = await runMiddleware("pre_response", {
        data: { content: "Call 555-123-4567 for support" },
        metadata: {},
      });

      expect(result.data.content).toContain("[PHONE_REDACTED]");
    });

    it("auditLogMiddleware should log activity", async () => {
      const logFn = vi.fn();
      registerMiddleware(auditLogMiddleware(logFn));

      await runMiddleware("post_response", {
        data: { key: "value" },
        metadata: {},
        userId: "user123",
      });

      expect(logFn).toHaveBeenCalledOnce();
      expect(logFn).toHaveBeenCalledWith(expect.objectContaining({
        stage: "post_response",
        userId: "user123",
      }));
    });

    it("contentLengthGuard should truncate long content", async () => {
      registerMiddleware(contentLengthGuard(100));

      const longContent = "x".repeat(200);
      const result = await runMiddleware("pre_response", {
        data: { content: longContent },
        metadata: {},
      });

      expect((result.data.content as string).length).toBeLessThan(200);
      expect(result.data.content).toContain("[Content truncated");
      expect(result.metadata.truncated).toBe(true);
    });

    it("contentLengthGuard should pass short content through", async () => {
      registerMiddleware(contentLengthGuard(100));

      const result = await runMiddleware("pre_response", {
        data: { content: "short" },
        metadata: {},
      });

      expect(result.data.content).toBe("short");
    });
  });
});
