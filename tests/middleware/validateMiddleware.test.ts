import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  fastifyValidate,
  providerSchema,
  askSchema,
  renameConversationSchema,
  archetypeSchema,
  forkSchema,
  authSchema,
  configSchema,
} from "../../src/middleware/validate.js";

// ── Fastify fastifyValidate() hook ───────────────────────────────────
describe("fastifyValidate() — Fastify preHandler", () => {
  const schema = z.object({
    title: z.string().min(1),
  });
  const hook = fastifyValidate(schema);

  function makeMocks(body: unknown) {
    const request = { body } as any;
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as any;
    return { request, reply };
  }

  it("should set parsed body and not reply on valid input", async () => {
    const { request, reply } = makeMocks({ title: "Hello" });
    await hook(request, reply);
    expect(request.body).toEqual({ title: "Hello" });
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("should reply 400 on invalid input", async () => {
    const { request, reply } = makeMocks({ title: "" });
    await hook(request, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Validation failed",
        details: expect.any(Array),
      })
    );
  });

  it("should reply 400 when body is null", async () => {
    const { request, reply } = makeMocks(null);
    await hook(request, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
  });
});

// ── Schema exports ───────────────────────────────────────────────────
describe("providerSchema", () => {
  it("should accept a minimal valid provider", () => {
    const result = providerSchema.safeParse({
      name: "test-provider",
      model: "gpt-4",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("api"); // default
    }
  });

  it("should reject empty name", () => {
    const result = providerSchema.safeParse({ name: "", model: "gpt-4" });
    expect(result.success).toBe(false);
  });

  it("should reject empty model", () => {
    const result = providerSchema.safeParse({ name: "p", model: "" });
    expect(result.success).toBe(false);
  });

  it("should accept optional fields", () => {
    const result = providerSchema.safeParse({
      name: "my-provider",
      model: "gpt-4",
      apiKey: "sk-xxx",
      baseUrl: "https://api.example.com",
      systemPrompt: "You are helpful.",
      maxTokens: 1024,
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid baseUrl", () => {
    const result = providerSchema.safeParse({
      name: "p",
      model: "m",
      baseUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("should accept empty string for apiKey", () => {
    const result = providerSchema.safeParse({
      name: "p",
      model: "m",
      apiKey: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("askSchema", () => {
  it("should accept a minimal ask", () => {
    const result = askSchema.safeParse({ question: "What is 2+2?" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("manual"); // default
      expect(result.data.rounds).toBe(1); // default
      expect(result.data.anonymous).toBe(false); // default
    }
  });

  it("should reject empty question", () => {
    const result = askSchema.safeParse({ question: "" });
    expect(result.success).toBe(false);
  });

  it("should reject question over 4000 chars", () => {
    const result = askSchema.safeParse({ question: "x".repeat(4001) });
    expect(result.success).toBe(false);
  });

  it("should accept valid summon values", () => {
    for (const s of ["business", "technical", "personal", "creative", "ethical", "strategy", "debate", "research", "default"]) {
      const result = askSchema.safeParse({ question: "hi", summon: s });
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid summon", () => {
    const result = askSchema.safeParse({ question: "hi", summon: "invalid" });
    expect(result.success).toBe(false);
  });

  it("should accept valid conversationId", () => {
    const result = askSchema.safeParse({
      question: "hi",
      conversationId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid conversationId", () => {
    const result = askSchema.safeParse({
      question: "hi",
      conversationId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("renameConversationSchema", () => {
  it("should accept a valid title", () => {
    const result = renameConversationSchema.safeParse({ title: "My Chat" });
    expect(result.success).toBe(true);
  });

  it("should reject empty title", () => {
    const result = renameConversationSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("should reject title over 100 chars", () => {
    const result = renameConversationSchema.safeParse({ title: "x".repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe("archetypeSchema", () => {
  it("should accept a valid archetype", () => {
    const result = archetypeSchema.safeParse({
      id: "my-arch-01",
      name: "My Archetype",
      systemPrompt: "You are a thoughtful analyst.",
    });
    expect(result.success).toBe(true);
  });

  it("should reject id with spaces", () => {
    const result = archetypeSchema.safeParse({
      id: "has spaces",
      name: "X",
      systemPrompt: "You are a test archetype.",
    });
    expect(result.success).toBe(false);
  });

  it("should reject systemPrompt shorter than 10 chars", () => {
    const result = archetypeSchema.safeParse({
      id: "x",
      name: "X",
      systemPrompt: "short",
    });
    expect(result.success).toBe(false);
  });
});

describe("forkSchema", () => {
  it("should accept a valid toChatId", () => {
    expect(forkSchema.safeParse({ toChatId: 5 }).success).toBe(true);
  });

  it("should reject non-integer", () => {
    expect(forkSchema.safeParse({ toChatId: 1.5 }).success).toBe(false);
  });

  it("should reject missing toChatId", () => {
    expect(forkSchema.safeParse({}).success).toBe(false);
  });
});

describe("authSchema", () => {
  it("should accept valid credentials", () => {
    const result = authSchema.safeParse({ username: "alice", password: "secret123" });
    expect(result.success).toBe(true);
  });

  it("should reject short username", () => {
    expect(authSchema.safeParse({ username: "ab", password: "secret123" }).success).toBe(false);
  });

  it("should reject username with special chars", () => {
    expect(authSchema.safeParse({ username: "al!ce", password: "secret123" }).success).toBe(false);
  });

  it("should reject short password", () => {
    expect(authSchema.safeParse({ username: "alice", password: "12345" }).success).toBe(false);
  });
});

describe("configSchema", () => {
  const validMember = { name: "p", model: "m" };

  it("should accept valid config with masterIndex in range", () => {
    const result = configSchema.safeParse({
      config: {
        members: [validMember, { name: "q", model: "n" }],
        masterIndex: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("should reject masterIndex out of range", () => {
    const result = configSchema.safeParse({
      config: {
        members: [validMember],
        masterIndex: 1,
      },
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty members array", () => {
    const result = configSchema.safeParse({
      config: {
        members: [],
        masterIndex: 0,
      },
    });
    expect(result.success).toBe(false);
  });
});
