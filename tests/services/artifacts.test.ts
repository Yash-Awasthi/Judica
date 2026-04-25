import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "artifact-uuid-1" }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([
          { id: "art-1", type: "code", name: "Snippet", content: "console.log('hi')" },
          { id: "art-2", type: "markdown", name: "Doc", content: "# Title" },
        ]),
      })),
    })),
  },
}));

vi.mock("../../src/db/schema/research.js", () => ({
  artifacts: {
    id: "id",
    userId: "userId",
    conversationId: "conversationId",
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "artifact-uuid-1"),
}));

import { detectArtifact, saveArtifact } from "../../src/services/artifacts.service.js";
import { db } from "../../src/lib/drizzle.js";

describe("Artifacts Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detectArtifact", () => {
    it("detects a code block artifact with 20+ lines", () => {
      const code = Array.from({ length: 25 }, (_, i) => `  line ${i + 1}`).join("\n");
      const response = `Here is some code:\n\`\`\`typescript\n${code}\n\`\`\`\nDone.`;

      const artifact = detectArtifact(response);

      expect(artifact).not.toBeNull();
      expect(artifact!.type).toBe("code");
      expect(artifact!.language).toBe("typescript");
      expect(artifact!.content).toContain("line 1");
    });

    it("returns null for short code blocks (< 20 lines)", () => {
      const response = "```js\nconsole.log('hi');\n```";
      const artifact = detectArtifact(response);
      expect(artifact).toBeNull();
    });

    it("detects an HTML document artifact", () => {
      const response = `<!DOCTYPE html>\n<html><head><title>Test</title></head><body><p>Hello</p></body></html>`;
      const artifact = detectArtifact(response);

      expect(artifact).not.toBeNull();
      expect(artifact!.type).toBe("html");
      expect(artifact!.name).toBe("HTML Document");
    });

    it("detects a JSON artifact when response is pure large JSON", () => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < 20; i++) obj[`key${i}`] = `value${i}`;
      const response = JSON.stringify(obj);

      const artifact = detectArtifact(response);

      expect(artifact).not.toBeNull();
      expect(artifact!.type).toBe("json");
      expect(artifact!.name).toBe("JSON Data");
    });

    it("detects a structured markdown document", () => {
      const response =
        "# Introduction\n\n" +
        "A".repeat(200) +
        "\n\n## Section Two\n\n" +
        "B".repeat(200) +
        "\n\n### Subsection\n\n" +
        "C".repeat(200);

      const artifact = detectArtifact(response);

      expect(artifact).not.toBeNull();
      expect(artifact!.type).toBe("markdown");
      expect(artifact!.name).toBe("Document");
    });

    it("returns null for plain short text", () => {
      const artifact = detectArtifact("This is a simple text response.");
      expect(artifact).toBeNull();
    });

    it("returns null for small JSON objects", () => {
      const artifact = detectArtifact('{"ok": true}');
      expect(artifact).toBeNull();
    });
  });

  describe("saveArtifact", () => {
    it("stores artifact in the database and returns id", async () => {
      const artifact = {
        name: "Code snippet (typescript)",
        type: "code" as const,
        content: "const x = 1;",
        language: "typescript",
      };

      const id = await saveArtifact(1, "conv-123", artifact);

      expect(id).toBe("artifact-uuid-1");
      expect(db.insert).toHaveBeenCalled();
    });

    it("stores artifact with null conversationId", async () => {
      const artifact = {
        name: "JSON Data",
        type: "json" as const,
        content: '{"key": "value"}',
      };

      const id = await saveArtifact(2, null, artifact);

      expect(id).toBe("artifact-uuid-1");
      expect(db.insert).toHaveBeenCalled();
    });
  });
});
