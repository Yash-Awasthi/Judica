import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  createAgent,
  getAgent,
  listAgents,
  pauseAgent,
  resumeAgent,
  cancelAgent,
  cleanupAgents,
} from "../../src/services/backgroundAgents.service.js";

// P6-08: Use fake timers instead of real setTimeout to avoid flakiness
describe("backgroundAgents.service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and runs agent to completion", async () => {
    const progressUpdates: number[] = [];

    const agent = await createAgent({
      userId: 1,
      name: "Test Agent",
      description: "Runs 3 steps",
      steps: [
        { name: "Step 1", handler: async () => "result-1" },
        { name: "Step 2", handler: async () => "result-2" },
        { name: "Step 3", handler: async () => "result-3" },
      ],
      onProgress: (a) => progressUpdates.push(a.progress),
    });

    await vi.advanceTimersByTimeAsync(200);

    const completed = getAgent(agent.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.progress).toBe(100);
    expect(completed?.steps.every((s) => s.status === "completed")).toBe(true);
    expect(progressUpdates).toContain(100);
  });

  it("handles step failures", async () => {
    const agent = await createAgent({
      userId: 1,
      name: "Failing Agent",
      description: "Step 2 fails",
      steps: [
        { name: "Step 1", handler: async () => "ok" },
        { name: "Step 2", handler: async () => { throw new Error("boom"); } },
        { name: "Step 3", handler: async () => "never" },
      ],
    });

    await vi.advanceTimersByTimeAsync(200);

    const failed = getAgent(agent.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toMatch(/boom/);
    expect(failed?.steps[0].status).toBe("completed");
    expect(failed?.steps[1].status).toBe("failed");
    expect(failed?.steps[2].status).toBe("pending");
  });

  it("supports checkpointing", async () => {
    let savedData: Record<string, unknown> | null = null;

    const agent = await createAgent({
      userId: 1,
      name: "Checkpoint Agent",
      description: "Saves checkpoint",
      steps: [
        {
          name: "Step 1",
          handler: async (ctx) => {
            ctx.saveCheckpoint({ progress: 50, items: ["a", "b"] });
            return "done";
          },
        },
        {
          name: "Step 2",
          handler: async (ctx) => {
            savedData = ctx.checkpoint?.data ?? null;
            return "done";
          },
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(200);

    expect(savedData).toEqual({ progress: 50, items: ["a", "b"] });
  });

  it("passes previous results to subsequent steps", async () => {
    let receivedResults: unknown[] = [];

    const agent = await createAgent({
      userId: 1,
      name: "Piped Agent",
      description: "Passes results",
      steps: [
        { name: "Step 1", handler: async () => 42 },
        { name: "Step 2", handler: async () => "hello" },
        {
          name: "Step 3",
          handler: async (ctx) => {
            receivedResults = ctx.previousResults;
            return "done";
          },
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(receivedResults.slice(0, 2)).toEqual([42, "hello"]);
  });

  it("cancels a running agent", async () => {
    const agent = await createAgent({
      userId: 1,
      name: "Cancel Agent",
      description: "Long running",
      steps: [
        { name: "Step 1", handler: async () => { await new Promise((r) => setTimeout(r, 50)); return "ok"; } },
        { name: "Step 2", handler: async () => { await new Promise((r) => setTimeout(r, 5000)); return "slow"; } },
      ],
    });

    // Advance past step 1 start but before step 2 completes
    await vi.advanceTimersByTimeAsync(60);
    cancelAgent(agent.id);

    await vi.advanceTimersByTimeAsync(200);

    const cancelled = getAgent(agent.id);
    expect(cancelled?.status).toBe("cancelled");
  });

  it("lists agents for a user", async () => {
    const agent = await createAgent({
      userId: 99,
      name: "List Test",
      description: "For listing",
      steps: [{ name: "Step 1", handler: async () => "ok" }],
    });

    await vi.advanceTimersByTimeAsync(200);

    const all = listAgents(99);
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.some((a) => a.id === agent.id)).toBe(true);
  });

  it("lists agents filtered by status", async () => {
    const agent = await createAgent({
      userId: 100,
      name: "Status Filter",
      description: "For filtering",
      steps: [{ name: "Step 1", handler: async () => "ok" }],
    });

    await vi.advanceTimersByTimeAsync(200);

    const completed = listAgents(100, "completed");
    expect(completed.every((a) => a.status === "completed")).toBe(true);

    const running = listAgents(100, "running");
    expect(running.every((a) => a.status === "running")).toBe(true);
  });

  it("cleans up old agents", () => {
    const removed = cleanupAgents(0);
    expect(typeof removed).toBe("number");
  });
});
