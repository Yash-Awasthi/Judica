import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStat, mockReadFile } = vi.hoisted(() => ({
  mockStat: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  default: {
    stat: mockStat,
    readFile: mockReadFile,
  },
  stat: mockStat,
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

vi.mock("papaparse", () => ({
  default: {
    parse: vi.fn(),
  },
}));

import Papa from "papaparse";
import { processCSV } from "../../src/processors/csv.processor.js";

const mockedPapa = vi.mocked(Papa);

describe("processCSV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertFileSizeLimit.mockImplementation(() => {});
  });

  it("should return a spreadsheet type with markdown table for valid CSV", async () => {
    const csvContent = "name,age\nAlice,30\nBob,25";
    mockReadFile.mockResolvedValue(csvContent);
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
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/test.csv", "utf-8");
    expect(mockedPapa.parse).toHaveBeenCalledWith(csvContent, {
      header: true,
      skipEmptyLines: true,
    });
  });

  it("should return raw text when CSV has no data rows", async () => {
    const csvContent = "name,age";
    mockReadFile.mockResolvedValue(csvContent);
    mockedPapa.parse.mockReturnValue({ data: [] } as any);

    const result = await processCSV("/tmp/empty.csv");

    expect(result.type).toBe("text");
    expect(result.text).toBe(csvContent);
    expect(result.metadata).toEqual({ rows: 0 });
  });

  it("should truncate rows beyond 500 and set truncated flag", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ id: String(i) }));
    mockReadFile.mockResolvedValue("id\n" + rows.map((r) => r.id).join("\n"));
    mockedPapa.parse.mockReturnValue({ data: rows } as any);

    const result = await processCSV("/tmp/large.csv");

    expect(result.type).toBe("spreadsheet");
    expect(result.metadata).toEqual({ rows: 600, truncated: true });
    // header + separator + 500 data rows = 502 lines
    const lines = result.text!.split("\n");
    expect(lines.length).toBe(502);
  });

  it("should throw when file exceeds size limit", async () => {
    mockAssertFileSizeLimit.mockImplementation(() => {
      throw new Error("File too large for processing: 200.0MB exceeds the 100MB limit");
    });

    await expect(processCSV("/tmp/huge.csv")).rejects.toThrow(/File too large/);
  });
});
