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

const mockXlsxReadFile = vi.fn();
const mockWorksheets: any[] = [];

vi.mock("exceljs", () => {
  class MockWorkbook {
    xlsx = { readFile: (...args: any[]) => mockXlsxReadFile(...args) };
    get worksheets() {
      return mockWorksheets;
    }
  }
  return {
    default: {
      Workbook: MockWorkbook,
    },
  };
});

import { processXLSX } from "../../src/processors/xlsx.processor.js";

describe("processXLSX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertFileSizeLimit.mockImplementation(() => {});
    mockWorksheets.length = 0;
  });

  it("should return spreadsheet with single sheet content", async () => {
    mockXlsxReadFile.mockResolvedValue(undefined);
    mockWorksheets.push({
      name: "Sheet1",
      eachRow: (cb: any) => {
        cb({ values: [undefined, "name", "age"] });
        cb({ values: [undefined, "Alice", 30] });
      },
    });

    const result = await processXLSX("/tmp/test.xlsx");

    expect(result.type).toBe("spreadsheet");
    expect(result.text).toContain("=== Sheet: Sheet1 ===");
    expect(result.text).toContain("name,age");
    expect(result.text).toContain("Alice,30");
    expect(result.metadata).toEqual({ sheets: ["Sheet1"] });
  });

  it("should handle multiple sheets", async () => {
    mockXlsxReadFile.mockResolvedValue(undefined);
    mockWorksheets.push(
      {
        name: "Data",
        eachRow: (cb: any) => {
          cb({ values: [undefined, "id", "value"] });
          cb({ values: [undefined, 1, 100] });
        },
      },
      {
        name: "Summary",
        eachRow: (cb: any) => {
          cb({ values: [undefined, "total"] });
          cb({ values: [undefined, 100] });
        },
      }
    );

    const result = await processXLSX("/tmp/multi.xlsx");

    expect(result.type).toBe("spreadsheet");
    expect(result.text).toContain("=== Sheet: Data ===");
    expect(result.text).toContain("=== Sheet: Summary ===");
    expect(result.text).toContain("id,value");
    expect(result.text).toContain("total");
    expect(result.metadata).toEqual({ sheets: ["Data", "Summary"] });
  });

  it("should separate sheets with double newline", async () => {
    mockXlsxReadFile.mockResolvedValue(undefined);
    mockWorksheets.push(
      {
        name: "A",
        eachRow: (cb: any) => {
          cb({ values: [undefined, "col1"] });
          cb({ values: [undefined, "val1"] });
        },
      },
      {
        name: "B",
        eachRow: (cb: any) => {
          cb({ values: [undefined, "col2"] });
          cb({ values: [undefined, "val2"] });
        },
      }
    );

    const result = await processXLSX("/tmp/sep.xlsx");

    expect(result.text).toBe(
      "=== Sheet: A ===\ncol1\nval1\n\n=== Sheet: B ===\ncol2\nval2"
    );
  });

  it("should throw when file exceeds size limit", async () => {
    mockAssertFileSizeLimit.mockImplementation(() => {
      throw new Error("File too large for processing: 200.0MB exceeds the 100MB limit");
    });

    await expect(processXLSX("/tmp/huge.xlsx")).rejects.toThrow(
      /File too large/
    );
  });
});
