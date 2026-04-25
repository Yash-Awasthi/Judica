import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

// Mock router
const mockRouteAndCollect = vi.fn();
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: (...args: unknown[]) => mockRouteAndCollect(...args),
}));

import {
  decomposeGoal,
  validateDAG,
  getReadyTasks,
  updateTaskStatus,
  isDAGComplete,
  getExecutionOrder,
  type SubTask,
  type TaskDAG,
} from "../../src/services/goalDecomposition.service.js";

describe("goalDecomposition.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("decomposeGoal", () => {
    it("should decompose a goal into subtasks", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          tasks: [
            { id: "task_1", title: "Research", description: "Research the topic", dependencies: [], estimatedComplexity: "low" },
            { id: "task_2", title: "Analyze", description: "Analyze findings", dependencies: ["task_1"], estimatedComplexity: "medium" },
            { id: "task_3", title: "Report", description: "Write report", dependencies: ["task_2"], estimatedComplexity: "medium" },
          ],
        }),
      });

      const dag = await decomposeGoal("Build a comprehensive market analysis report");

      expect(dag.goal).toBe("Build a comprehensive market analysis report");
      expect(dag.tasks).toHaveLength(3);
      expect(dag.tasks[0].status).toBe("pending");
      expect(dag.tasks[1].dependencies).toContain("task_1");
    });

    it("should reject circular dependencies", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          tasks: [
            { id: "task_1", title: "A", description: "A", dependencies: ["task_2"], estimatedComplexity: "low" },
            { id: "task_2", title: "B", description: "B", dependencies: ["task_1"], estimatedComplexity: "low" },
          ],
        }),
      });

      await expect(decomposeGoal("Circular test")).rejects.toThrow("Circular dependency");
    });
  });

  describe("validateDAG", () => {
    it("should accept valid DAG", () => {
      const tasks: SubTask[] = [
        { id: "a", title: "A", description: "", dependencies: [], status: "pending", estimatedComplexity: "low" },
        { id: "b", title: "B", description: "", dependencies: ["a"], status: "pending", estimatedComplexity: "low" },
        { id: "c", title: "C", description: "", dependencies: ["a"], status: "pending", estimatedComplexity: "low" },
        { id: "d", title: "D", description: "", dependencies: ["b", "c"], status: "pending", estimatedComplexity: "low" },
      ];
      expect(() => validateDAG(tasks)).not.toThrow();
    });

    it("should reject circular dependencies", () => {
      const tasks: SubTask[] = [
        { id: "a", title: "A", description: "", dependencies: ["c"], status: "pending", estimatedComplexity: "low" },
        { id: "b", title: "B", description: "", dependencies: ["a"], status: "pending", estimatedComplexity: "low" },
        { id: "c", title: "C", description: "", dependencies: ["b"], status: "pending", estimatedComplexity: "low" },
      ];
      expect(() => validateDAG(tasks)).toThrow("Circular dependency");
    });

    it("should reject missing dependencies", () => {
      const tasks: SubTask[] = [
        { id: "a", title: "A", description: "", dependencies: ["nonexistent"], status: "pending", estimatedComplexity: "low" },
      ];
      expect(() => validateDAG(tasks)).toThrow("non-existent task");
    });
  });

  describe("getReadyTasks", () => {
    it("should return tasks with all dependencies completed", () => {
      const dag: TaskDAG = {
        goal: "test",
        tasks: [
          { id: "a", title: "A", description: "", dependencies: [], status: "completed", estimatedComplexity: "low" },
          { id: "b", title: "B", description: "", dependencies: ["a"], status: "pending", estimatedComplexity: "low" },
          { id: "c", title: "C", description: "", dependencies: [], status: "pending", estimatedComplexity: "low" },
          { id: "d", title: "D", description: "", dependencies: ["b", "c"], status: "pending", estimatedComplexity: "low" },
        ],
        createdAt: "",
      };

      const ready = getReadyTasks(dag);
      expect(ready.map((t) => t.id)).toEqual(["b", "c"]);
    });

    it("should return empty when no tasks are ready", () => {
      const dag: TaskDAG = {
        goal: "test",
        tasks: [
          { id: "a", title: "A", description: "", dependencies: [], status: "in_progress", estimatedComplexity: "low" },
          { id: "b", title: "B", description: "", dependencies: ["a"], status: "pending", estimatedComplexity: "low" },
        ],
        createdAt: "",
      };

      expect(getReadyTasks(dag)).toHaveLength(0);
    });
  });

  describe("updateTaskStatus", () => {
    it("should update task status", () => {
      const dag: TaskDAG = {
        goal: "test",
        tasks: [
          { id: "a", title: "A", description: "", dependencies: [], status: "pending", estimatedComplexity: "low" },
        ],
        createdAt: "",
      };

      const updated = updateTaskStatus(dag, "a", "completed", "result");
      expect(updated.tasks[0].status).toBe("completed");
      expect(updated.tasks[0].output).toBe("result");
    });

    it("should block dependent tasks on failure", () => {
      const dag: TaskDAG = {
        goal: "test",
        tasks: [
          { id: "a", title: "A", description: "", dependencies: [], status: "pending", estimatedComplexity: "low" },
          { id: "b", title: "B", description: "", dependencies: ["a"], status: "pending", estimatedComplexity: "low" },
          { id: "c", title: "C", description: "", dependencies: [], status: "pending", estimatedComplexity: "low" },
        ],
        createdAt: "",
      };

      const updated = updateTaskStatus(dag, "a", "failed", undefined, "error");
      expect(updated.tasks[0].status).toBe("failed");
      expect(updated.tasks[1].status).toBe("blocked"); // depends on a
      expect(updated.tasks[2].status).toBe("pending"); // independent
    });
  });

  describe("isDAGComplete", () => {
    it("should return true when all tasks are terminal", () => {
      const dag: TaskDAG = {
        goal: "test",
        tasks: [
          { id: "a", title: "A", description: "", dependencies: [], status: "completed", estimatedComplexity: "low" },
          { id: "b", title: "B", description: "", dependencies: [], status: "failed", estimatedComplexity: "low" },
          { id: "c", title: "C", description: "", dependencies: ["b"], status: "blocked", estimatedComplexity: "low" },
        ],
        createdAt: "",
      };
      expect(isDAGComplete(dag)).toBe(true);
    });

    it("should return false when tasks are still pending", () => {
      const dag: TaskDAG = {
        goal: "test",
        tasks: [
          { id: "a", title: "A", description: "", dependencies: [], status: "completed", estimatedComplexity: "low" },
          { id: "b", title: "B", description: "", dependencies: ["a"], status: "pending", estimatedComplexity: "low" },
        ],
        createdAt: "",
      };
      expect(isDAGComplete(dag)).toBe(false);
    });
  });

  describe("getExecutionOrder", () => {
    it("should return topologically sorted levels", () => {
      const dag: TaskDAG = {
        goal: "test",
        tasks: [
          { id: "a", title: "A", description: "", dependencies: [], status: "pending", estimatedComplexity: "low" },
          { id: "b", title: "B", description: "", dependencies: [], status: "pending", estimatedComplexity: "low" },
          { id: "c", title: "C", description: "", dependencies: ["a", "b"], status: "pending", estimatedComplexity: "low" },
          { id: "d", title: "D", description: "", dependencies: ["c"], status: "pending", estimatedComplexity: "low" },
        ],
        createdAt: "",
      };

      const levels = getExecutionOrder(dag);
      expect(levels).toHaveLength(3);
      expect(levels[0].map((t) => t.id).sort()).toEqual(["a", "b"]); // parallel
      expect(levels[1].map((t) => t.id)).toEqual(["c"]);
      expect(levels[2].map((t) => t.id)).toEqual(["d"]);
    });
  });
});
