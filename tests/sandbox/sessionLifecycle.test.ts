import { SandboxLifecycleManager } from "../../sandbox/sessionLifecycle.js";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

describe("sessionLifecycle (Phase 8.10)", () => {
  let mgr: SandboxLifecycleManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new SandboxLifecycleManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("registerSession", () => {
    it("starts in provisioning state", () => {
      const s = mgr.registerSession("s1", "user-1");
      expect(s.state).toBe("provisioning");
      expect(s.execCount).toBe(0);
    });
  });

  describe("transition", () => {
    it("allows valid transition provisioning → ready", () => {
      mgr.registerSession("s1", "user-1");
      const s = mgr.transition("s1", "ready");
      expect(s.state).toBe("ready");
    });

    it("blocks invalid transition ready → sleeping", () => {
      mgr.registerSession("s1", "user-1");
      mgr.transition("s1", "ready");
      expect(() => mgr.transition("s1", "sleeping")).toThrow(/Invalid transition/);
    });

    it("emits transition event", () => {
      mgr.registerSession("s1", "user-1");
      const events: string[] = [];
      mgr.on("transition", (e) => events.push(`${e.from}→${e.to}`));
      mgr.transition("s1", "ready");
      mgr.transition("s1", "running");
      expect(events).toEqual(["provisioning→ready", "ready→running"]);
    });

    it("follows full happy-path lifecycle", () => {
      mgr.registerSession("s1", "user-1", "container-abc");
      mgr.transition("s1", "ready");
      mgr.transition("s1", "running");
      mgr.transition("s1", "idle");
      mgr.transition("s1", "sleeping");
      mgr.transition("s1", "restored");
      mgr.transition("s1", "running");
      const s = mgr.getSession("s1");
      expect(s?.state).toBe("running");
    });

    it("throws for unknown session", () => {
      expect(() => mgr.transition("unknown", "ready")).toThrow(/Session not found/);
    });
  });

  describe("recordActivity", () => {
    it("transitions idle → running on activity", () => {
      mgr.registerSession("s1", "user-1");
      mgr.transition("s1", "ready");
      mgr.transition("s1", "running");
      mgr.transition("s1", "idle");
      mgr.recordActivity("s1");
      expect(mgr.getSession("s1")?.state).toBe("running");
    });

    it("increments execCount on each activity", () => {
      mgr.registerSession("s1", "user-1");
      mgr.transition("s1", "ready");
      mgr.transition("s1", "running");
      mgr.recordActivity("s1");
      mgr.recordActivity("s1");
      expect(mgr.getSession("s1")?.execCount).toBe(2);
    });
  });

  describe("pool management", () => {
    it("acquireFromPool returns undefined when pool is empty", () => {
      const s = mgr.acquireFromPool("user-2");
      expect(s).toBeUndefined();
    });

    it("addToPool and acquireFromPool work together", () => {
      mgr.registerSession("pool-1", "pool-user");
      mgr.transition("pool-1", "ready");
      mgr.addToPool("pool-1");
      expect(mgr.poolSize()).toBe(1);

      const s = mgr.acquireFromPool("requesting-user");
      expect(s).not.toBeUndefined();
      expect(s?.state).toBe("running");
      expect(s?.userId).toBe("requesting-user");
      expect(mgr.poolSize()).toBe(0);
    });
  });

  describe("destroySession", () => {
    it("removes session and clears it from pool", () => {
      mgr.registerSession("s1", "user-1");
      mgr.transition("s1", "ready");
      mgr.addToPool("s1");
      mgr.destroySession("s1", "test cleanup");
      expect(mgr.getSession("s1")).toBeUndefined();
      expect(mgr.poolSize()).toBe(0);
    });

    it("is idempotent on already-destroyed sessions", () => {
      mgr.registerSession("s1", "user-1");
      mgr.destroySession("s1");
      expect(() => mgr.destroySession("s1")).not.toThrow();
    });
  });

  describe("idle timeout", () => {
    it("transitions running → idle after IDLE_TIMEOUT_MS", () => {
      process.env.SANDBOX_IDLE_TIMEOUT_MS = "5000";
      const m2 = new SandboxLifecycleManager();
      m2.registerSession("s2", "user-1");
      m2.transition("s2", "ready");
      m2.transition("s2", "running");
      vi.advanceTimersByTime(5001);
      expect(m2.getSession("s2")?.state).toBe("idle");
    });
  });
});
