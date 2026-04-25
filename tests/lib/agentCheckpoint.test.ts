import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock redis
vi.mock("../../src/lib/redis.js", () => ({
  default: {
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
  },
}));

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  hasCheckpoint,
} from "../../src/lib/agentCheckpoint.js";
import redis from "../../src/lib/redis.js";
import logger from "../../src/lib/logger.js";

describe("agentCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- validateJobId (tested indirectly through public API) ----------

  describe("validateJobId", () => {
    it("rejects empty jobId", async () => {
      await expect(saveCheckpoint("", {})).rejects.toThrow("Invalid jobId");
    });

    it("rejects undefined-ish jobId", async () => {
      await expect(saveCheckpoint(null as any, {})).rejects.toThrow("Invalid jobId");
    });

    it("rejects jobId longer than 256 characters", async () => {
      const longId = "a".repeat(257);
      await expect(saveCheckpoint(longId, {})).rejects.toThrow("Invalid jobId");
    });

    it("accepts jobId exactly 256 characters", async () => {
      const maxId = "a".repeat(256);
      await expect(saveCheckpoint(maxId, {})).resolves.toBeUndefined();
    });

    it("rejects jobId with spaces", async () => {
      await expect(saveCheckpoint("job with spaces", {})).rejects.toThrow(
        "must contain only alphanumeric"
      );
    });

    it("rejects jobId with slashes", async () => {
      await expect(saveCheckpoint("job/id", {})).rejects.toThrow(
        "must contain only alphanumeric"
      );
    });

    it("rejects jobId with colons", async () => {
      await expect(saveCheckpoint("job:id", {})).rejects.toThrow(
        "must contain only alphanumeric"
      );
    });

    it("rejects jobId with newline characters", async () => {
      await expect(saveCheckpoint("job\nid", {})).rejects.toThrow(
        "must contain only alphanumeric"
      );
    });

    it("accepts alphanumeric jobId", async () => {
      await expect(saveCheckpoint("abc123", {})).resolves.toBeUndefined();
    });

    it("accepts jobId with dots, hyphens, and underscores", async () => {
      await expect(saveCheckpoint("my-job_v1.2", {})).resolves.toBeUndefined();
    });

    it("accepts single-character jobId", async () => {
      await expect(saveCheckpoint("a", {})).resolves.toBeUndefined();
    });
  });

  // ---------- saveCheckpoint ----------

  describe("saveCheckpoint", () => {
    it("calls redis.set with correct key prefix and TTL", async () => {
      await saveCheckpoint("job-1", { partial: [1, 2] }, 3);

      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, value, opts] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(key).toBe("agent:checkpoint:job-1");
      expect(opts).toEqual({ EX: 86400 });

      const parsed = JSON.parse(value);
      expect(parsed.jobId).toBe("job-1");
      expect(parsed.step).toBe(3);
      expect(parsed.data).toEqual({ partial: [1, 2] });
      expect(parsed.savedAt).toBeDefined();
    });

    it("defaults step to 0", async () => {
      await saveCheckpoint("job-2", { foo: "bar" });

      const [, value] = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(JSON.parse(value).step).toBe(0);
    });

    it("logs debug on success", async () => {
      await saveCheckpoint("job-3", {});
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-3", step: 0 }),
        "Agent checkpoint saved"
      );
    });

    it("handles redis error gracefully (logs warning, does not throw)", async () => {
      (redis.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Redis down"));

      await expect(saveCheckpoint("job-4", {})).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-4", err: "Redis down" }),
        "Failed to save agent checkpoint"
      );
    });
  });

  // ---------- loadCheckpoint ----------

  describe("loadCheckpoint", () => {
    it("returns parsed checkpoint from redis", async () => {
      const checkpoint = {
        jobId: "job-5",
        step: 2,
        data: { results: [1] },
        savedAt: "2025-01-01T00:00:00.000Z",
      };
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(checkpoint));

      const result = await loadCheckpoint("job-5");
      expect(result).toEqual(checkpoint);
      expect(redis.get).toHaveBeenCalledWith("agent:checkpoint:job-5");
    });

    it("returns null when redis returns null", async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await loadCheckpoint("job-6");
      expect(result).toBeNull();
    });

    it("returns null on JSON parse error", async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce("not valid json{{{");

      const result = await loadCheckpoint("job-7");
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-7" }),
        "Failed to load agent checkpoint"
      );
    });

    it("handles redis error gracefully", async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Timeout"));

      const result = await loadCheckpoint("job-8");
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ---------- clearCheckpoint ----------

  describe("clearCheckpoint", () => {
    it("calls redis.del with correct key", async () => {
      await clearCheckpoint("job-9");
      expect(redis.del).toHaveBeenCalledWith("agent:checkpoint:job-9");
    });

    it("logs debug on success", async () => {
      await clearCheckpoint("job-10");
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-10" }),
        "Agent checkpoint cleared"
      );
    });

    it("handles redis error gracefully", async () => {
      (redis.del as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Redis down"));

      await expect(clearCheckpoint("job-11")).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-11", err: "Redis down" }),
        "Failed to clear agent checkpoint"
      );
    });
  });

  // ---------- hasCheckpoint ----------

  describe("hasCheckpoint", () => {
    it("returns true when checkpoint exists", async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce('{"step":1}');

      const result = await hasCheckpoint("job-12");
      expect(result).toBe(true);
      expect(redis.get).toHaveBeenCalledWith("agent:checkpoint:job-12");
    });

    it("returns false when no checkpoint exists", async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await hasCheckpoint("job-13");
      expect(result).toBe(false);
    });

    it("returns false on redis error", async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Connection lost"));

      const result = await hasCheckpoint("job-14");
      expect(result).toBe(false);
    });

    it("validates jobId before checking redis", async () => {
      await expect(hasCheckpoint("")).rejects.toThrow("Invalid jobId");
      expect(redis.get).not.toHaveBeenCalled();
    });
  });
});
