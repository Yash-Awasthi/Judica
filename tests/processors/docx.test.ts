import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("mammoth", () => ({
  extractRawText: vi.fn(),
}));

import * as mammoth from "mammoth";
import { processDOCX } from "../../src/processors/docx.processor.js";

const mockedMammoth = vi.mocked(mammoth);

describe("processDOCX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertFileSizeLimit.mockImplementation(() => {});
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
    mockAssertFileSizeLimit.mockImplementation(() => {
      throw new Error("File too large for processing: 200.0MB exceeds the 100MB limit");
    });

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
