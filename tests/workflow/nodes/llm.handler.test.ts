import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NodeContext } from "../../../src/workflow/types.js";

vi.mock("../../../src/router/index.js", () => ({
  routeAndCollect: vi.fn(),
}));

import { llmHandler } from "../../../src/workflow/nodes/llm.handler.js";
import { routeAndCollect } from "../../../src/router/index.js";

const mockRouteAndCollect = vi.mocked(routeAndCollect);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

describe("llmHandler", () => {
  it("substitutes {{var}} placeholders in user prompt", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "Hi Alice",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const ctx = makeCtx(
      { name: "Alice" },
      { user_prompt: "Greet {{name}}" },
    );
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Greet Alice" }],
      }),
    );
  });

  it("substitutes {{var}} placeholders in system prompt", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "ok",
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const ctx = makeCtx(
      { lang: "French" },
      { system_prompt: "Respond in {{lang}}", user_prompt: "Hello" },
    );
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "Respond in French" },
          { role: "user", content: "Hello" },
        ],
      }),
    );
  });

  it("leaves unmatched placeholders intact", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "resp",
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });

    const ctx = makeCtx({}, { user_prompt: "Hello {{missing}}" });
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "Hello [MISSING: missing]" }],
      }),
    );
  });

  it("omits system message when system_prompt is not provided", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "answer",
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    });

    const ctx = makeCtx({}, { user_prompt: "Question?" });
    await llmHandler(ctx);

    const call = mockRouteAndCollect.mock.calls[0][0] as { messages: unknown[] };
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0]).toEqual({ role: "user", content: "Question?" });
  });

  it("includes system message when system_prompt is provided", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "answer",
      usage: { prompt_tokens: 8, completion_tokens: 4 },
    });

    const ctx = makeCtx({}, { system_prompt: "You are helpful.", user_prompt: "Hi" });
    await llmHandler(ctx);

    const call = mockRouteAndCollect.mock.calls[0][0] as { messages: unknown[] };
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(call.messages[1]).toEqual({ role: "user", content: "Hi" });
  });

  it("defaults temperature to 0.7", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "r",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const ctx = makeCtx({}, { user_prompt: "x" });
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.7 }),
    );
  });

  it("uses provided temperature value", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "r",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const ctx = makeCtx({}, { user_prompt: "x", temperature: 0.2 });
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.2 }),
    );
  });

  it("accepts temperature of 0 without falling back to default", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "r",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const ctx = makeCtx({}, { user_prompt: "x", temperature: 0 });
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 }),
    );
  });

  it("defaults model to 'auto'", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "r",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const ctx = makeCtx({}, { user_prompt: "x" });
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ model: "auto" }),
    );
  });

  it("passes specified model to router", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "r",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const ctx = makeCtx({}, { user_prompt: "x", model: "gpt-4" });
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4" }),
    );
  });

  it("returns text and mapped usage tokens", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "Generated text",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const ctx = makeCtx({}, { user_prompt: "Prompt" });
    const result = await llmHandler(ctx);

    expect(result).toEqual({
      text: "Generated text",
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: (100 * 0.00001) + (50 * 0.00003),
      },
    });
  });

  it("returns empty user content when user_prompt is not provided", async () => {
    mockRouteAndCollect.mockResolvedValue({
      text: "r",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const ctx = makeCtx({}, {});
    await llmHandler(ctx);

    expect(mockRouteAndCollect).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "" }],
      }),
    );
  });
});
