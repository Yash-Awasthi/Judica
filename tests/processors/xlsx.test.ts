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

vi.mock("xlsx", () => ({
  read: vi.fn(),
  utils: {
    sheet_to_csv: vi.fn(),
  },
}));

const mockedFs = vi.mocked(fs);

import * as XLSX from "xlsx";
import { processXLSX } from "../../src/processors/xlsx.processor.js";

const mockedXLSX = vi.mocked(XLSX);

describe("processXLSX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.statSync.mockReturnValue({ size: 1024 } as any);
  });

  it("should return spreadsheet with single sheet content", async () => {
    const fakeBuffer = Buffer.from("fake xlsx");
    mockedFs.readFileSync.mockReturnValue(fakeBuffer);
    mockedXLSX.read.mockReturnValue({
      SheetNames: ["Sheet1"],
      Sheets: { Sheet1: {} },
    } as any);
    mockedXLSX.utils.sheet_to_csv.mockReturnValue("name,age\nAlice,30");

    const result = await processXLSX("/tmp/test.xlsx");

    expect(result.type).toBe("spreadsheet");
    expect(result.text).toContain("=== Sheet: Sheet1 ===");
    expect(result.text).toContain("name,age\nAlice,30");
    expect(result.metadata).toEqual({ sheets: ["Sheet1"] });
    expect(mockedFs.readFileSync).toHaveBeenCalledWith("/tmp/test.xlsx");
    expect(mockedXLSX.read).toHaveBeenCalledWith(fakeBuffer, { type: "buffer" });
  });

  it("should handle multiple sheets", async () => {
    const fakeBuffer = Buffer.from("fake xlsx");
    mockedFs.readFileSync.mockReturnValue(fakeBuffer);
    mockedXLSX.read.mockReturnValue({
      SheetNames: ["Data", "Summary"],
      Sheets: { Data: {}, Summary: {} },
    } as any);
    mockedXLSX.utils.sheet_to_csv
      .mockReturnValueOnce("id,value\n1,100")
      .mockReturnValueOnce("total\n100");

    const result = await processXLSX("/tmp/multi.xlsx");

    expect(result.type).toBe("spreadsheet");
    expect(result.text).toContain("=== Sheet: Data ===");
    expect(result.text).toContain("=== Sheet: Summary ===");
    expect(result.text).toContain("id,value\n1,100");
    expect(result.text).toContain("total\n100");
    expect(result.metadata).toEqual({ sheets: ["Data", "Summary"] });
  });

  it("should separate sheets with double newline", async () => {
    const fakeBuffer = Buffer.from("fake");
    mockedFs.readFileSync.mockReturnValue(fakeBuffer);
    mockedXLSX.read.mockReturnValue({
      SheetNames: ["A", "B"],
      Sheets: { A: {}, B: {} },
    } as any);
    mockedXLSX.utils.sheet_to_csv
      .mockReturnValueOnce("col1\nval1")
      .mockReturnValueOnce("col2\nval2");

    const result = await processXLSX("/tmp/sep.xlsx");

    expect(result.text).toBe(
      "=== Sheet: A ===\ncol1\nval1\n\n=== Sheet: B ===\ncol2\nval2"
    );
  });

  it("should throw when file exceeds size limit", async () => {
    mockedFs.statSync.mockReturnValue({ size: 200 * 1024 * 1024 } as any);

    await expect(processXLSX("/tmp/huge.xlsx")).rejects.toThrow(
      /File too large/
    );
  });
});
