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

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));

const mockedFs = vi.mocked(fs);

import pdfParse from "pdf-parse";
import { processPDF } from "../../src/processors/pdf.processor.js";

const mockedPdfParse = vi.mocked(pdfParse);

describe("processPDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.statSync.mockReturnValue({ size: 1024 } as any);
  });

  it("should return extracted text and page count from a PDF", async () => {
    const fakeBuffer = Buffer.from("fake pdf content");
    mockedFs.readFileSync.mockReturnValue(fakeBuffer);
    mockedPdfParse.mockResolvedValue({
      text: "Hello from PDF",
      numpages: 3,
    } as any);

    const result = await processPDF("/tmp/test.pdf");

    expect(result.type).toBe("text");
    expect(result.text).toBe("Hello from PDF");
    expect(result.metadata).toEqual({ pages: 3 });
    expect(mockedFs.readFileSync).toHaveBeenCalledWith("/tmp/test.pdf");
  });

  it("should strip non-printable characters from text", async () => {
    const fakeBuffer = Buffer.from("fake");
    mockedFs.readFileSync.mockReturnValue(fakeBuffer);
    mockedPdfParse.mockResolvedValue({
      text: "Hello\x00World\x01Test",
      numpages: 1,
    } as any);

    const result = await processPDF("/tmp/special.pdf");

    expect(result.text).toBe("Hello World Test");
  });

  it("should trim whitespace from resulting text", async () => {
    const fakeBuffer = Buffer.from("fake");
    mockedFs.readFileSync.mockReturnValue(fakeBuffer);
    mockedPdfParse.mockResolvedValue({
      text: "  some text  \n\n",
      numpages: 1,
    } as any);

    const result = await processPDF("/tmp/trim.pdf");

    expect(result.text).toBe("some text");
  });

  it("should throw when file exceeds size limit", async () => {
    mockedFs.statSync.mockReturnValue({ size: 200 * 1024 * 1024 } as any);

    await expect(processPDF("/tmp/huge.pdf")).rejects.toThrow(
      /File too large/
    );
  });

  it("should propagate pdf-parse errors", async () => {
    const fakeBuffer = Buffer.from("bad");
    mockedFs.readFileSync.mockReturnValue(fakeBuffer);
    mockedPdfParse.mockRejectedValue(new Error("Corrupt PDF"));

    await expect(processPDF("/tmp/bad.pdf")).rejects.toThrow("Corrupt PDF");
  });
});
