import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

vi.mock("fs", () => ({
  default: {
    statSync: vi.fn(),
  },
  statSync: vi.fn(),
}));

vi.mock("mammoth", () => ({
  extractRawText: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

import * as mammoth from "mammoth";
import { processDOCX } from "../../src/processors/docx.processor.js";

const mockedMammoth = vi.mocked(mammoth);

describe("processDOCX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.statSync.mockReturnValue({ size: 1024 } as any);
  });

  it("should return extracted text from a DOCX file", async () => {
    mockedMammoth.extractRawText.mockResolvedValue({
      value: "  Document content here  ",
      messages: [],
    });

    const result = await processDOCX("/tmp/test.docx");

    expect(result.type).toBe("text");
    expect(result.text).toBe("Document content here");
    expect(mockedMammoth.extractRawText).toHaveBeenCalledWith({
      path: "/tmp/test.docx",
    });
  });

  it("should trim whitespace from extracted text", async () => {
    mockedMammoth.extractRawText.mockResolvedValue({
      value: "\n\n  Some text \n\n",
      messages: [],
    });

    const result = await processDOCX("/tmp/whitespace.docx");

    expect(result.text).toBe("Some text");
  });

  it("should handle empty document content", async () => {
    mockedMammoth.extractRawText.mockResolvedValue({
      value: "   ",
      messages: [],
    });

    const result = await processDOCX("/tmp/empty.docx");

    expect(result.type).toBe("text");
    expect(result.text).toBe("");
  });

  it("should throw when file exceeds size limit", async () => {
    mockedFs.statSync.mockReturnValue({ size: 200 * 1024 * 1024 } as any);

    await expect(processDOCX("/tmp/huge.docx")).rejects.toThrow(
      /File too large/
    );
  });

  it("should propagate mammoth errors", async () => {
    mockedMammoth.extractRawText.mockRejectedValue(
      new Error("Corrupt DOCX")
    );

    await expect(processDOCX("/tmp/bad.docx")).rejects.toThrow("Corrupt DOCX");
  });
});
