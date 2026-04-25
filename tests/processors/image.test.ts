import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => {
  const stat = vi.fn();
  const readFile = vi.fn();
  const open = vi.fn();
  return {
    default: { stat, readFile, open },
    stat,
    readFile,
    open,
  };
});

vi.mock("../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processImage } from "../../../src/processors/image.processor.js";
import fs from "fs/promises";

const mockFs = vi.mocked(fs);

describe("image.processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a ProcessedFile with type 'image' and base64 data", async () => {
    const imageBuffer = Buffer.from("fake-png-data");
    mockFs.stat.mockResolvedValue({ size: 100 } as any);
    mockFs.readFile.mockResolvedValue(imageBuffer);

    const result = await processImage("/tmp/test.png", "image/png");

    expect(result.type).toBe("image");
    expect(result.base64).toBe(imageBuffer.toString("base64"));
    expect(result.mimeType).toBe("image/png");
  });

  it("returns the correct mimeType", async () => {
    mockFs.stat.mockResolvedValue({ size: 200 } as any);
    mockFs.readFile.mockResolvedValue(Buffer.from("jpeg-data"));

    const result = await processImage("/tmp/photo.jpg", "image/jpeg");
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("handles WebP images", async () => {
    mockFs.stat.mockResolvedValue({ size: 500 } as any);
    mockFs.readFile.mockResolvedValue(Buffer.from("webp-data"));

    const result = await processImage("/path/to/img.webp", "image/webp");
    expect(result.type).toBe("image");
    expect(result.mimeType).toBe("image/webp");
  });

  it("throws when file exceeds 100 MB size limit", async () => {
    const oversizeBytes = 101 * 1024 * 1024;
    mockFs.stat.mockResolvedValue({ size: oversizeBytes } as any);

    await expect(processImage("/tmp/huge.png", "image/png")).rejects.toThrow(
      "File too large"
    );
    // readFile should NOT be called for oversized files
    expect(mockFs.readFile).not.toHaveBeenCalled();
  });

  it("encodes binary data to base64 correctly", async () => {
    const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    mockFs.stat.mockResolvedValue({ size: 4 } as any);
    mockFs.readFile.mockResolvedValue(binaryData);

    const result = await processImage("/tmp/real.png", "image/png");
    expect(result.base64).toBe(binaryData.toString("base64"));
    expect(result.base64).toBe("iVBORw==");
  });

  it("propagates errors from readFile", async () => {
    mockFs.stat.mockResolvedValue({ size: 100 } as any);
    mockFs.readFile.mockRejectedValue(new Error("ENOENT: file not found"));

    await expect(processImage("/tmp/missing.png", "image/png")).rejects.toThrow(
      "ENOENT"
    );
  });

  it("uses the provided filePath when reading", async () => {
    mockFs.stat.mockResolvedValue({ size: 50 } as any);
    mockFs.readFile.mockResolvedValue(Buffer.from("data"));

    await processImage("/custom/path/image.gif", "image/gif");

    expect(mockFs.readFile).toHaveBeenCalledWith("/custom/path/image.gif");
  });
});
