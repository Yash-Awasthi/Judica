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

vi.mock("papaparse", () => ({
  default: {
    parse: vi.fn(),
  },
}));

const mockedFs = vi.mocked(fs);

import Papa from "papaparse";
import { processCSV } from "../../src/processors/csv.processor.js";

const mockedPapa = vi.mocked(Papa);

describe("processCSV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.statSync.mockReturnValue({ size: 1024 } as any);
  });

  it("should return a spreadsheet type with markdown table for valid CSV", async () => {
    const csvContent = "name,age\nAlice,30\nBob,25";
    mockedFs.readFileSync.mockReturnValue(csvContent);
    mockedPapa.parse.mockReturnValue({
      data: [
        { name: "Alice", age: "30" },
        { name: "Bob", age: "25" },
      ],
    } as any);

    const result = await processCSV("/tmp/test.csv");

    expect(result.type).toBe("spreadsheet");
    expect(result.text).toContain("| name | age |");
    expect(result.text).toContain("| Alice | 30 |");
    expect(result.text).toContain("| Bob | 25 |");
    expect(result.metadata).toEqual({ rows: 2, truncated: false });
    expect(mockedFs.readFileSync).toHaveBeenCalledWith("/tmp/test.csv", "utf-8");
    expect(mockedPapa.parse).toHaveBeenCalledWith(csvContent, {
      header: true,
      skipEmptyLines: true,
    });
  });

  it("should return raw text when CSV has no data rows", async () => {
    const csvContent = "name,age";
    mockedFs.readFileSync.mockReturnValue(csvContent);
    mockedPapa.parse.mockReturnValue({ data: [] } as any);

    const result = await processCSV("/tmp/empty.csv");

    expect(result.type).toBe("text");
    expect(result.text).toBe(csvContent);
    expect(result.metadata).toEqual({ rows: 0 });
  });

  it("should truncate rows beyond 500 and set truncated flag", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ id: String(i) }));
    mockedFs.readFileSync.mockReturnValue("id\n" + rows.map((r) => r.id).join("\n"));
    mockedPapa.parse.mockReturnValue({ data: rows } as any);

    const result = await processCSV("/tmp/large.csv");

    expect(result.type).toBe("spreadsheet");
    expect(result.metadata).toEqual({ rows: 600, truncated: true });
    // header + separator + 500 data rows = 502 lines
    const lines = result.text!.split("\n");
    expect(lines.length).toBe(502);
  });

  it("should throw when file exceeds size limit", async () => {
    mockedFs.statSync.mockReturnValue({ size: 200 * 1024 * 1024 } as any);

    await expect(processCSV("/tmp/huge.csv")).rejects.toThrow(/File too large/);
  });
});
