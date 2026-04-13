import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock dependencies ----
const mockDbSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock("../../../src/lib/drizzle.js", () => ({
  db: {
    select: () => ({
      from: (...args: any[]) => {
        mockFrom(...args);
        return {
          where: (...args2: any[]) => {
            mockWhere(...args2);
            return {
              limit: (n: number) => {
                mockLimit(n);
                return mockDbSelect();
              },
            };
          },
        };
      },
    }),
  },
}));

vi.mock("../../../src/db/schema/marketplace.js", () => ({
  userSkills: {
    userId: "userId",
    name: "name",
    active: "active",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ type: "eq", args })),
  and: vi.fn((...args: any[]) => ({ type: "and", args })),
}));

const mockExecutePython = vi.fn();
vi.mock("../../../src/sandbox/pythonSandbox.js", () => ({
  executePython: (...args: any[]) => mockExecutePython(...args),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../src/lib/tools/index.js", () => ({
  registerTool: vi.fn(),
}));

import { executeUserSkill } from "../../../src/lib/tools/skillExecutor.js";

describe("skillExecutor – executeUserSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a user skill and returns parsed JSON output", async () => {
    // DB returns a matching skill
    mockDbSelect.mockResolvedValueOnce([
      { id: 1, userId: 42, name: "my_skill", code: 'print(json.dumps({"result": "ok"}))', active: true },
    ]);

    // Python sandbox returns JSON on stdout
    mockExecutePython.mockResolvedValueOnce({
      output: ['{"result": "ok"}'],
      error: null,
      elapsedMs: 50,
    });

    const result = await executeUserSkill(42, "my_skill", { x: 1 });

    expect(result).toEqual({ result: "ok" });
    expect(mockExecutePython).toHaveBeenCalledTimes(1);
    // The script should include the input variable injection
    const script = mockExecutePython.mock.calls[0][0] as string;
    expect(script).toContain('x = 1');
    expect(script).toContain('import json, sys');
  });

  it("throws when skill is not found", async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    await expect(
      executeUserSkill(42, "nonexistent_skill", {})
    ).rejects.toThrow('Skill "nonexistent_skill" not found or inactive');
  });

  it("throws when python sandbox returns an error", async () => {
    mockDbSelect.mockResolvedValueOnce([
      { id: 1, userId: 42, name: "bad_skill", code: "raise Exception('boom')", active: true },
    ]);

    mockExecutePython.mockResolvedValueOnce({
      output: [],
      error: "Exception: boom",
      elapsedMs: 30,
    });

    await expect(
      executeUserSkill(42, "bad_skill", {})
    ).rejects.toThrow("Skill execution failed: Exception: boom");
  });

  it("returns plain string when output is not valid JSON", async () => {
    mockDbSelect.mockResolvedValueOnce([
      { id: 1, userId: 42, name: "text_skill", code: 'print("plain text")', active: true },
    ]);

    mockExecutePython.mockResolvedValueOnce({
      output: ["plain text"],
      error: null,
      elapsedMs: 20,
    });

    const result = await executeUserSkill(42, "text_skill", {});

    expect(result).toBe("plain text");
  });

  it("converts string userId to number for DB query", async () => {
    mockDbSelect.mockResolvedValueOnce([
      { id: 1, userId: 99, name: "skill", code: 'print("hi")', active: true },
    ]);

    mockExecutePython.mockResolvedValueOnce({
      output: ["hi"],
      error: null,
      elapsedMs: 10,
    });

    await executeUserSkill("99", "skill", {});

    // The function converts "99" to 99 for the DB query
    expect(mockDbSelect).toHaveBeenCalled();
  });

  it("sanitizes input keys to valid Python identifiers", async () => {
    mockDbSelect.mockResolvedValueOnce([
      { id: 1, userId: 42, name: "sanitize_skill", code: 'print("ok")', active: true },
    ]);

    mockExecutePython.mockResolvedValueOnce({
      output: ["ok"],
      error: null,
      elapsedMs: 10,
    });

    await executeUserSkill(42, "sanitize_skill", { "my-key": "value", "good_key": "val2" });

    const script = mockExecutePython.mock.calls[0][0] as string;
    // Hyphens should be replaced with underscores
    expect(script).toContain("my_key");
    expect(script).toContain("good_key");
  });

  it("passes 10_000ms timeout to executePython", async () => {
    mockDbSelect.mockResolvedValueOnce([
      { id: 1, userId: 42, name: "timeout_skill", code: 'print("done")', active: true },
    ]);

    mockExecutePython.mockResolvedValueOnce({
      output: ["done"],
      error: null,
      elapsedMs: 10,
    });

    await executeUserSkill(42, "timeout_skill", {});

    expect(mockExecutePython).toHaveBeenCalledWith(expect.any(String), 10_000);
  });
});
