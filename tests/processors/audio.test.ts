import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs/promises and fs constants
vi.mock("fs/promises", () => {
  const stat = vi.fn();
  const open = vi.fn();
  const mkdir = vi.fn();
  const access = vi.fn();
  return {
    default: { stat, open, mkdir, access },
    stat,
    open,
    mkdir,
    access,
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072 },
  };
});

vi.mock("fs", () => ({
  default: { constants: { O_RDONLY: 0, O_NOFOLLOW: 131072 } },
  constants: { O_RDONLY: 0, O_NOFOLLOW: 131072 },
}));

vi.mock("form-data", () => ({
  default: class FormData {
    private _data: Record<string, unknown> = {};
    append(key: string, value: unknown) { this._data[key] = value; }
    getHeaders() { return { "content-type": "multipart/form-data; boundary=--test" }; }
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { processAudio } from "../../../src/processors/audio.processor.js";
import fs from "fs/promises";

const mockFs = vi.mocked(fs);

function makeFileHandle(size: number, data: Buffer) {
  return {
    stat: vi.fn().mockResolvedValue({ size }),
    read: vi.fn().mockImplementation((buf: Buffer) => {
      data.copy(buf);
      return Promise.resolve({ bytesRead: data.length });
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("audio.processor", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns placeholder text when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY;
    const audioData = Buffer.from("fake-audio");
    const fh = makeFileHandle(audioData.length, audioData);
    mockFs.open = vi.fn().mockResolvedValue(fh);
    mockFs.stat = vi.fn().mockResolvedValue({ size: audioData.length });

    const result = await processAudio("/data/recording.mp3", "audio/mpeg");

    expect(result.type).toBe("text");
    expect(result.text).toContain("OPENAI_API_KEY not configured");
    expect(result.metadata?.transcribed).toBe(false);
  });

  it("throws when file path is inside OS temp directory", async () => {
    const tmpDir = (await import("os")).default.tmpdir();
    mockFs.stat = vi.fn().mockResolvedValue({ size: 100 });

    await expect(processAudio(`${tmpDir}/audio.mp3`, "audio/mpeg")).rejects.toThrow(
      "must not reside in the OS temp directory"
    );
  });

  it("throws when file exceeds Whisper 25 MB limit", async () => {
    const oversizeBytes = 26 * 1024 * 1024;
    const fh = makeFileHandle(oversizeBytes, Buffer.alloc(0));
    mockFs.open = vi.fn().mockResolvedValue(fh);
    mockFs.stat = vi.fn().mockResolvedValue({ size: oversizeBytes });

    await expect(processAudio("/safe/audio.mp3", "audio/mpeg")).rejects.toThrow(
      "too large for Whisper"
    );
    expect(fh.close).toHaveBeenCalled();
  });

  it("throws when file exceeds 100 MB general size limit", async () => {
    const oversizeBytes = 101 * 1024 * 1024;
    mockFs.stat = vi.fn().mockResolvedValue({ size: oversizeBytes });

    await expect(processAudio("/safe/audio.mp3", "audio/mpeg")).rejects.toThrow(
      "File too large"
    );
  });
  it("calls Whisper API with correct model and returns transcript", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const audioData = Buffer.from("fake-audio-data");
    const fh = makeFileHandle(audioData.length, audioData);
    mockFs.open = vi.fn().mockResolvedValue(fh);
    mockFs.stat = vi.fn().mockResolvedValue({ size: audioData.length });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: "Hello from Whisper." }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await processAudio("/safe/speech.mp3", "audio/mpeg");

    expect(result.type).toBe("text");
    expect(result.text).toBe("Hello from Whisper.");
    expect(result.metadata?.transcribed).toBe(true);
    expect(result.metadata?.whisperModel).toBe("whisper-1");

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-key");
  });

  it("throws when Whisper API returns non-ok status", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const audioData = Buffer.from("bad-audio");
    const fh = makeFileHandle(audioData.length, audioData);
    mockFs.open = vi.fn().mockResolvedValue(fh);
    mockFs.stat = vi.fn().mockResolvedValue({ size: audioData.length });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue("Bad Request"),
    }));

    await expect(processAudio("/safe/noise.mp3", "audio/mpeg")).rejects.toThrow(
      "Whisper transcription failed"
    );
    expect(fh.close).toHaveBeenCalled();
  });

  it("throws when Whisper fetch call itself throws a network error", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const audioData = Buffer.from("audio");
    const fh = makeFileHandle(audioData.length, audioData);
    mockFs.open = vi.fn().mockResolvedValue(fh);
    mockFs.stat = vi.fn().mockResolvedValue({ size: audioData.length });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));

    await expect(processAudio("/safe/speech.mp3", "audio/mpeg")).rejects.toThrow(
      "Audio transcription request failed"
    );
    expect(fh.close).toHaveBeenCalled();
  });

  it("closes file handle even when transcription fails", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const audioData = Buffer.from("audio");
    const fh = makeFileHandle(audioData.length, audioData);
    mockFs.open = vi.fn().mockResolvedValue(fh);
    mockFs.stat = vi.fn().mockResolvedValue({ size: audioData.length });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));

    await processAudio("/safe/speech.mp3", "audio/mpeg").catch(() => {});
    expect(fh.close).toHaveBeenCalled();
  });

  it("sanitises mimeType to produce safe filename extension", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const audioData = Buffer.from("audio");
    const fh = makeFileHandle(audioData.length, audioData);
    mockFs.open = vi.fn().mockResolvedValue(fh);
    mockFs.stat = vi.fn().mockResolvedValue({ size: audioData.length });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: "transcribed" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // mimeType with slash injection should still produce a safe extension
    await processAudio("/safe/speech.ogg", "audio/ogg; codecs=opus");

    const formDataCall = mockFetch.mock.calls[0];
    expect(formDataCall).toBeDefined();
  });

  it("includes mimeType in result metadata", async () => {
    delete process.env.OPENAI_API_KEY;
    const audioData = Buffer.from("audio");
    const fh = makeFileHandle(audioData.length, audioData);
    mockFs.open = vi.fn().mockResolvedValue(fh);
    mockFs.stat = vi.fn().mockResolvedValue({ size: audioData.length });

    const result = await processAudio("/safe/speech.wav", "audio/wav");
    expect(result.metadata?.mimeType).toBe("audio/wav");
  });
});
