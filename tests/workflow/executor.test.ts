import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NodeHandler, WorkflowDefinition, ExecutionEvent, NodeContext } from "../../src/workflow/types.js";
import { NodeType } from "../../src/workflow/types.js";

// Use vi.hoisted to create the map before mock hoisting
const { mockHandlers } = vi.hoisted(() => {
  const mockHandlers = new Map<string, unknown>();
  return { mockHandlers };
});

vi.mock("../../src/workflow/nodes/index.js", () => ({
  nodeHandlers: mockHandlers,
}));

import { WorkflowExecutor } from "../../src/workflow/executor.js";

async function collectEvents(gen: AsyncGenerator<ExecutionEvent>): Promise<ExecutionEvent[]> {
  const events: ExecutionEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  mockHandlers.clear();
});

describe("WorkflowExecutor", () => {
  it("executes a simple input -> output workflow", async () => {
    mockHandlers.set(NodeType.INPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.OUTPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "in1", type: NodeType.INPUT, position: { x: 0, y: 0 }, data: { name: "query" } },
        { id: "out1", type: NodeType.OUTPUT, position: { x: 200, y: 0 }, data: { name: "result" } },
      ],
      edges: [
        { id: "e1", source: "in1", target: "out1" },
      ],
      inputs: [{ name: "query", type: "string" }],
      outputs: [{ name: "result", type: "string", nodeId: "out1" }],
    };

    const executor = new WorkflowExecutor(definition, "run-1", 1);
    const events = await collectEvents(executor.run({ query: "hello" }));

    const completeEvent = events.find(e => e.type === "workflow_complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.outputs).toBeDefined();

    const resultOutput = completeEvent!.outputs!["result"] as Record<string, unknown>;
    expect(resultOutput.query).toBe("hello");
  });

  it("executes a linear workflow: input -> template -> output", async () => {
    mockHandlers.set(NodeType.INPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.OUTPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.TEMPLATE, async (ctx: NodeContext) => {
      const template = ctx.nodeData.template as string;
      const text = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return ctx.inputs[key] !== undefined ? String(ctx.inputs[key]) : `{{${key}}}`;
      });
      return { text };
    });

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "in1", type: NodeType.INPUT, position: { x: 0, y: 0 }, data: { name: "name" } },
        { id: "tmpl", type: NodeType.TEMPLATE, position: { x: 100, y: 0 }, data: { template: "Hello {{name}}!" } },
        { id: "out1", type: NodeType.OUTPUT, position: { x: 200, y: 0 }, data: { name: "greeting" } },
      ],
      edges: [
        { id: "e1", source: "in1", target: "tmpl" },
        { id: "e2", source: "tmpl", target: "out1" },
      ],
      inputs: [{ name: "name", type: "string" }],
      outputs: [{ name: "greeting", type: "string", nodeId: "out1" }],
    };

    const executor = new WorkflowExecutor(definition, "run-2", 1);
    const events = await collectEvents(executor.run({ name: "World" }));

    const nodeStarts = events.filter(e => e.type === "node_start");
    expect(nodeStarts.length).toBeGreaterThanOrEqual(2);

    const tmplComplete = events.find(e => e.type === "node_complete" && e.nodeId === "tmpl");
    expect(tmplComplete).toBeDefined();
    expect((tmplComplete!.output as Record<string, unknown>).text).toBe("Hello World!");

    const completeEvent = events.find(e => e.type === "workflow_complete");
    expect(completeEvent).toBeDefined();
  });

  it("emits node_error and workflow_error when a handler throws", async () => {
    mockHandlers.set(NodeType.INPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.OUTPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.TEMPLATE, async () => {
      throw new Error("template broke");
    });

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "in1", type: NodeType.INPUT, position: { x: 0, y: 0 }, data: { name: "x" } },
        { id: "tmpl", type: NodeType.TEMPLATE, position: { x: 100, y: 0 }, data: {} },
        { id: "out1", type: NodeType.OUTPUT, position: { x: 200, y: 0 }, data: { name: "result" } },
      ],
      edges: [
        { id: "e1", source: "in1", target: "tmpl" },
        { id: "e2", source: "tmpl", target: "out1" },
      ],
      inputs: [{ name: "x", type: "string" }],
      outputs: [{ name: "result", type: "string", nodeId: "out1" }],
    };

    const executor = new WorkflowExecutor(definition, "run-3", 1);
    const events = await collectEvents(executor.run({ x: "test" }));

    const nodeError = events.find(e => e.type === "node_error");
    expect(nodeError).toBeDefined();
    expect(nodeError!.nodeId).toBe("tmpl");
    expect(nodeError!.error).toContain("template broke");

    const wfError = events.find(e => e.type === "workflow_error");
    expect(wfError).toBeDefined();

    const complete = events.find(e => e.type === "workflow_complete");
    expect(complete).toBeUndefined();
  });

  it("emits error for missing handler", async () => {
    mockHandlers.set(NodeType.INPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "in1", type: NodeType.INPUT, position: { x: 0, y: 0 }, data: { name: "x" } },
        { id: "tmpl", type: NodeType.TEMPLATE, position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "in1", target: "tmpl" },
      ],
      inputs: [{ name: "x", type: "string" }],
      outputs: [],
    };

    const executor = new WorkflowExecutor(definition, "run-4", 1);
    const events = await collectEvents(executor.run({ x: "test" }));

    const nodeError = events.find(e => e.type === "node_error");
    expect(nodeError).toBeDefined();
    expect(nodeError!.error).toContain("No handler registered");
  });

  it("detects cycles and emits workflow_error", async () => {
    mockHandlers.set(NodeType.TEMPLATE, async (ctx: NodeContext) => ({ ...ctx.inputs }));

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "a", type: NodeType.TEMPLATE, position: { x: 0, y: 0 }, data: {} },
        { id: "b", type: NodeType.TEMPLATE, position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
      inputs: [],
      outputs: [],
    };

    const executor = new WorkflowExecutor(definition, "run-5", 1);
    const events = await collectEvents(executor.run({}));

    const wfError = events.find(e => e.type === "workflow_error");
    expect(wfError).toBeDefined();
    expect(wfError!.error).toContain("cycle");
  });

  it("handles condition branching (true branch)", async () => {
    mockHandlers.set(NodeType.INPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.OUTPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.CONDITION, async (ctx: NodeContext) => {
      return { branch: ctx.inputs.value === "yes" ? "true" : "false" };
    });
    mockHandlers.set(NodeType.TEMPLATE, async (ctx: NodeContext) => {
      return { text: "reached: " + (ctx.nodeData.label || "") };
    });

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "in1", type: NodeType.INPUT, position: { x: 0, y: 0 }, data: { name: "value" } },
        { id: "cond", type: NodeType.CONDITION, position: { x: 100, y: 0 }, data: {} },
        { id: "true_branch", type: NodeType.TEMPLATE, position: { x: 200, y: -50 }, data: { label: "true" } },
        { id: "false_branch", type: NodeType.TEMPLATE, position: { x: 200, y: 50 }, data: { label: "false" } },
        { id: "out1", type: NodeType.OUTPUT, position: { x: 300, y: 0 }, data: { name: "result" } },
      ],
      edges: [
        { id: "e1", source: "in1", target: "cond" },
        { id: "e2", source: "cond", target: "true_branch", sourceHandle: "true" },
        { id: "e3", source: "cond", target: "false_branch", sourceHandle: "false" },
        { id: "e4", source: "true_branch", target: "out1" },
        { id: "e5", source: "false_branch", target: "out1" },
      ],
      inputs: [{ name: "value", type: "string" }],
      outputs: [{ name: "result", type: "string", nodeId: "out1" }],
    };

    const executor = new WorkflowExecutor(definition, "run-6", 1);
    const events = await collectEvents(executor.run({ value: "yes" }));

    const trueBranchComplete = events.find(
      e => e.type === "node_complete" && e.nodeId === "true_branch",
    );
    expect(trueBranchComplete).toBeDefined();
    expect((trueBranchComplete!.output as Record<string, unknown>).text).toBe("reached: true");

    const complete = events.find(e => e.type === "workflow_complete");
    expect(complete).toBeDefined();
  });

  it("passes data correctly between nodes via edges", async () => {
    mockHandlers.set(NodeType.INPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.OUTPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.MERGE, async (ctx: NodeContext) => {
      return { combined: true, ...ctx.inputs };
    });

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "in1", type: NodeType.INPUT, position: { x: 0, y: 0 }, data: { name: "a" } },
        { id: "in2", type: NodeType.INPUT, position: { x: 0, y: 100 }, data: { name: "b" } },
        { id: "merge", type: NodeType.MERGE, position: { x: 100, y: 50 }, data: {} },
        { id: "out1", type: NodeType.OUTPUT, position: { x: 200, y: 50 }, data: { name: "result" } },
      ],
      edges: [
        { id: "e1", source: "in1", target: "merge" },
        { id: "e2", source: "in2", target: "merge" },
        { id: "e3", source: "merge", target: "out1" },
      ],
      inputs: [
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ],
      outputs: [{ name: "result", type: "object", nodeId: "out1" }],
    };

    const executor = new WorkflowExecutor(definition, "run-7", 1);
    const events = await collectEvents(executor.run({ a: "foo", b: "bar" }));

    const complete = events.find(e => e.type === "workflow_complete");
    expect(complete).toBeDefined();

    const mergeComplete = events.find(
      e => e.type === "node_complete" && e.nodeId === "merge",
    );
    expect(mergeComplete).toBeDefined();
    const mergeOutput = mergeComplete!.output as Record<string, unknown>;
    expect(mergeOutput.combined).toBe(true);
  });

  // P6-12: Timeout test — infinite-loop node should be terminated within configured budget
  it("terminates a node that exceeds its timeout budget", async () => {
    mockHandlers.set(NodeType.INPUT, async (ctx: NodeContext) => ({ ...ctx.inputs }));
    mockHandlers.set(NodeType.LLM, async () => {
      // Simulate an infinite loop — never resolves
      await new Promise(() => {});
    });

    const definition: WorkflowDefinition = {
      nodes: [
        { id: "in1", type: NodeType.INPUT, position: { x: 0, y: 0 }, data: { name: "query" } },
        { id: "slow", type: NodeType.LLM, position: { x: 200, y: 0 }, data: { timeout: 100 } }, // 100ms timeout
      ],
      edges: [
        { id: "e1", source: "in1", target: "slow" },
      ],
    };

    const executor = new WorkflowExecutor(definition, "run-timeout", 1);
    const events = await collectEvents(executor.run({ query: "test" }));

    // Should have a node_error event for the timed-out node
    const errorEvent = events.find(
      e => e.type === "node_error" && e.nodeId === "slow",
    );
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.error).toMatch(/timed out/i);

    // Workflow should have failed
    const workflowFailed = events.find(e => e.type === "workflow_error");
    expect(workflowFailed).toBeDefined();
  });
});
