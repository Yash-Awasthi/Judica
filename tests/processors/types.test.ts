import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStat } = vi.hoisted(() => ({
  mockStat: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    stat: mockStat,
  },
  stat: mockStat,
}));

import { assertFileSizeLimit } from "../../src/processors/types.js";

describe("assertFileSizeLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not throw when file size is within the limit", async () => {
    mockStat.mockResolvedValue({ size: 50 * 1024 * 1024 });

    await expect(assertFileSizeLimit("/tmp/small-file.txt")).resolves.toBeUndefined();
    expect(mockStat).toHaveBeenCalledWith("/tmp/small-file.txt");
  });

  it("should not throw when file size is exactly at the limit", async () => {
    mockStat.mockResolvedValue({ size: 100 * 1024 * 1024 });

    await expect(assertFileSizeLimit("/tmp/exact-file.txt")).resolves.toBeUndefined();
  });

  it("should throw when file size exceeds the limit", async () => {
    mockStat.mockResolvedValue({ size: 101 * 1024 * 1024 });

    await expect(assertFileSizeLimit("/tmp/large-file.txt")).rejects.toThrow(
      /File too large/
    );
  });

  it("should include file size in the error message", async () => {
    const sizeBytes = 200 * 1024 * 1024;
    mockStat.mockResolvedValue({ size: sizeBytes });

    await expect(assertFileSizeLimit("/tmp/huge-file.txt")).rejects.toThrow("200.0MB");
  });

  it("should throw for a file one byte over the limit", async () => {
    mockStat.mockResolvedValue({
      size: 100 * 1024 * 1024 + 1,
    });

    await expect(assertFileSizeLimit("/tmp/just-over.txt")).rejects.toThrow(
      /File too large/
    );
  });
});
