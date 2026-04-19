import { useRef, useState, useCallback } from "react";
import { useCouncilStream, type SSEEvent } from "./useCouncilStream";
import type { ChatMessage, CouncilMember } from "../types/index";
import { v4 as uuidv4 } from "uuid";

// Strip <think> tags from streaming content
function cleanContent(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*/g, "")
    .trim();
}

interface UseDeliberationOptions {
  members: CouncilMember[];
  conversationId: string | null;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  onConversationCreated?: (id: string) => void;
}

export function useDeliberation({
  members,
  conversationId,
  fetchWithAuth,
  onConversationCreated,
}: UseDeliberationOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const activeMsgIdRef = useRef<string | null>(null);

  const applyStreamEvent = useCallback((msgId: string, event: SSEEvent) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const updated = { ...m, opinions: [...(m.opinions || [])] };

        switch (event.type) {
          case "member_chunk": {
            const idx = updated.opinions.findIndex((o) => o.name === event.name);
            const raw = idx === -1 ? event.chunk : updated.opinions[idx].opinion + event.chunk;
            const clean = cleanContent(raw);
            if (idx === -1) {
              updated.opinions.push({ name: event.name, archetype: "", opinion: clean });
            } else {
              updated.opinions[idx] = { ...updated.opinions[idx], opinion: clean };
            }
            break;
          }
          case "opinion": {
            const idx = updated.opinions.findIndex((o) => o.name === event.name);
            const clean = cleanContent(event.opinion);
            if (idx === -1) {
              updated.opinions.push({ name: event.name, archetype: event.archetype, opinion: clean });
            } else {
              updated.opinions[idx] = { ...updated.opinions[idx], archetype: event.archetype, opinion: clean };
            }
            break;
          }
          case "verdict":
            updated.verdict = cleanContent(event.verdict);
            break;
          case "verdict_chunk":
            updated.verdict = cleanContent((updated.verdict || "") + event.chunk);
            break;
          case "mode_start":
            updated.deliberationMode = event.mode;
            updated.modePhases = [];
            break;
          case "mode_phase":
            updated.modePhases = [...(updated.modePhases || []), event as any];
            break;
          case "done":
            if (event.verdict) updated.verdict = cleanContent(event.verdict);
            if (event.opinions && !updated.opinions.length) updated.opinions = event.opinions;
            if (event.conversationId) onConversationCreated?.(event.conversationId);
            break;
        }
        return updated;
      })
    );
  }, [onConversationCreated]);

  const { startStream } = useCouncilStream({
    onEvent: (event) => {
      if (activeMsgIdRef.current) {
        applyStreamEvent(activeMsgIdRef.current, event);
      }
    },
    onError: (msg) => console.error("Stream error:", msg),
  });

  const sendMessage = useCallback(
    async (text: string, summon: string, useStream: boolean, rounds: number, uploadIds?: string[], deliberationMode?: string) => {
      setIsStreaming(true);
      const msgId = uuidv4();
      activeMsgIdRef.current = msgId;

      setMessages((prev) => [
        ...prev,
        { id: msgId, question: text, opinions: [], verdict: "" },
      ]);

      const body = {
        question: text,
        summon: summon || undefined,
        rounds: rounds || undefined,
        conversationId: conversationId || undefined,
        upload_ids: uploadIds && uploadIds.length > 0 ? uploadIds : undefined,
        deliberation_mode: deliberationMode && deliberationMode !== "standard" ? deliberationMode : undefined,
        members: members
          .filter((m) => m.active)
          .map((m) => ({
            ...m,
            systemPrompt: m.customBehaviour || undefined,
          })),
      };

      if (useStream) {
        await startStream(body);
      } else {
        try {
          const res = await fetchWithAuth("/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            const data = await res.json();
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      verdict: data.verdict,
                      opinions: data.opinions || [],
                      peerReviews: data.peerReviews || [],
                      scored: data.scored || [],
                      costs: data.costs || [],
                      totalCostUsd: data.totalCostUsd,
                      durationMs: data.durationMs,
                      cacheHit: data.cacheHit,
                    }
                  : m
              )
            );
            if (!conversationId && data.conversationId) {
              onConversationCreated?.(data.conversationId);
            }
          }
        } catch (err) {
          console.error("Non-streaming request failed:", err);
        }
      }
      setIsStreaming(false);
      activeMsgIdRef.current = null;
    },
    [members, conversationId, fetchWithAuth, startStream, onConversationCreated]
  );

  return { messages, setMessages, isStreaming, sendMessage };
}
