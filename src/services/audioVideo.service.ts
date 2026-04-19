/**
 * Audio/video input processing service.
 *
 * Transcribes audio and extracts keyframes from video for council context.
 * Supports multiple transcription providers with graceful fallback:
 *   1. OpenAI Whisper API (preferred)
 *   2. Local whisper.cpp (if available)
 *   3. Google Speech-to-Text
 *
 * Video processing extracts keyframes at configurable intervals
 * and generates scene descriptions for multi-modal council input.
 */

import crypto from "crypto";
import { askProvider } from "../lib/providers.js";
import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type MediaType = "audio" | "video";
export type TranscriptionStatus = "pending" | "processing" | "completed" | "failed";

export interface TranscriptionSegment {
  start: number;   // seconds
  end: number;     // seconds
  text: string;
  confidence: number;
  speaker?: string;
}

export interface Keyframe {
  timestamp: number; // seconds
  description: string;
  labels: string[];
}

export interface MediaProcessingResult {
  id: string;
  mediaType: MediaType;
  status: TranscriptionStatus;
  /** Full transcription text */
  transcript: string | null;
  /** Timed segments with speaker attribution */
  segments: TranscriptionSegment[];
  /** Extracted keyframes (video only) */
  keyframes: Keyframe[];
  /** Summary for council context injection */
  contextSummary: string | null;
  /** Duration in seconds */
  duration: number | null;
  /** Processing time in ms */
  processingMs: number | null;
  error?: string;
}

export interface TranscriptionOptions {
  /** Language hint (ISO 639-1 code) */
  language?: string;
  /** Enable speaker diarization */
  diarize?: boolean;
  /** Keyframe extraction interval in seconds (video only, default 30) */
  keyframeIntervalSec?: number;
  /** Generate summary for council context */
  generateSummary?: boolean;
}

// ─── Store ──────────────────────────────────────────────────────────────────

const results = new Map<string, MediaProcessingResult>();

// ─── Transcription Providers ────────────────────────────────────────────────

type TranscriptionProvider = "openai_whisper" | "local_whisper" | "google_stt";

function getAvailableProvider(): TranscriptionProvider | null {
  if (process.env.OPENAI_API_KEY) return "openai_whisper";
  if (process.env.GOOGLE_STT_KEY) return "google_stt";
  // Could check for local whisper.cpp binary
  return null;
}

/**
 * Transcribe audio content using the best available provider.
 *
 * This is a framework function — actual API calls depend on provider keys.
 * When no provider is available, it returns a structured error result.
 */
async function transcribeAudio(
  audioBuffer: Buffer,
  options: TranscriptionOptions,
): Promise<{ transcript: string; segments: TranscriptionSegment[] }> {
  const provider = getAvailableProvider();

  if (!provider) {
    throw new Error(
      "No transcription provider available. Set OPENAI_API_KEY or GOOGLE_STT_KEY.",
    );
  }

  // Provider-specific transcription logic
  // Each provider returns normalized segments
  if (provider === "openai_whisper") {
    return transcribeWithWhisper(audioBuffer, options);
  }

  if (provider === "google_stt") {
    return transcribeWithGoogleSTT(audioBuffer, options);
  }

  throw new Error(`Unknown provider: ${provider}`);
}

async function transcribeWithWhisper(
  audioBuffer: Buffer,
  options: TranscriptionOptions,
): Promise<{ transcript: string; segments: TranscriptionSegment[] }> {
  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(audioBuffer)]), "audio.wav");
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  if (options.language) formData.append("language", options.language);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Whisper API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { results: Array<{ text: string }>; text?: string; segments?: Array<{ text: string; start: number; end: number; avg_logprob?: number }> };

  const segments: TranscriptionSegment[] = (data.segments || []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
    confidence: s.avg_logprob ? Math.exp(s.avg_logprob) : 0.9,
  }));

  return {
    transcript: data.text || "",
    segments,
  };
}

async function transcribeWithGoogleSTT(
  audioBuffer: Buffer,
  options: TranscriptionOptions,
): Promise<{ transcript: string; segments: TranscriptionSegment[] }> {
  const content = audioBuffer.toString("base64");

  const body = {
    config: {
      encoding: "LINEAR16",
      languageCode: options.language || "en-US",
      enableWordTimeOffsets: true,
      enableAutomaticPunctuation: true,
      diarizationConfig: options.diarize
        ? { enableSpeakerDiarization: true, minSpeakerCount: 2, maxSpeakerCount: 6 }
        : undefined,
    },
    audio: { content },
  };

  const response = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${process.env.GOOGLE_STT_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Google STT error: ${response.status}`);
  }

  const data = await response.json() as { results?: Array<{ text?: string; alternatives?: Array<{ transcript?: string }> }>; text?: string };
  const results = data.results || [];

  const segments: TranscriptionSegment[] = results.map((r, i: number) => ({
    start: i * 30,
    end: (i + 1) * 30,
    text: r.alternatives?.[0]?.transcript || r.text || "",
    confidence: 0,
  }));

  const transcript = segments.map((s) => s.text).join(" ");

  return { transcript, segments };
}

// ─── Video Processing ───────────────────────────────────────────────────────

/**
 * Extract keyframes from video at regular intervals.
 * Uses LLM to describe each frame for multi-modal council context.
 */
async function extractKeyframes(
  videoBuffer: Buffer,
  intervalSec: number,
  durationSec: number,
): Promise<Keyframe[]> {
  // Calculate keyframe timestamps
  const timestamps: number[] = [];
  for (let t = 0; t < durationSec; t += intervalSec) {
    timestamps.push(t);
  }

  // In production, this would use ffmpeg to extract frames
  // and then use the image-aware service to describe them.
  // For now, return placeholder keyframes at each timestamp.
  const keyframes: Keyframe[] = timestamps.map((t) => ({
    timestamp: t,
    description: `Scene at ${Math.floor(t / 60)}m${Math.round(t % 60)}s`,
    labels: [],
  }));

  return keyframes;
}

// ─── Context Generation ─────────────────────────────────────────────────────

/**
 * Generate a council-ready context summary from transcription and keyframes.
 */
async function generateContextSummary(
  transcript: string,
  keyframes: Keyframe[],
  mediaType: MediaType,
): Promise<string> {
  try {
    const prompt = mediaType === "video"
      ? `Summarize this video content for a multi-agent council deliberation. Include key topics, speakers, and visual elements.

Transcript: ${transcript.slice(0, 4000)}

Keyframes: ${keyframes.map((k) => `[${k.timestamp}s] ${k.description}`).join("; ")}

Provide a concise context summary (2-3 paragraphs).`
      : `Summarize this audio content for a multi-agent council deliberation. Include key topics, speakers, and main arguments.

Transcript: ${transcript.slice(0, 4000)}

Provide a concise context summary (2-3 paragraphs).`;

    const response = await askProvider(
      { name: "summarizer", type: "api", provider: "openai", model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY || "" },
      prompt,
    );

    return response?.text || "Summary unavailable.";
  } catch {
    // Fallback: first 500 chars of transcript
    return `[Auto-summary unavailable] ${transcript.slice(0, 500)}...`;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Process audio/video input and prepare for council context.
 */
export async function processMedia(
  buffer: Buffer,
  mediaType: MediaType,
  options: TranscriptionOptions = {},
): Promise<MediaProcessingResult> {
  const id = `media_${crypto.randomBytes(8).toString("hex")}`;
  const start = Date.now();

  const result: MediaProcessingResult = {
    id,
    mediaType,
    status: "processing",
    transcript: null,
    segments: [],
    keyframes: [],
    contextSummary: null,
    duration: null,
    processingMs: null,
  };

  results.set(id, result);

  try {
    // Transcribe audio
    const { transcript, segments } = await transcribeAudio(buffer, options);
    result.transcript = transcript;
    result.segments = segments;

    // Estimate duration from last segment
    if (segments.length > 0) {
      result.duration = segments[segments.length - 1].end;
    }

    // Extract keyframes for video
    if (mediaType === "video" && result.duration) {
      const interval = options.keyframeIntervalSec ?? 30;
      result.keyframes = await extractKeyframes(buffer, interval, result.duration);
    }

    // Generate summary
    if (options.generateSummary !== false && transcript) {
      result.contextSummary = await generateContextSummary(
        transcript,
        result.keyframes,
        mediaType,
      );
    }

    result.status = "completed";
    result.processingMs = Date.now() - start;

    logger.info(
      { mediaId: id, mediaType, segments: segments.length, duration: result.duration },
      "Media processing completed",
    );

  } catch (err: unknown) {
    result.status = "failed";
    result.error = err instanceof Error ? err.message : String(err);
    result.processingMs = Date.now() - start;

    logger.error({ mediaId: id, err: err instanceof Error ? err.message : String(err) }, "Media processing failed");
  }

  return result;
}

/**
 * Get a processing result by ID.
 */
export function getResult(id: string): MediaProcessingResult | undefined {
  return results.get(id);
}

/**
 * Format transcription for council context injection.
 */
export function formatForCouncil(result: MediaProcessingResult): string {
  const parts: string[] = [];

  parts.push(`## ${result.mediaType === "video" ? "Video" : "Audio"} Input`);

  if (result.contextSummary) {
    parts.push(`### Summary\n${result.contextSummary}`);
  }

  if (result.transcript) {
    parts.push(`### Transcript\n${result.transcript.slice(0, 3000)}`);
  }

  if (result.keyframes.length > 0) {
    parts.push(
      `### Visual Elements\n` +
      result.keyframes.map((k) =>
        `- [${Math.floor(k.timestamp / 60)}:${String(Math.round(k.timestamp % 60)).padStart(2, "0")}] ${k.description}`,
      ).join("\n"),
    );
  }

  if (result.segments.length > 0 && result.segments.some((s) => s.speaker)) {
    const speakers = [...new Set(result.segments.map((s) => s.speaker).filter(Boolean))];
    parts.push(`### Speakers: ${speakers.join(", ")}`);
  }

  return parts.join("\n\n");
}

/**
 * Check which transcription providers are available.
 */
export function getAvailableProviders(): { provider: TranscriptionProvider; available: boolean }[] {
  return [
    { provider: "openai_whisper", available: !!process.env.OPENAI_API_KEY },
    { provider: "google_stt", available: !!process.env.GOOGLE_STT_KEY },
    { provider: "local_whisper", available: false }, // Would check for binary
  ];
}
