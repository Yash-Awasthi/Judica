import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/processors/pdf.processor.js", () => ({ processPDF: vi.fn() }));
vi.mock("../../src/processors/docx.processor.js", () => ({ processDOCX: vi.fn() }));
vi.mock("../../src/processors/xlsx.processor.js", () => ({ processXLSX: vi.fn() }));
vi.mock("../../src/processors/csv.processor.js", () => ({ processCSV: vi.fn() }));
vi.mock("../../src/processors/txt.processor.js", () => ({ processTXT: vi.fn() }));
vi.mock("../../src/processors/image.processor.js", () => ({ processImage: vi.fn() }));

import { processFile } from "../../src/processors/router.processor.js";
import { processPDF } from "../../src/processors/pdf.processor.js";
import { processDOCX } from "../../src/processors/docx.processor.js";
import { processXLSX } from "../../src/processors/xlsx.processor.js";
import { processCSV } from "../../src/processors/csv.processor.js";
import { processTXT } from "../../src/processors/txt.processor.js";
import { processImage } from "../../src/processors/image.processor.js";

function makeUpload(mimeType: string) {
  return { id: "u1", mimeType, storagePath: "/tmp/file", originalName: "file" };
}

const fakeResult = { text: "content", pages: 1 };

describe("router.processor - processFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches application/pdf to processPDF", async () => {
    vi.mocked(processPDF).mockResolvedValue(fakeResult as any);
    const result = await processFile(makeUpload("application/pdf"));
    expect(processPDF).toHaveBeenCalledWith("/tmp/file");
    expect(result).toEqual(fakeResult);
  });

  it("dispatches DOCX mime type to processDOCX", async () => {
    vi.mocked(processDOCX).mockResolvedValue(fakeResult as any);
    const result = await processFile(
      makeUpload("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    );
    expect(processDOCX).toHaveBeenCalledWith("/tmp/file");
    expect(result).toEqual(fakeResult);
  });

  it("dispatches application/msword to processDOCX", async () => {
    vi.mocked(processDOCX).mockResolvedValue(fakeResult as any);
    const result = await processFile(makeUpload("application/msword"));
    expect(processDOCX).toHaveBeenCalledWith("/tmp/file");
    expect(result).toEqual(fakeResult);
  });

  it("dispatches XLSX mime type to processXLSX", async () => {
    vi.mocked(processXLSX).mockResolvedValue(fakeResult as any);
    const result = await processFile(
      makeUpload("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    );
    expect(processXLSX).toHaveBeenCalledWith("/tmp/file");
    expect(result).toEqual(fakeResult);
  });

  it("dispatches application/vnd.ms-excel to processXLSX", async () => {
    vi.mocked(processXLSX).mockResolvedValue(fakeResult as any);
    const result = await processFile(makeUpload("application/vnd.ms-excel"));
    expect(processXLSX).toHaveBeenCalledWith("/tmp/file");
    expect(result).toEqual(fakeResult);
  });

  it("dispatches text/csv to processCSV", async () => {
    vi.mocked(processCSV).mockResolvedValue(fakeResult as any);
    const result = await processFile(makeUpload("text/csv"));
    expect(processCSV).toHaveBeenCalledWith("/tmp/file");
    expect(result).toEqual(fakeResult);
  });

  it("dispatches text/plain to processTXT", async () => {
    vi.mocked(processTXT).mockResolvedValue(fakeResult as any);
    const result = await processFile(makeUpload("text/plain"));
    expect(processTXT).toHaveBeenCalledWith("/tmp/file");
    expect(result).toEqual(fakeResult);
  });

  it("dispatches image/* to processImage with mimeType", async () => {
    vi.mocked(processImage).mockResolvedValue(fakeResult as any);
    const result = await processFile(makeUpload("image/png"));
    expect(processImage).toHaveBeenCalledWith("/tmp/file", "image/png");
    expect(result).toEqual(fakeResult);
  });

  it("falls back to processTXT for unknown mime type", async () => {
    vi.mocked(processTXT).mockResolvedValue(fakeResult as any);
    const result = await processFile(makeUpload("application/octet-stream"));
    expect(processTXT).toHaveBeenCalledWith("/tmp/file");
    expect(result).toEqual(fakeResult);
  });

  it("throws Unsupported file type when fallback TXT also fails", async () => {
    vi.mocked(processTXT).mockImplementation(() => {
      throw new Error("cannot read");
    });
    await expect(processFile(makeUpload("application/octet-stream"))).rejects.toThrow(
      "Unsupported file type: application/octet-stream",
    );
  });
});
