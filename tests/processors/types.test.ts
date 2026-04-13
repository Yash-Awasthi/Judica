import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import { assertFileSizeLimit } from "../../src/processors/types.js";

vi.mock("fs", () => ({
  default: {
    statSync: vi.fn(),
  },
  statSync: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

describe("assertFileSizeLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not throw when file size is within the limit", () => {
    mockedFs.statSync.mockReturnValue({ size: 50 * 1024 * 1024 } as any);

    expect(() => assertFileSizeLimit("/tmp/small-file.txt")).not.toThrow();
    expect(mockedFs.statSync).toHaveBeenCalledWith("/tmp/small-file.txt");
  });

  it("should not throw when file size is exactly at the limit", () => {
    mockedFs.statSync.mockReturnValue({ size: 100 * 1024 * 1024 } as any);

    expect(() => assertFileSizeLimit("/tmp/exact-file.txt")).not.toThrow();
  });

  it("should throw when file size exceeds the limit", () => {
    mockedFs.statSync.mockReturnValue({ size: 101 * 1024 * 1024 } as any);

    expect(() => assertFileSizeLimit("/tmp/large-file.txt")).toThrow(
      /File too large/
    );
  });

  it("should include file size in the error message", () => {
    const sizeBytes = 200 * 1024 * 1024;
    mockedFs.statSync.mockReturnValue({ size: sizeBytes } as any);

    expect(() => assertFileSizeLimit("/tmp/huge-file.txt")).toThrow("200.0MB");
  });

  it("should throw for a file one byte over the limit", () => {
    mockedFs.statSync.mockReturnValue({
      size: 100 * 1024 * 1024 + 1,
    } as any);

    expect(() => assertFileSizeLimit("/tmp/just-over.txt")).toThrow(
      /File too large/
    );
  });
});
