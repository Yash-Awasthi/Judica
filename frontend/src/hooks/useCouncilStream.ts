import { useRef, useEffect, useCallback, useState } from "react";
import { useAuth } from "../context/AuthContext";
import type { Opinion, PeerReview, ScoredOpinion, ModelCost, CouncilMember } from "../types/index.js";

export interface StreamRequestBody {
  question: string;
  summon?: string;
  rounds?: number;
  conversationId?: string;
  upload_ids?: string[];
  deliberation_mode?: string;
  members: (CouncilMember & { systemPrompt?: string })[];
}

export type SSEEvent =
  | { type: "member_chunk"; name: string; chunk: string }
  | { type: "opinion"; name: string; archetype: string; opinion: string }
  | { type: "verdict"; verdict: string }
  | { type: "verdict_chunk"; chunk: string }
  | { type: "peer_review"; round: number; reviews: PeerReview[] }
  | { type: "scored"; round: number; scored: ScoredOpinion[] }
  | { type: "cost"; models: ModelCost[]; totalUsd: number }
  | { type: "done"; verdict: string; opinions?: Opinion[]; latency?: number; cacheHit?: boolean; tokensUsed?: number; conversationId?: string | null }
  | { type: "error"; message: string }
  | { type: "status"; message: string; round?: number }
  | { type: "mode_start"; mode: string }
  | { type: "mode_phase"; phase: string; qa?: { q: string; a: string }[]; redArguments?: string; blueArguments?: string; round?: { round: number; phase: "propose" | "falsify" | "revise"; hypotheses: { agent: string; text: string }[] }; opinions?: { agent: string; opinion: string; confidence: number; reasoning: string }[] };

interface UseCouncilStreamProps {
  onEvent: (event: SSEEvent) => void;
  onError?: (msg: string) => void;
}

export function useCouncilStream({ onEvent, onError }: UseCouncilStreamProps) {
  const { fetchWithAuth } = useAuth();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  const startStream = useCallback(async (body: StreamRequestBody) => {
    stopStream();
    setStreamError(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetchWithAuth("/api/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error("Stream request failed with status: " + response.status);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") {
                // Ignore standard SSE done events if sent
                continue;
              }

              try {
                const eventData = JSON.parse(data) as SSEEvent;
                if (eventData.type === "error" && eventData.message) {
                  setStreamError(eventData.message);
                  if (onError) onError(eventData.message);
                }

                onEvent(eventData);
              } catch (err) {
                console.error("Failed to parse SSE line:", line, err);
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name !== "AbortError") {
        console.error("Stream error:", error);
        setStreamError(error.message || "Unknown streaming error");
        if (onError) onError(error.message || "Unknown streaming error");
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [fetchWithAuth, stopStream, onEvent, onError]);

  return { startStream, stopStream, streamError };
}
