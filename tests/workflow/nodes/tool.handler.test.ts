import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NodeContext } from "../../../src/workflow/types.js";

vi.mock("../../../src/lib/tools/index.js", () => ({
  executeTool: vi.fn(),
}));

vi.mock("../../../src/lib/tools/builtin.js", () => ({}));

import { toolHandler } from "../../../src/workflow/nodes/tool.handler.js";
import { executeTool } from "../../../src/lib/tools/index.js";

const mockExecuteTool = vi.mocked(executeTool);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

describe("toolHandler", () => {
  it("calls executeTool with correct tool name and merged args", async () => {
    mockExecuteTool.mockResolvedValue({ result: "{}", error: undefined });

    const ctx = makeCtx(
      { query: "hello" },
      { tool_name: "search", tool_inputs: { limit: 10 } },
    );
    await toolHandler(ctx);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "search",
        arguments: { limit: 10, query: "hello" },
      }),
      expect.objectContaining({
        userId: "1",
        requestId: "test-run",
      }),
    );
  });

  it("workflow inputs override config tool_inputs", async () => {
    mockExecuteTool.mockResolvedValue({ result: "ok", error: undefined });

    const ctx = makeCtx(
      { limit: 20 },
      { tool_name: "search", tool_inputs: { limit: 10, format: "json" } },
    );
    await toolHandler(ctx);

    const call = mockExecuteTool.mock.calls[0][0] as { arguments: Record<string, unknown> };
    expect(call.arguments.limit).toBe(20);
    expect(call.arguments.format).toBe("json");
  });

  it("defaults tool_inputs to empty object when not provided", async () => {
    mockExecuteTool.mockResolvedValue({ result: "ok", error: undefined });

    const ctx = makeCtx({ a: 1 }, { tool_name: "my_tool" });
    await toolHandler(ctx);

    const call = mockExecuteTool.mock.calls[0][0] as { arguments: Record<string, unknown> };
    expect(call.arguments).toEqual({ a: 1 });
  });

  it("parses valid JSON result", async () => {
    mockExecuteTool.mockResolvedValue({
      result: '{"data": [1, 2, 3]}',
      error: undefined,
    });

    const ctx = makeCtx({}, { tool_name: "fetch" });
    const result = await toolHandler(ctx);

    expect(result).toEqual({ result: { data: [1, 2, 3] } });
  });

  it("returns raw string when result is not valid JSON", async () => {
    mockExecuteTool.mockResolvedValue({
      result: "plain text response",
      error: undefined,
    });

    const ctx = makeCtx({}, { tool_name: "echo" });
    const result = await toolHandler(ctx);

    expect(result).toEqual({ result: "plain text response" });
  });

  it("throws when error is present", async () => {
    mockExecuteTool.mockResolvedValue({
      result: "partial data",
      error: "timeout exceeded",
    });

    const ctx = makeCtx({}, { tool_name: "slow_tool" });

    await expect(toolHandler(ctx)).rejects.toThrow(
      'Tool "slow_tool" failed: timeout exceeded',
    );
  });

  it("throws without JSON parsing when error is present", async () => {
    mockExecuteTool.mockResolvedValue({
      result: '{"valid": "json"}',
      error: "some error",
    });

    const ctx = makeCtx({}, { tool_name: "broken" });

    await expect(toolHandler(ctx)).rejects.toThrow(
      'Tool "broken" failed: some error',
    );
  });

  it("generates a tool call ID containing runId", async () => {
    mockExecuteTool.mockResolvedValue({ result: "ok", error: undefined });

    const ctx = makeCtx({}, { tool_name: "test_tool" });
    await toolHandler(ctx);

    const call = mockExecuteTool.mock.calls[0][0] as { id: string };
    expect(call.id).toMatch(/^wf_test-run_\d+$/);
  });

  it("passes userId as string and runId as requestId", async () => {
    mockExecuteTool.mockResolvedValue({ result: "ok", error: undefined });

    const ctx: NodeContext = { inputs: {}, nodeData: { tool_name: "t" }, runId: "run-abc", userId: 42 };
    await toolHandler(ctx);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      expect.anything(),
      { userId: "42", requestId: "run-abc" },
    );
  });
});
