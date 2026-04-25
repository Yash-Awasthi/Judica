import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fastifyValidate,
  askSchema,
  authSchema,
  userSettingsSchema,
} from "../../src/middleware/validate.js";

function createRequest(body: any = {}): any {
  return { body };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      this._body = b;
      return this;
    }),
  };
  return reply;
}

// ================================================================
// fastifyValidate
// ================================================================
describe("fastifyValidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes valid body through", async () => {
    const schema = authSchema;
    const handler = fastifyValidate(schema);
    const request = createRequest({ username: "alice", password: "securepass1!" });
    const reply = createReply();
    await handler(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("returns 400 with details for invalid body", async () => {
    const schema = authSchema;
    const handler = fastifyValidate(schema);
    const request = createRequest({ username: "ab", password: "short" });
    const reply = createReply();
    await handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalled();
    const sent = reply.send.mock.calls[0][0];
    expect(sent.error).toBe("Validation failed");
    expect(sent.details).toBeInstanceOf(Array);
    expect(sent.details.length).toBeGreaterThan(0);
    expect(sent.details[0]).toHaveProperty("field");
    expect(sent.details[0]).toHaveProperty("message");
  });

  it("replaces request.body with parsed data", async () => {
    // askSchema has defaults (e.g., mode defaults to "manual", rounds to 1)
    const handler = fastifyValidate(askSchema);
    const request = createRequest({
      question: "What is AI?",
      members: [{ name: "gpt", model: "gpt-4", baseUrl: "https://api.openai.com/v1" }],
    });
    const reply = createReply();
    await handler(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
    // Defaults should be applied
    expect(request.body.mode).toBe("manual");
    expect(request.body.rounds).toBe(1);
    expect(request.body.anonymous).toBe(false);
    expect(request.body.deliberation_mode).toBe("standard");
  });
});

// ================================================================
// askSchema
// ================================================================
describe("askSchema", () => {
  it("valid minimal input passes", () => {
    const result = askSchema.safeParse({ question: "Hello?" });
    expect(result.success).toBe(true);
  });

  it("rejects empty question", () => {
    const result = askSchema.safeParse({ question: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("empty");
    }
  });

  it("rejects question > 4000 chars", () => {
    const result = askSchema.safeParse({ question: "a".repeat(4001) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("too long");
    }
  });

  it("accepts question exactly at 4000 chars", () => {
    const result = askSchema.safeParse({ question: "a".repeat(4000) });
    expect(result.success).toBe(true);
  });

  it("rejects members array > 10", () => {
    const members = Array.from({ length: 11 }, (_, i) => ({
      name: `member-${i}`,
      model: "gpt-4",
      baseUrl: "https://api.openai.com/v1",
    }));
    const result = askSchema.safeParse({ question: "test", members });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(" ");
      expect(msg).toContain("10");
    }
  });

  it("accepts members array of exactly 10", () => {
    const members = Array.from({ length: 10 }, (_, i) => ({
      name: `member-${i}`,
      model: "gpt-4",
      baseUrl: "https://api.openai.com/v1",
    }));
    const result = askSchema.safeParse({ question: "test", members });
    expect(result.success).toBe(true);
  });

  it("validates deliberation_mode enum", () => {
    const valid = askSchema.safeParse({ question: "test", deliberation_mode: "socratic" });
    expect(valid.success).toBe(true);

    const invalid = askSchema.safeParse({ question: "test", deliberation_mode: "invalid_mode" });
    expect(invalid.success).toBe(false);
  });

  it("applies default values for mode, rounds, anonymous, deliberation_mode", () => {
    const result = askSchema.safeParse({ question: "test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("manual");
      expect(result.data.rounds).toBe(1);
      expect(result.data.anonymous).toBe(false);
      expect(result.data.deliberation_mode).toBe("standard");
    }
  });
});

// ================================================================
// authSchema
// ================================================================
describe("authSchema", () => {
  it("valid auth passes", () => {
    const result = authSchema.safeParse({ username: "alice", password: "securepassword1" });
    expect(result.success).toBe(true);
  });

  it("rejects short username (<3)", () => {
    const result = authSchema.safeParse({ username: "ab", password: "securepassword1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("3");
    }
  });

  it("accepts username of exactly 3 characters", () => {
    const result = authSchema.safeParse({ username: "abc", password: "securepassword1" });
    expect(result.success).toBe(true);
  });

  it("rejects short password (<12)", () => {
    const result = authSchema.safeParse({ username: "alice", password: "short1!" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("12");
    }
  });

  it("rejects password without non-alpha character", () => {
    const result = authSchema.safeParse({ username: "alice", password: "abcdefghijkl" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(" ");
      expect(messages).toContain("non-alphabetic");
    }
  });

  it("accepts password with number as non-alpha character", () => {
    const result = authSchema.safeParse({ username: "alice", password: "abcdefghijk1" });
    expect(result.success).toBe(true);
  });

  it("accepts password with symbol as non-alpha character", () => {
    const result = authSchema.safeParse({ username: "alice", password: "abcdefghijk!" });
    expect(result.success).toBe(true);
  });

  it("rejects username with special characters", () => {
    const result = authSchema.safeParse({ username: "alice@!", password: "securepassword1" });
    expect(result.success).toBe(false);
  });
});

// ================================================================
// userSettingsSchema
// ================================================================
describe("userSettingsSchema", () => {
  it("valid settings pass (strict mode)", () => {
    const result = userSettingsSchema.safeParse({
      theme: "dark",
      language: "en",
      fontSize: 16,
      showTimestamps: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown keys (strict mode)", () => {
    const result = userSettingsSchema.safeParse({
      theme: "dark",
      unknownKey: "should-fail",
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty object", () => {
    const result = userSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("validates theme enum", () => {
    const valid = userSettingsSchema.safeParse({ theme: "system" });
    expect(valid.success).toBe(true);

    const invalid = userSettingsSchema.safeParse({ theme: "pink" });
    expect(invalid.success).toBe(false);
  });

  it("validates fontSize bounds", () => {
    const tooSmall = userSettingsSchema.safeParse({ fontSize: 5 });
    expect(tooSmall.success).toBe(false);

    const tooLarge = userSettingsSchema.safeParse({ fontSize: 50 });
    expect(tooLarge.success).toBe(false);

    const valid = userSettingsSchema.safeParse({ fontSize: 16 });
    expect(valid.success).toBe(true);
  });

  it("validates deliberationMode enum", () => {
    const valid = userSettingsSchema.safeParse({ deliberationMode: "socratic" });
    expect(valid.success).toBe(true);

    const invalid = userSettingsSchema.safeParse({ deliberationMode: "invalid" });
    expect(invalid.success).toBe(false);
  });
});
