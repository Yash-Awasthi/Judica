/**
 * Voice Provider Service — multi-provider TTS and STT.
 *
 * TTS Providers: OpenAI, ElevenLabs, Azure Speech
 * STT Providers: OpenAI Whisper, Azure Speech, Deepgram
 */

import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "voice" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type TTSProvider = "openai" | "elevenlabs" | "azure";
export type STTProvider = "openai" | "azure" | "deepgram";

export interface TTSRequest {
  text: string;
  provider?: TTSProvider;
  voice?: string;
  model?: string;
  speed?: number;
  format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
}

export interface TTSResponse {
  provider: TTSProvider;
  audio: ArrayBuffer;
  contentType: string;
}

export interface STTRequest {
  audio: ArrayBuffer;
  provider?: STTProvider;
  language?: string;
  model?: string;
  mimeType?: string;
}

export interface STTResponse {
  provider: STTProvider;
  text: string;
  confidence?: number;
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

// ─── Provider Discovery ───────────────────────────────────────────────────────

export function getAvailableTTSProviders(): TTSProvider[] {
  const providers: TTSProvider[] = [];
  if (env.OPENAI_API_KEY) providers.push("openai");
  if (env.ELEVENLABS_API_KEY) providers.push("elevenlabs");
  if (env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION) providers.push("azure");
  return providers;
}

export function getAvailableSTTProviders(): STTProvider[] {
  const providers: STTProvider[] = [];
  if (env.OPENAI_API_KEY) providers.push("openai");
  if (env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION) providers.push("azure");
  if (env.DEEPGRAM_API_KEY) providers.push("deepgram");
  return providers;
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

export async function textToSpeech(req: TTSRequest): Promise<TTSResponse> {
  const provider = resolveTTSProvider(req.provider);
  log.info({ provider, textLen: req.text.length, voice: req.voice }, "TTS request");

  switch (provider) {
    case "openai": return ttsOpenAI(req);
    case "elevenlabs": return ttsElevenLabs(req);
    case "azure": return ttsAzure(req);
    default: throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

function resolveTTSProvider(requested?: TTSProvider): TTSProvider {
  const available = getAvailableTTSProviders();
  if (requested && available.includes(requested)) return requested;
  if (available.length === 0) throw new Error("No TTS providers configured");
  return available[0];
}

// ─── OpenAI TTS ───────────────────────────────────────────────────────────────

async function ttsOpenAI(req: TTSRequest): Promise<TTSResponse> {
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: req.model ?? "tts-1",
      input: req.text,
      voice: req.voice ?? "alloy",
      speed: req.speed ?? 1.0,
      response_format: req.format ?? "mp3",
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`OpenAI TTS failed: ${resp.status} ${error}`);
  }

  return {
    provider: "openai",
    audio: await resp.arrayBuffer(),
    contentType: `audio/${req.format ?? "mpeg"}`,
  };
}

// ─── ElevenLabs TTS ───────────────────────────────────────────────────────────

async function ttsElevenLabs(req: TTSRequest): Promise<TTSResponse> {
  const voiceId = req.voice ?? "21m00Tcm4TlvDq8ikWAM"; // Rachel (default)
  const model = req.model ?? "eleven_monolingual_v1";

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY!,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: req.text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`ElevenLabs TTS failed: ${resp.status} ${error}`);
  }

  return {
    provider: "elevenlabs",
    audio: await resp.arrayBuffer(),
    contentType: "audio/mpeg",
  };
}

// ─── Azure Speech TTS ─────────────────────────────────────────────────────────

async function ttsAzure(req: TTSRequest): Promise<TTSResponse> {
  const region = env.AZURE_SPEECH_REGION!;
  const key = env.AZURE_SPEECH_KEY!;
  const voice = req.voice ?? "en-US-JennyNeural";

  const ssml = `<speak version='1.0' xml:lang='en-US'>
    <voice name='${voice}'>
      <prosody rate='${((req.speed ?? 1.0) * 100).toFixed(0)}%'>
        ${escapeXml(req.text)}
      </prosody>
    </voice>
  </speak>`;

  const resp = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
    },
    body: ssml,
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Azure Speech TTS failed: ${resp.status} ${error}`);
  }

  return {
    provider: "azure",
    audio: await resp.arrayBuffer(),
    contentType: "audio/mpeg",
  };
}

// ─── STT ──────────────────────────────────────────────────────────────────────

export async function speechToText(req: STTRequest): Promise<STTResponse> {
  const provider = resolveSTTProvider(req.provider);
  log.info({ provider, audioSize: req.audio.byteLength, language: req.language }, "STT request");

  switch (provider) {
    case "openai": return sttOpenAI(req);
    case "azure": return sttAzure(req);
    case "deepgram": return sttDeepgram(req);
    default: throw new Error(`Unknown STT provider: ${provider}`);
  }
}

function resolveSTTProvider(requested?: STTProvider): STTProvider {
  const available = getAvailableSTTProviders();
  if (requested && available.includes(requested)) return requested;
  if (available.length === 0) throw new Error("No STT providers configured");
  return available[0];
}

// ─── OpenAI Whisper STT ───────────────────────────────────────────────────────

async function sttOpenAI(req: STTRequest): Promise<STTResponse> {
  const formData = new FormData();
  formData.append("file", new Blob([req.audio], { type: req.mimeType ?? "audio/webm" }), "audio.webm");
  formData.append("model", req.model ?? "whisper-1");
  if (req.language) formData.append("language", req.language);
  formData.append("response_format", "verbose_json");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: formData,
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`OpenAI Whisper STT failed: ${resp.status} ${error}`);
  }

  const data = await resp.json() as {
    text: string;
    language?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  return {
    provider: "openai",
    text: data.text,
    language: data.language,
    segments: data.segments,
  };
}

// ─── Azure Speech STT ─────────────────────────────────────────────────────────

async function sttAzure(req: STTRequest): Promise<STTResponse> {
  const region = env.AZURE_SPEECH_REGION!;
  const key = env.AZURE_SPEECH_KEY!;
  const language = req.language ?? "en-US";

  const resp = await fetch(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${language}`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": req.mimeType ?? "audio/wav",
      },
      body: req.audio,
      signal: AbortSignal.timeout(60000),
    },
  );

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Azure Speech STT failed: ${resp.status} ${error}`);
  }

  const data = await resp.json() as {
    RecognitionStatus: string;
    DisplayText: string;
    Offset: number;
    Duration: number;
  };

  return {
    provider: "azure",
    text: data.DisplayText ?? "",
    language,
  };
}

// ─── Deepgram STT ─────────────────────────────────────────────────────────────

async function sttDeepgram(req: STTRequest): Promise<STTResponse> {
  const params = new URLSearchParams({
    model: req.model ?? "nova-2",
    smart_format: "true",
    punctuate: "true",
  });
  if (req.language) params.set("language", req.language);

  const resp = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      "Content-Type": req.mimeType ?? "audio/webm",
    },
    body: req.audio,
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    const error = await resp.text();
    throw new Error(`Deepgram STT failed: ${resp.status} ${error}`);
  }

  const data = await resp.json() as {
    results: {
      channels: Array<{
        alternatives: Array<{
          transcript: string;
          confidence: number;
          words: Array<{ start: number; end: number; word: string }>;
        }>;
      }>;
    };
  };

  const alt = data.results?.channels?.[0]?.alternatives?.[0];

  return {
    provider: "deepgram",
    text: alt?.transcript ?? "",
    confidence: alt?.confidence,
    segments: alt?.words?.map((w) => ({ start: w.start, end: w.end, text: w.word })),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
