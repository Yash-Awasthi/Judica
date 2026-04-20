import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  createGate,
  respondToGate,
  getGate,
  listPendingGates,
  listGatesForRun,
  cancelGate,
  cleanupExpiredGates,
} from "../../src/services/hitlGates.service.js";

// P6-09: Use fake timers for timeout scenarios to avoid flakiness
describe("hitlGates.service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createGate", () => {
    it("creates a pending gate and returns a promise", () => {
      const promise = createGate("run-1", "node-1", 1, {
        type: "approval",
        description: "Deploy to production?",
        timeoutMs: 60_000,
      });

      expect(promise).toBeInstanceOf(Promise);

      const gate = listGatesForRun("run-1")[0];
      expect(gate).toBeDefined();
      expect(gate.status).toBe("pending");
      expect(gate.config.type).toBe("approval");
      expect(gate.config.description).toBe("Deploy to production?");

      // Clean up
      cancelGate(gate.id);
    });

    it("resolves with expired when timeout hits and autoApprove is false", async () => {
      const promise = createGate("run-2", "node-1", 1, {
        type: "confirmation",
        description: "Continue?",
        timeoutMs: 5_000,
        autoApproveOnTimeout: false,
      });

      // P6-09: Advance past timeout using fake timers
      await vi.advanceTimersByTimeAsync(5_001);

      const result = await promise;
      expect(result.status).toBe("expired");
    });

    it("resolves with approved when timeout hits and autoApprove is true", async () => {
      const promise = createGate("run-3", "node-1", 1, {
        type: "confirmation",
        description: "Auto-approve test",
        timeoutMs: 5_000,
        autoApproveOnTimeout: true,
      });

      await vi.advanceTimersByTimeAsync(5_001);

      const result = await promise;
      expect(result.status).toBe("approved");
    });

    // P6-09: Explicit test for expiry → timeout branch transition
    it("transitions from pending to expired after exact timeout boundary", async () => {
      const promise = createGate("run-boundary", "node-1", 1, {
        type: "approval",
        description: "Boundary test",
        timeoutMs: 10_000,
        autoApproveOnTimeout: false,
      });

      // Just before timeout — still pending
      await vi.advanceTimersByTimeAsync(9_999);
      const gate = listGatesForRun("run-boundary")[0];
      expect(gate?.status).toBe("pending");

      // At timeout — should expire
      await vi.advanceTimersByTimeAsync(2);
      const result = await promise;
      expect(result.status).toBe("expired");
    });
  });

  describe("respondToGate", () => {
    it("approves a pending gate", async () => {
      const promise = createGate("run-4", "node-1", 1, {
        type: "approval",
        description: "Approve?",
        timeoutMs: 60_000,
      });

      const gate = listGatesForRun("run-4")[0];
      const resp = respondToGate(gate.id, 1, "approve", "LGTM");
      expect(resp.success).toBe(true);

      const result = await promise;
      expect(result.status).toBe("approved");
      expect(result.approvals).toHaveLength(1);
      expect(result.approvals[0].comment).toBe("LGTM");
    });

    it("rejects a pending gate", async () => {
      const promise = createGate("run-5", "node-1", 1, {
        type: "review",
        description: "Review changes",
        timeoutMs: 60_000,
      });

      const gate = listGatesForRun("run-5")[0];
      const resp = respondToGate(gate.id, 1, "reject", "Needs rework");
      expect(resp.success).toBe(true);

      const result = await promise;
      expect(result.status).toBe("rejected");
    });

    it("returns error for nonexistent gate", () => {
      const resp = respondToGate("nonexistent", 1, "approve");
      expect(resp.success).toBe(false);
      expect(resp.error).toBe("Gate not found");
    });

    it("returns error for already resolved gate", async () => {
      const promise = createGate("run-6", "node-1", 1, {
        type: "approval",
        description: "Test",
        timeoutMs: 60_000,
      });

      const gate = listGatesForRun("run-6")[0];
      respondToGate(gate.id, 1, "approve");
      await promise;

      const resp = respondToGate(gate.id, 1, "approve");
      expect(resp.success).toBe(false);
      expect(resp.error).toMatch(/already/);
    });

    it("rejects unauthorized approver", async () => {
      const promise = createGate("run-7", "node-1", 1, {
        type: "escalation",
        description: "Admin approval needed",
        timeoutMs: 60_000,
        requiredApprovers: [99],
      });

      const gate = listGatesForRun("run-7")[0];
      const resp = respondToGate(gate.id, 1, "approve");
      expect(resp.success).toBe(false);
      expect(resp.error).toMatch(/not authorized/);

      cancelGate(gate.id);
      await promise;
    });

    it("supports multi-approver gates", async () => {
      const promise = createGate("run-8", "node-1", 1, {
        type: "approval",
        description: "Need 2 approvals",
        timeoutMs: 60_000,
        minApprovals: 2,
      });

      const gate = listGatesForRun("run-8")[0];

      // First approval — still pending
      respondToGate(gate.id, 10, "approve");
      expect(getGate(gate.id)?.status).toBe("pending");

      // Second approval — now approved
      respondToGate(gate.id, 20, "approve");

      const result = await promise;
      expect(result.status).toBe("approved");
      expect(result.approvals).toHaveLength(2);
    });
  });

  describe("listPendingGates", () => {
    it("returns pending gates sorted by priority", () => {
      const p1 = createGate("run-list", "node-1", 1, {
        type: "approval", description: "Low priority", priority: "low", timeoutMs: 60_000,
      });
      const p2 = createGate("run-list", "node-2", 1, {
        type: "approval", description: "Critical", priority: "critical", timeoutMs: 60_000,
      });

      const pending = listPendingGates(1);
      const forRun = pending.filter((g) => g.workflowRunId === "run-list");

      expect(forRun.length).toBeGreaterThanOrEqual(2);
      expect(forRun[0].config.priority).toBe("critical");

      // Clean up
      for (const g of forRun) cancelGate(g.id);
    });
  });

  describe("cancelGate", () => {
    it("cancels a pending gate", async () => {
      const promise = createGate("run-cancel", "node-1", 1, {
        type: "approval", description: "Cancel me", timeoutMs: 60_000,
      });

      const gate = listGatesForRun("run-cancel")[0];
      const cancelled = cancelGate(gate.id);
      expect(cancelled).toBe(true);

      const result = await promise;
      expect(result.status).toBe("expired");
    });

    it("returns false for nonexistent gate", () => {
      expect(cancelGate("nope")).toBe(false);
    });
  });

  describe("cleanupExpiredGates", () => {
    it("removes old resolved gates", () => {
      const removed = cleanupExpiredGates(0);
      expect(typeof removed).toBe("number");
    });
  });
});
