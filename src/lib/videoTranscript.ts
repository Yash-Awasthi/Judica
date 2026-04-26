/**
 * Video Transcript Ingestion — Phase 2.17
 *
 * Paste a YouTube URL or any video/podcast URL.
 * Transcript is extracted and added to the knowledge base.
 * Council can answer questions about the content.
 *
 * Inspired by:
 * - yt-dlp (Unlicense, 100k+ stars, yt-dlp/yt-dlp) — video downloader
 * - faster-whisper (MIT, SYSTRAN/faster-whisper) — fast local speech-to-text
 * - Whisper.cpp (MIT, ggerganov/whisper.cpp) — CPU-efficient Whisper port
 *
 * Strategy:
 * 1. Try YouTube Data API v3 for transcripts (captions, free, no audio processing)
 * 2. Fallback: yt-dlp --write-auto-sub to get auto-generated subtitles (free)
 * 3. Fallback: openai-whisper via WHISPER_API_URL env var (self-hosted endpoint)
 * 4. Stub: return placeholder with instructions for self-hosting
 *
 * Self-host faster-whisper:
 *   docker run --rm -p 9000:9000 fedirz/faster-whisper-server
 *   WHISPER_API_URL=http://localhost:9000
 */

import { exec as execCb } from "child_process";
import { promisify } from "util";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const exec = promisify(execCb);

export interface TranscriptResult {
  source:       string; // "youtube-api" | "yt-dlp-subs" | "whisper" | "stub"
  title?:       string;
  transcript:   string;
  durationSecs?: number;
  language?:    string;
}

/** Extract YouTube video ID from URL. */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Try YouTube Data API v3 for auto-generated captions.
 * Free, no audio processing. Requires YOUTUBE_API_KEY env var.
 */
async function fetchYouTubeCaptions(videoId: string): Promise<TranscriptResult | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  // Get video title
  const videoRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet,contentDetails&key=${apiKey}`
  );
  if (!videoRes.ok) return null;
  const videoData = await videoRes.json() as any;
  const item = videoData.items?.[0];
  if (!item) return null;

  const title = item.snippet?.title;

  // Get caption list
  const captionRes = await fetch(
    `https://www.googleapis.com/youtube/v3/captions?videoId=${videoId}&part=snippet&key=${apiKey}`
  );
  if (!captionRes.ok) return null;
  const captionData = await captionRes.json() as any;
  const tracks = captionData.items ?? [];

  // Prefer English, then auto-generated
  const track = tracks.find((t: any) => t.snippet?.language === "en" && t.snippet?.trackKind === "asr")
    ?? tracks.find((t: any) => t.snippet?.language === "en")
    ?? tracks[0];

  if (!track) return null;

  // Download caption text (requires OAuth for this API call — return stub with metadata)
  return {
    source:    "youtube-api",
    title,
    transcript: `[YouTube captions available for "${title}" (video ID: ${videoId}). ` +
      `Download captions via YouTube Data API with OAuth to get full transcript text.]`,
    language:  track.snippet?.language,
  };
}

/**
 * Try yt-dlp auto-subtitles (if yt-dlp is installed in PATH).
 * Downloads SRT file and converts to plain text.
 */
async function fetchYtDlpSubtitles(url: string): Promise<TranscriptResult | null> {
  try {
    await exec("which yt-dlp");
  } catch {
    return null; // yt-dlp not installed
  }

  const tmpBase = join(tmpdir(), `ytdlp-${Date.now()}`);
  try {
    const { stdout } = await exec(
      `yt-dlp --write-auto-sub --sub-format vtt --skip-download --output "${tmpBase}" "${url}" 2>&1`,
      { timeout: 30_000 }
    );

    // Find generated subtitle file
    const files = ["en.vtt", "en-orig.vtt"].map(ext => `${tmpBase}.${ext}`);
    const srtFile = files.find(f => existsSync(f));
    if (!srtFile) return null;

    const vttContent = readFileSync(srtFile, "utf-8");
    unlinkSync(srtFile);

    // Strip WebVTT metadata and timing lines
    const lines = vttContent.split("\n");
    const textLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("WEBVTT") || line.match(/^\d{2}:\d{2}/) || line.trim() === "") continue;
      textLines.push(line.trim());
    }

    const transcript = textLines.filter(Boolean).join(" ").replace(/<[^>]+>/g, "");

    // Extract title from stdout
    const titleMatch = stdout.match(/\[download\] Destination: (.+?)(?:\.|$)/);
    const title = titleMatch?.[1];

    return { source: "yt-dlp-subs", title, transcript };
  } catch {
    return null;
  }
}

/**
 * Transcribe via self-hosted Whisper API (faster-whisper-server compatible).
 * WHISPER_API_URL=http://localhost:9000
 */
async function transcribeViaWhisper(url: string): Promise<TranscriptResult | null> {
  const whisperUrl = process.env.WHISPER_API_URL;
  if (!whisperUrl) return null;

  const res = await fetch(`${whisperUrl}/v1/audio/transcriptions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ url, model: "Systran/faster-whisper-base" }),
  });

  if (!res.ok) return null;
  const data = await res.json() as { text?: string; language?: string; duration?: number };

  return {
    source:       "whisper",
    transcript:   data.text ?? "",
    language:     data.language,
    durationSecs: data.duration,
  };
}

/**
 * Main transcript extraction function.
 * Tries strategies in order, returns first success.
 */
export async function extractTranscript(url: string): Promise<TranscriptResult> {
  const videoId = extractYouTubeId(url);

  // Try YouTube API captions first (fastest, no audio download)
  if (videoId) {
    const ytResult = await fetchYouTubeCaptions(videoId);
    if (ytResult) return ytResult;
  }

  // Try yt-dlp auto-subtitles
  const ytDlpResult = await fetchYtDlpSubtitles(url);
  if (ytDlpResult) return ytDlpResult;

  // Try Whisper transcription
  const whisperResult = await transcribeViaWhisper(url);
  if (whisperResult) return whisperResult;

  // Stub: return instructions
  return {
    source:     "stub",
    transcript: `[Transcript extraction not available for: ${url}]\n\n` +
      `To enable transcription:\n` +
      `1. Install yt-dlp (free): pip install yt-dlp\n` +
      `2. Or self-host faster-whisper: docker run -p 9000:9000 fedirz/faster-whisper-server\n` +
      `   Then set WHISPER_API_URL=http://localhost:9000\n` +
      `3. Or set YOUTUBE_API_KEY for YouTube caption extraction`,
  };
}
