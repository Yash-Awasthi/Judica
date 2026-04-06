import { useRef, useEffect, useCallback, useState } from "react";
import { useAuth } from "../context/AuthContext";

export interface PeerReview {
  reviewer: string;
  ranking: string[];
  critique: string;
}

export interface ScoredOpinion {
  name: string;
  opinion: string;
  scores: {
    confidence: number;
    agreement: number;
    peerRanking: number;
    final: number;
  };
}

export interface ModelCost {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

export type SSEEvent =
  | { type: "member_chunk"; name: string; chunk: string }
  | { type: "opinion"; name: string; archetype: string; opinion: string }
  | { type: "verdict"; verdict: string }
  | { type: "verdict_chunk"; chunk: string }
  | { type: "peer_review"; round: number; reviews: PeerReview[] }
  | { type: "scored"; round: number; scored: ScoredOpinion[] }
  | { type: "cost"; models: ModelCost[]; totalUsd: number }
  | { type: "done"; verdict: string; latency?: number; cacheHit?: boolean; tokensUsed?: number; conversationId?: string | null }
  | { type: "error"; message: string }
  | { type: "status"; message: string; round?: number };

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

  const startStream = useCallback(async (body: any) => {
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
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(trimmed.slice(6)) as SSEEvent;
                if (eventData.type === "error" && eventData.message) {
                  setStreamError(eventData.message);
                  if (onError) onError(eventData.message);
                }

                // Always call onEvent so the UI can process the event (including errors to append to the chat log)
                onEvent(eventData);
              } catch (err) {
                console.error("Failed to parse SSE line", line);
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Stream error:", err);
        setStreamError(err.message || "Unknown streaming error");
        if (onError) onError(err.message || "Unknown streaming error");
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [fetchWithAuth, stopStream, onEvent, onError]);

  return { startStream, stopStream, streamError };
}
