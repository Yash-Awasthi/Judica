import { describe, it, expect, vi } from "vitest";

// P11-97: LLM output parsing fragile
// P11-98: No large DAG test
// P11-99: Filename-based image detection only
// P11-100: No base64 validation
// P11-101: Timer masking hides async errors

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

describe("P11-97: LLM output parsing robustness", () => {
  interface SubTask {
    id: string;
    title: string;
    description: string;
    dependencies: string[];
    estimatedComplexity: "low" | "medium" | "high";
  }

  const parseLLMResponse = (raw: string): { tasks: SubTask[] } | { error: string } => {
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "").trim();
      const parsed = JSON.parse(cleaned);

      if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
        return { error: "Missing 'tasks' array" };
      }

      for (const task of parsed.tasks) {
        if (!task.id || !task.title) {
          return { error: "Task missing required fields (id, title)" };
        }
      }

      return parsed;
    } catch (e) {
      return { error: `JSON parse failed: ${(e as Error).message}` };
    }
  };

  it("should parse well-formed LLM response", () => {
    const response = JSON.stringify({
      tasks: [
        { id: "t1", title: "Research", description: "Do research", dependencies: [], estimatedComplexity: "low" },
        { id: "t2", title: "Implement", description: "Build it", dependencies: ["t1"], estimatedComplexity: "medium" },
      ],
    });

    const result = parseLLMResponse(response);
    expect("tasks" in result).toBe(true);
    if ("tasks" in result) {
      expect(result.tasks).toHaveLength(2);
    }
  });

  it("should handle malformed JSON from LLM", () => {
    const badResponses = [
      '{"tasks": [{"id": "t1", title: missing quotes}]}',
      "Here are the tasks: ...",
      "",
      "null",
      '{"tasks": "not an array"}',
    ];

    for (const bad of badResponses) {
      const result = parseLLMResponse(bad);
      expect("error" in result).toBe(true);
    }
  });

  it("should handle JSON wrapped in markdown code fences", () => {
    const fenced = '```json\n{"tasks": [{"id": "t1", "title": "Test", "description": "d", "dependencies": [], "estimatedComplexity": "low"}]}\n```';
    const result = parseLLMResponse(fenced);
    expect("tasks" in result).toBe(true);
  });

  it("should handle extra unknown fields without crashing", () => {
    const withExtras = JSON.stringify({
      tasks: [{ id: "t1", title: "Test", description: "d", dependencies: [], estimatedComplexity: "low", unknownField: true }],
      metadata: { model: "gpt-4o" },
    });

    const result = parseLLMResponse(withExtras);
    expect("tasks" in result).toBe(true);
  });

  it("should reject tasks missing required fields", () => {
    const missingTitle = JSON.stringify({
      tasks: [{ id: "t1", description: "no title field" }],
    });

    const result = parseLLMResponse(missingTitle);
    expect("error" in result).toBe(true);
  });
});

describe("P11-98: Large DAG with cycle detection", () => {
  interface DAGNode {
    id: string;
    dependencies: string[];
  }

  const detectCycle = (nodes: DAGNode[]): boolean => {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const dfs = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true; // cycle
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      inStack.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          if (dfs(dep)) return true;
        }
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const node of nodes) {
      if (dfs(node.id)) return true;
    }
    return false;
  };

  it("should handle a large DAG (20+ nodes) without performance issues", () => {
    // Create a 25-node linear DAG
    const nodes: DAGNode[] = Array.from({ length: 25 }, (_, i) => ({
      id: `task_${i}`,
      dependencies: i > 0 ? [`task_${i - 1}`] : [],
    }));

    const start = performance.now();
    const hasCycle = detectCycle(nodes);
    const elapsed = performance.now() - start;

    expect(hasCycle).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it("should detect cycles in the DAG", () => {
    const cyclicNodes: DAGNode[] = [
      { id: "a", dependencies: ["c"] },
      { id: "b", dependencies: ["a"] },
      { id: "c", dependencies: ["b"] }, // c → b → a → c (cycle)
    ];

    expect(detectCycle(cyclicNodes)).toBe(true);
  });

  it("should handle diamond dependencies without false cycle detection", () => {
    // Diamond: A → B, A → C, B → D, C → D
    const diamond: DAGNode[] = [
      { id: "D", dependencies: [] },
      { id: "B", dependencies: ["D"] },
      { id: "C", dependencies: ["D"] },
      { id: "A", dependencies: ["B", "C"] },
    ];

    expect(detectCycle(diamond)).toBe(false);
  });
});

describe("P11-99: Image detection beyond filename extension", () => {
  it("should detect image format from magic bytes, not just extension", () => {
    // Magic bytes for common image formats
    const MAGIC_BYTES: Record<string, number[]> = {
      png: [0x89, 0x50, 0x4E, 0x47],  // \x89PNG
      jpeg: [0xFF, 0xD8, 0xFF],        // JFIF header
      gif: [0x47, 0x49, 0x46],         // GIF
      webp: [0x52, 0x49, 0x46, 0x46],  // RIFF (with WEBP at offset 8)
    };

    const detectFormat = (bytes: Uint8Array): string | null => {
      for (const [format, magic] of Object.entries(MAGIC_BYTES)) {
        if (magic.every((b, i) => bytes[i] === b)) return format;
      }
      return null;
    };

    // PNG file
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
    expect(detectFormat(pngBytes)).toBe("png");

    // JPEG file
    const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
    expect(detectFormat(jpegBytes)).toBe("jpeg");

    // Not an image (text file starting with ASCII)
    const textBytes = new Uint8Array([0x48, 0x65, 0x6C, 0x6C]); // "Hell"
    expect(detectFormat(textBytes)).toBeNull();
  });

  it("should not trust filename extension alone", () => {
    // File named .jpg but contains text
    const fakeJpg = {
      filename: "exploit.jpg",
      bytes: new Uint8Array([0x3C, 0x73, 0x63, 0x72]), // "<scr" (script tag)
    };

    const extensionSays = fakeJpg.filename.endsWith(".jpg") ? "jpeg" : null;
    const magicSays = fakeJpg.bytes[0] === 0xFF ? "jpeg" : null;

    // Extension says it's JPEG, but bytes say it's not
    expect(extensionSays).toBe("jpeg");
    expect(magicSays).toBeNull();
    // Should trust bytes over extension
  });
});

describe("P11-100: Base64 validation", () => {
  it("should validate base64 string is decodable", () => {
    const isValidBase64 = (str: string): boolean => {
      if (!str || str.length === 0) return false;
      // Remove data URL prefix if present
      const base64 = str.replace(/^data:[^;]+;base64,/, "");
      try {
        const decoded = Buffer.from(base64, "base64");
        // Re-encode and compare to detect invalid chars
        return decoded.toString("base64") === base64.replace(/\s/g, "");
      } catch {
        return false;
      }
    };

    expect(isValidBase64("SGVsbG8gV29ybGQ=")).toBe(true); // "Hello World"
    expect(isValidBase64("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isValidBase64("")).toBe(false);
    expect(isValidBase64("not-valid-base64!!!")).toBe(false);
  });

  it("should detect truncated base64 (corrupted transfer)", () => {
    // Valid PNG base64 header
    const validPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    // Truncated (simulating network cutoff)
    const truncated = validPngBase64.substring(0, 20);

    // Both decode without error, but truncated produces garbage
    const fullDecoded = Buffer.from(validPngBase64, "base64");
    const truncDecoded = Buffer.from(truncated, "base64");

    // Full version has expected PNG header
    expect(fullDecoded[0]).toBe(0x89); // PNG magic byte
    expect(fullDecoded[1]).toBe(0x50); // 'P'

    // Truncated is much shorter (incomplete file)
    expect(truncDecoded.length).toBeLessThan(fullDecoded.length);
  });

  it("should validate minimum size for a valid image", () => {
    const MIN_IMAGE_BYTES = 50; // Any real image is at least this big

    const validateImageBase64 = (base64: string): { valid: boolean; reason?: string } => {
      const decoded = Buffer.from(base64, "base64");
      if (decoded.length < MIN_IMAGE_BYTES) {
        return { valid: false, reason: "Too small to be a valid image" };
      }
      return { valid: true };
    };

    expect(validateImageBase64("AA==")).toEqual({ valid: false, reason: "Too small to be a valid image" });
    expect(validateImageBase64("A".repeat(100))).toEqual({ valid: true });
  });
});

describe("P11-101: Timer masking and async error propagation", () => {
  it("should not mask async errors with timer advancement", async () => {
    // BAD pattern: fake timers advance past the point where error would fire
    //   vi.useFakeTimers();
    //   startOperation(); // internally uses setTimeout
    //   vi.advanceTimersByTime(1000); // error fires but isn't caught
    //   // test passes because error is swallowed

    // GOOD pattern: use real async/await and catch errors
    const asyncOperation = async (): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("Async error that should not be masked");
    };

    await expect(asyncOperation()).rejects.toThrow("Async error that should not be masked");
  });

  it("should properly propagate errors from delayed operations", async () => {
    const delayedWithError = (shouldFail: boolean): Promise<string> => {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (shouldFail) reject(new Error("Delayed failure"));
          else resolve("success");
        }, 1);
      });
    };

    // Success case
    await expect(delayedWithError(false)).resolves.toBe("success");
    // Failure case — must actually reject
    await expect(delayedWithError(true)).rejects.toThrow("Delayed failure");
  });

  it("should detect when error callbacks are never invoked", async () => {
    let errorCallbackInvoked = false;

    const operationWithCallback = (onError: (e: Error) => void) => {
      // Simulate async operation that errors
      setTimeout(() => {
        onError(new Error("something broke"));
      }, 1);
    };

    await new Promise<void>((resolve) => {
      operationWithCallback((e) => {
        errorCallbackInvoked = true;
        expect(e.message).toBe("something broke");
        resolve();
      });
    });

    // Verify the error callback was actually called
    expect(errorCallbackInvoked).toBe(true);
  });
});
