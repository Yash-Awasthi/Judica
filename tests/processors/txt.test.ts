import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

vi.mock("fs", () => ({
  default: {
    statSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

import { processTXT } from "../../src/processors/txt.processor.js";

describe("processTXT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.statSync.mockReturnValue({ size: 1024 } as any);
  });

  it("should return text content for a normal file", async () => {
    mockedFs.readFileSync.mockReturnValue("Hello, world!");

    const result = await processTXT("/tmp/test.txt");

    expect(result.type).toBe("text");
    expect(result.text).toBe("Hello, world!");
    expect(mockedFs.readFileSync).toHaveBeenCalledWith("/tmp/test.txt", "utf-8");
  });

  it("should truncate text longer than 100k characters", async () => {
    const longText = "a".repeat(150_000);
    mockedFs.readFileSync.mockReturnValue(longText);

    const result = await processTXT("/tmp/long.txt");

    expect(result.type).toBe("text");
    expect(result.text!.length).toBeLessThan(150_000);
    expect(result.text).toContain("[... truncated at 100k chars]");
    expect(result.text!.startsWith("a".repeat(100_000))).toBe(true);
  });

  it("should not truncate text exactly at 100k characters", async () => {
    const exactText = "b".repeat(100_000);
    mockedFs.readFileSync.mockReturnValue(exactText);

    const result = await processTXT("/tmp/exact.txt");

    expect(result.text).toBe(exactText);
    expect(result.text).not.toContain("truncated");
  });

  it("should return empty text for an empty file", async () => {
    mockedFs.readFileSync.mockReturnValue("");

    const result = await processTXT("/tmp/empty.txt");

    expect(result.type).toBe("text");
    expect(result.text).toBe("");
  });

  it("should throw when file exceeds size limit", async () => {
    mockedFs.statSync.mockReturnValue({ size: 200 * 1024 * 1024 } as any);

    await expect(processTXT("/tmp/huge.txt")).rejects.toThrow(/File too large/);
  });
});
