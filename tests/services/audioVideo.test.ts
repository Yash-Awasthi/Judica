import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../../src/lib/providers.js", () => ({
  routeAndCollect: vi.fn().mockResolvedValue([{ text: "Council summary of media content." }]),
}));

import {
  processMedia,
  getResult,
  formatForCouncil,
  getAvailableProviders,
} from "../../src/services/audioVideo.service.js";
import type { MediaProcessingResult } from "../../src/services/audioVideo.service.js";

describe("audioVideo.service", () => {
  describe("processMedia", () => {
    it("returns failed result when no transcription provider is available", async () => {
      // No API keys set in test env
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_STT_KEY;

      const result = await processMedia(Buffer.from("fake audio"), "audio");
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/No transcription provider/);
      expect(result.id).toMatch(/^media_/);
    });

    it("stores result retrievable by ID", async () => {
      const result = await processMedia(Buffer.from("data"), "audio");
      const retrieved = getResult(result.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(result.id);
    });

    it("tracks processing time", async () => {
      const result = await processMedia(Buffer.from("data"), "video");
      expect(result.processingMs).not.toBeNull();
      expect(typeof result.processingMs).toBe("number");
    });
  });

  describe("formatForCouncil", () => {
    it("formats audio result for council context", () => {
      const result: MediaProcessingResult = {
        id: "media_test",
        mediaType: "audio",
        status: "completed",
        transcript: "Hello, this is a test transcription of an important meeting.",
        segments: [
          { start: 0, end: 10, text: "Hello, this is a test", confidence: 0.95 },
          { start: 10, end: 20, text: "transcription of an important meeting.", confidence: 0.92 },
        ],
        keyframes: [],
        contextSummary: "A meeting discussing test procedures.",
        duration: 20,
        processingMs: 500,
      };

      const formatted = formatForCouncil(result);
      expect(formatted).toContain("## Audio Input");
      expect(formatted).toContain("### Summary");
      expect(formatted).toContain("A meeting discussing test procedures.");
      expect(formatted).toContain("### Transcript");
      expect(formatted).toContain("Hello, this is a test");
    });

    it("formats video result with keyframes", () => {
      const result: MediaProcessingResult = {
        id: "media_video",
        mediaType: "video",
        status: "completed",
        transcript: "Welcome to this presentation on AI safety.",
        segments: [],
        keyframes: [
          { timestamp: 0, description: "Title slide", labels: ["slide", "text"] },
          { timestamp: 30, description: "Speaker at podium", labels: ["person", "stage"] },
          { timestamp: 60, description: "Graph showing data", labels: ["chart", "data"] },
        ],
        contextSummary: "A presentation about AI safety measures.",
        duration: 90,
        processingMs: 2000,
      };

      const formatted = formatForCouncil(result);
      expect(formatted).toContain("## Video Input");
      expect(formatted).toContain("### Visual Elements");
      expect(formatted).toContain("Title slide");
      expect(formatted).toContain("Speaker at podium");
      expect(formatted).toContain("[0:00]");
      expect(formatted).toContain("[0:30]");
      expect(formatted).toContain("[1:00]");
    });

    it("includes speaker attribution when available", () => {
      const result: MediaProcessingResult = {
        id: "media_speakers",
        mediaType: "audio",
        status: "completed",
        transcript: "Hello. Hi there.",
        segments: [
          { start: 0, end: 5, text: "Hello.", confidence: 0.9, speaker: "Speaker A" },
          { start: 5, end: 10, text: "Hi there.", confidence: 0.9, speaker: "Speaker B" },
        ],
        keyframes: [],
        contextSummary: null,
        duration: 10,
        processingMs: 300,
      };

      const formatted = formatForCouncil(result);
      expect(formatted).toContain("### Speakers");
      expect(formatted).toContain("Speaker A");
      expect(formatted).toContain("Speaker B");
    });

    it("handles result with no summary gracefully", () => {
      const result: MediaProcessingResult = {
        id: "media_nosummary",
        mediaType: "audio",
        status: "completed",
        transcript: "Just transcript, no summary.",
        segments: [],
        keyframes: [],
        contextSummary: null,
        duration: 5,
        processingMs: 100,
      };

      const formatted = formatForCouncil(result);
      expect(formatted).toContain("## Audio Input");
      expect(formatted).toContain("### Transcript");
      expect(formatted).not.toContain("### Summary");
    });
  });

  describe("getAvailableProviders", () => {
    it("returns list of providers with availability status", () => {
      const providers = getAvailableProviders();
      expect(providers).toHaveLength(3);
      expect(providers.map((p) => p.provider)).toEqual([
        "openai_whisper",
        "google_stt",
        "local_whisper",
      ]);
      for (const p of providers) {
        expect(typeof p.available).toBe("boolean");
      }
    });
  });

  describe("getResult", () => {
    it("returns undefined for nonexistent ID", () => {
      expect(getResult("nonexistent")).toBeUndefined();
    });
  });
});
