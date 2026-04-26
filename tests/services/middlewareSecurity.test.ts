import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars-long",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

import {
  registerMiddleware,
  clearMiddleware,
  removeMiddleware,
  listMiddleware,
  setMiddlewareEnabled,
  runMiddleware,
  piiRedactionMiddleware,
  contentLengthGuard,
  auditLogMiddleware,
} from "../../src/services/middleware.service.js";

beforeEach(() => {
  clearMiddleware();
});

describe("middleware registry edge cases", () => {
  it("registerMiddleware defaults enabled=true when not specified", () => {
    registerMiddleware({ name: "hook", stage: "pre_routing", priority: 1, handler: async (ctx) => ctx });
    expect(listMiddleware()[0].enabled).toBe(true);
  });

  it("registerMiddleware respects explicit enabled=false", () => {
    registerMiddleware({ name: "off", stage: "pre_routing", priority: 1, handler: async (ctx) => ctx, enabled: false });
    expect(listMiddleware()[0].enabled).toBe(false);
  });

  it("re-registering a hook by the same name overwrites the previous entry", () => {
    registerMiddleware({ name: "dup", stage: "pre_routing", priority: 1, handler: async (ctx) => ctx });
    registerMiddleware({ name: "dup", stage: "post_routing", priority: 99, handler: async (ctx) => ctx });
    const list = listMiddleware();
    expect(list).toHaveLength(1);
    expect(list[0].stage).toBe("post_routing");
    expect(list[0].priority).toBe(99);
  });

  it("removeMiddleware returns false for a hook that does not exist", () => {
    expect(removeMiddleware("nonexistent")).toBe(false);
  });

  it("setMiddlewareEnabled returns false for a hook that does not exist", () => {
    expect(setMiddlewareEnabled("ghost", true)).toBe(false);
  });

  it("listMiddleware returns hooks sorted by priority (ascending)", () => {
    registerMiddleware({ name: "p50", stage: "pre_response", priority: 50, handler: async (ctx) => ctx });
    registerMiddleware({ name: "p5",  stage: "pre_response", priority: 5,  handler: async (ctx) => ctx });
    registerMiddleware({ name: "p20", stage: "pre_response", priority: 20, handler: async (ctx) => ctx });

    const names = listMiddleware().map((h) => h.name);
    expect(names).toEqual(["p5", "p20", "p50"]);
  });

  it("throws when the MAX_HOOKS (500) limit is reached for a new hook name", () => {
    // Register 500 unique hooks
    for (let i = 0; i < 500; i++) {
      registerMiddleware({ name: `hook_${i}`, stage: "pre_routing", priority: i, handler: async (ctx) => ctx });
    }
    // The 501st unique hook should throw
    expect(() =>
      registerMiddleware({ name: "overflow", stage: "pre_routing", priority: 999, handler: async (ctx) => ctx })
    ).toThrow(/limit reached/i);
  });

  it("does NOT throw when re-registering an existing hook name even at the limit", () => {
    for (let i = 0; i < 500; i++) {
      registerMiddleware({ name: `hook_${i}`, stage: "pre_routing", priority: i, handler: async (ctx) => ctx });
    }
    // Re-registering an existing name must not throw
    expect(() =>
      registerMiddleware({ name: "hook_0", stage: "pre_routing", priority: 999, handler: async (ctx) => ctx })
    ).not.toThrow();
  });
});

describe("runMiddleware pipeline edge cases", () => {
  it("injects the correct stage into the context", async () => {
    let capturedStage: string | undefined;
    registerMiddleware({
      name: "capture",
      stage: "pre_deliberation",
      priority: 1,
      handler: async (ctx) => { capturedStage = ctx.stage; return ctx; },
    });
    await runMiddleware("pre_deliberation", { data: {}, metadata: {} });
    expect(capturedStage).toBe("pre_deliberation");
  });

  it("continues with unmodified context after a hook throws (resilience)", async () => {
    registerMiddleware({
      name: "crasher",
      stage: "pre_response",
      priority: 1,
      handler: async () => { throw new Error("boom"); },
    });
    registerMiddleware({
      name: "writer",
      stage: "pre_response",
      priority: 2,
      handler: async (ctx) => ({ ...ctx, data: { ...ctx.data, written: true } }),
    });

    const result = await runMiddleware("pre_response", { data: {}, metadata: {} });
    // crasher should not prevent writer from running
    expect(result.data.written).toBe(true);
  });

  it("returns original context when no hooks match the stage", async () => {
    registerMiddleware({ name: "other", stage: "post_response", priority: 1, handler: async (ctx) => ctx });
    const result = await runMiddleware("pre_routing", { data: { key: "val" }, metadata: { m: 1 } });
    expect(result.data.key).toBe("val");
    expect(result.metadata.m).toBe(1);
  });

  it("only runs hooks whose stage matches, even when multiple stages are registered", async () => {
    const preHandler = vi.fn(async (ctx: typeof result) => ctx);
    const postHandler = vi.fn(async (ctx: typeof result) => ctx);

    let result: any;
    registerMiddleware({ name: "pre",  stage: "pre_routing",  priority: 1, handler: preHandler  });
    registerMiddleware({ name: "post", stage: "post_routing", priority: 1, handler: postHandler });

    result = await runMiddleware("pre_routing", { data: {}, metadata: {} });
    expect(preHandler).toHaveBeenCalledOnce();
    expect(postHandler).not.toHaveBeenCalled();
  });

  it("context passes through multiple hooks in correct order with cumulative mutations", async () => {
    registerMiddleware({
      name: "step1",
      stage: "pre_memory_store",
      priority: 10,
      handler: async (ctx) => ({ ...ctx, data: { ...ctx.data, step1: true } }),
    });
    registerMiddleware({
      name: "step2",
      stage: "pre_memory_store",
      priority: 20,
      handler: async (ctx) => ({ ...ctx, data: { ...ctx.data, step2: true } }),
    });

    const result = await runMiddleware("pre_memory_store", { data: {}, metadata: {} });
    expect(result.data.step1).toBe(true);
    expect(result.data.step2).toBe(true);
  });
});

describe("piiRedactionMiddleware edge cases", () => {
  it("redacts multiple email addresses in one pass", async () => {
    registerMiddleware(piiRedactionMiddleware());
    const result = await runMiddleware("pre_response", {
      data: { content: "Email alice@example.com and bob@corp.io for help" },
      metadata: {},
    });
    expect(result.data.content).not.toContain("alice@example.com");
    expect(result.data.content).not.toContain("bob@corp.io");
    const redacted = result.data.content as string;
    expect(redacted.match(/\[EMAIL_REDACTED\]/g)?.length).toBe(2);
  });

  it("redacts dash-separated phone (555-123-4567)", async () => {
    registerMiddleware(piiRedactionMiddleware());
    const result = await runMiddleware("pre_response", {
      data: { content: "Call 555-123-4567 now" },
      metadata: {},
    });
    expect(result.data.content).toContain("[PHONE_REDACTED]");
    expect(result.data.content).not.toContain("555-123-4567");
  });

  it("redacts dot-separated phone (555.123.4567)", async () => {
    registerMiddleware(piiRedactionMiddleware());
    const result = await runMiddleware("pre_response", {
      data: { content: "Reach us at 555.123.4567" },
      metadata: {},
    });
    expect(result.data.content).toContain("[PHONE_REDACTED]");
  });

  it("does not modify content when there is no PII", async () => {
    registerMiddleware(piiRedactionMiddleware());
    const original = "This text has no PII whatsoever";
    const result = await runMiddleware("pre_response", {
      data: { content: original },
      metadata: {},
    });
    expect(result.data.content).toBe(original);
  });

  it("does not modify non-string data.content", async () => {
    registerMiddleware(piiRedactionMiddleware());
    const result = await runMiddleware("pre_response", {
      data: { content: 42 },
      metadata: {},
    });
    expect(result.data.content).toBe(42);
  });

  it("redacts email in the middle of a sentence without breaking surrounding text", async () => {
    registerMiddleware(piiRedactionMiddleware());
    const result = await runMiddleware("pre_response", {
      data: { content: "Please contact user@domain.org for details." },
      metadata: {},
    });
    const content = result.data.content as string;
    expect(content).toContain("Please contact");
    expect(content).toContain("for details.");
    expect(content).toContain("[EMAIL_REDACTED]");
  });
});

describe("contentLengthGuard edge cases", () => {
  it("does not truncate content whose length exactly equals maxChars", async () => {
    const exact = "x".repeat(100);
    registerMiddleware(contentLengthGuard(100));
    const result = await runMiddleware("pre_response", {
      data: { content: exact },
      metadata: {},
    });
    expect(result.data.content).toBe(exact);
    expect(result.metadata.truncated).toBeUndefined();
  });

  it("truncates content that exceeds maxChars by one character", async () => {
    const overLimit = "x".repeat(101);
    registerMiddleware(contentLengthGuard(100));
    const result = await runMiddleware("pre_response", {
      data: { content: overLimit },
      metadata: {},
    });
    expect((result.data.content as string).startsWith("x".repeat(100))).toBe(true);
    expect(result.data.content).toContain("[Content truncated");
    expect(result.metadata.truncated).toBe(true);
  });

  it("does not modify non-string content", async () => {
    registerMiddleware(contentLengthGuard(10));
    const result = await runMiddleware("pre_response", {
      data: { content: [1, 2, 3] },
      metadata: {},
    });
    expect(result.data.content).toEqual([1, 2, 3]);
    expect(result.metadata.truncated).toBeUndefined();
  });

  it("does not modify content when data.content is absent", async () => {
    registerMiddleware(contentLengthGuard(10));
    const result = await runMiddleware("pre_response", {
      data: { other: "value" },
      metadata: {},
    });
    expect(result.data.other).toBe("value");
    expect(result.metadata.truncated).toBeUndefined();
  });

  it("uses 50000 as the default maxChars", async () => {
    const justUnder = "x".repeat(50000);
    registerMiddleware(contentLengthGuard()); // default
    const result = await runMiddleware("pre_response", {
      data: { content: justUnder },
      metadata: {},
    });
    // exactly 50000 chars → no truncation
    expect(result.metadata.truncated).toBeUndefined();
  });
});

describe("auditLogMiddleware", () => {
  it("calls the provided logFn with stage, userId, conversationId, timestamp, and dataKeys", async () => {
    const logFn = vi.fn();
    registerMiddleware(auditLogMiddleware(logFn));

    await runMiddleware("post_response", {
      data: { response: "text", model: "gpt-4o" },
      metadata: {},
      userId: "user-99",
      conversationId: "conv-42",
    });

    expect(logFn).toHaveBeenCalledOnce();
    const entry = logFn.mock.calls[0][0];
    expect(entry.stage).toBe("post_response");
    expect(entry.userId).toBe("user-99");
    expect(entry.conversationId).toBe("conv-42");
    expect(entry.timestamp).toBeDefined();
    expect(entry.dataKeys).toContain("response");
    expect(entry.dataKeys).toContain("model");
  });

  it("returns the context unchanged (audit is non-mutating)", async () => {
    registerMiddleware(auditLogMiddleware(vi.fn()));

    const result = await runMiddleware("post_response", {
      data: { content: "original" },
      metadata: { x: 1 },
    });

    expect(result.data.content).toBe("original");
    expect(result.metadata.x).toBe(1);
  });
});
