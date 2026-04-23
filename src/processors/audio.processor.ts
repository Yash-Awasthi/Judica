import fs from "fs/promises";
import { constants as fsConstants } from "fs";
import path from "path";
import os from "os";
import FormData from "form-data";
// node-fetch not needed — Node 18+ has native fetch
import type { ProcessedFile } from "./types.js";
import { assertFileSizeLimit } from "./types.js";
import logger from "../lib/logger.js";

const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // Whisper hard limit: 25 MB

/**
 * Transcribe an audio file (mp3, mp4, webm, wav, ogg, m4a, flac) using OpenAI Whisper.
 * Returns the transcript as `text` so it can be injected as RAG context.
 */
export async function processAudio(filePath: string, mimeType: string): Promise<ProcessedFile> {
  assertFileSizeLimit(filePath);

  // Reject files that live in the OS temp directory — guarding against symlink attacks
  // on paths created without O_EXCL (CodeQL js/insecure-temporary-file)
  const resolvedPath = path.resolve(filePath);
  const tmpDir = path.resolve(os.tmpdir());
  if (resolvedPath.startsWith(tmpDir + path.sep) || resolvedPath === tmpDir) {
    throw new Error("Audio file must not reside in the OS temp directory");
  }

  // Open file descriptor once to avoid TOCTOU race between stat and read.
  // O_NOFOLLOW prevents symlink attacks on temp paths (CodeQL js/insecure-temporary-file).
  const fh = await fs.open(resolvedPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await fh.stat();
    if (stat.size > WHISPER_MAX_BYTES) {
      throw new Error(
        `Audio file too large for Whisper (${(stat.size / (1024 * 1024)).toFixed(1)} MB > 25 MB limit)`
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn("OPENAI_API_KEY not set — audio transcription unavailable, returning placeholder");
      return {
        type: "text",
        text: "[Audio transcription unavailable: OPENAI_API_KEY not configured]",
        metadata: { mimeType, transcribed: false },
      };
    }

    const fileBuffer = Buffer.alloc(stat.size);
    await fh.read(fileBuffer, 0, stat.size, 0);
  const rawExt = mimeType.split("/")[1]?.replace("mpeg", "mp3") || "mp3";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "mp3";
  const filename = `audio.${ext}`;

  const form = new FormData();
  form.append("file", fileBuffer, { filename, contentType: mimeType });
  form.append("model", "whisper-1");

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      body: form as unknown as BodyInit,
    });
  } catch (err) {
    logger.error({ err, filePath }, "Whisper API request failed");
    throw new Error("Audio transcription request failed", { cause: err });
  }

  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, "Whisper API error");
    throw new Error(`Whisper transcription failed: ${response.status}`);
  }

  const data = (await response.json()) as { text: string };

  logger.info({ filePath, chars: data.text.length }, "Audio transcription complete");

  return {
    type: "text",
    text: data.text,
    metadata: { mimeType, transcribed: true, whisperModel: "whisper-1" },
  };
  } finally {
    await fh.close();
  }
}
