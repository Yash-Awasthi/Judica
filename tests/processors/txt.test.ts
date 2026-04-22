import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    readFile: mockReadFile,
  },
  readFile: mockReadFile,
}));

const { mockAssertFileSizeLimit } = vi.hoisted(() => ({
  mockAssertFileSizeLimit: vi.fn(),
}));

vi.mock("../../src/processors/types.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/processors/types.js")>();
  return {
    ...orig,
    assertFileSizeLimit: mockAssertFileSizeLimit,
  };
});

import { processTXT } from "../../src/processors/txt.processor.js";

describe("processTXT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertFileSizeLimit.mockImplementation(() => {});
  });

  it("should return text content for a normal file", async () => {
    mockReadFile.mockResolvedValue("Hello, world!");

    const result = await processTXT("/tmp/test.txt");

    expect(result.type).toBe("text");
    expect(result.text).toBe("Hello, world!");
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/test.txt", "utf-8");
  });

  it("should truncate text longer than 100k characters", async () => {
    const longText = "a".repeat(150_000);
    mockReadFile.mockResolvedValue(longText);

    const result = await processTXT("/tmp/long.txt");

    expect(result.type).toBe("text");
    expect(result.text!.length).toBeLessThan(150_000);
    expect(result.text).toContain("[... truncated at 100k chars]");
    expect(result.text!.startsWith("a".repeat(100_000))).toBe(true);
  });

  it("should not truncate text exactly at 100k characters", async () => {
    const exactText = "b".repeat(100_000);
    mockReadFile.mockResolvedValue(exactText);

    const result = await processTXT("/tmp/exact.txt");

    expect(result.text).toBe(exactText);
    expect(result.text).not.toContain("truncated");
  });

  it("should return empty text for an empty file", async () => {
    mockReadFile.mockResolvedValue("");

    const result = await processTXT("/tmp/empty.txt");

    expect(result.type).toBe("text");
    expect(result.text).toBe("");
  });

  it("should throw when file exceeds size limit", async () => {
    mockAssertFileSizeLimit.mockImplementation(() => {
      throw new Error("File too large for processing: 200.0MB exceeds the 100MB limit");
    });

    await expect(processTXT("/tmp/huge.txt")).rejects.toThrow(/File too large/);
  });
});
