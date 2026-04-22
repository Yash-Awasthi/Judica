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

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));

import pdfParse from "pdf-parse";
import { processPDF } from "../../src/processors/pdf.processor.js";

const mockedPdfParse = vi.mocked(pdfParse);

describe("processPDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertFileSizeLimit.mockImplementation(() => {});
  });

  it("should return extracted text and page count from a PDF", async () => {
    const fakeBuffer = Buffer.from("fake pdf content");
    mockReadFile.mockResolvedValue(fakeBuffer);
    mockedPdfParse.mockResolvedValue({
      text: "Hello from PDF",
      numpages: 3,
    } as any);

    const result = await processPDF("/tmp/test.pdf");

    expect(result.type).toBe("text");
    expect(result.text).toBe("Hello from PDF");
    expect(result.metadata).toEqual({ pages: 3 });
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/test.pdf");
  });

  it("should strip non-printable characters from text", async () => {
    const fakeBuffer = Buffer.from("fake");
    mockReadFile.mockResolvedValue(fakeBuffer);
    mockedPdfParse.mockResolvedValue({
      text: "Hello\x00World\x01Test",
      numpages: 1,
    } as any);

    const result = await processPDF("/tmp/special.pdf");

    expect(result.text).toBe("Hello World Test");
  });

  it("should trim whitespace from resulting text", async () => {
    const fakeBuffer = Buffer.from("fake");
    mockReadFile.mockResolvedValue(fakeBuffer);
    mockedPdfParse.mockResolvedValue({
      text: "  some text  \n\n",
      numpages: 1,
    } as any);

    const result = await processPDF("/tmp/trim.pdf");

    expect(result.text).toBe("some text");
  });

  it("should throw when file exceeds size limit", async () => {
    mockAssertFileSizeLimit.mockImplementation(() => {
      throw new Error("File too large for processing: 200.0MB exceeds the 100MB limit");
    });

    await expect(processPDF("/tmp/huge.pdf")).rejects.toThrow(
      /File too large/
    );
  });

  it("should propagate pdf-parse errors", async () => {
    const fakeBuffer = Buffer.from("bad");
    mockReadFile.mockResolvedValue(fakeBuffer);
    mockedPdfParse.mockRejectedValue(new Error("Corrupt PDF"));

    await expect(processPDF("/tmp/bad.pdf")).rejects.toThrow("Corrupt PDF");
  });
});
