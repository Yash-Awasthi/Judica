import { useState, useCallback, useRef } from "react";
import { fetchWithAuth } from "~/lib/auth";

export interface Opinion {
  agent: string;
  content: string;
  model: string;
  done: boolean;
}

export interface DeliberationCost {
  tokens: number;
  usd: number;
}

export interface CouncilConfig {
  agents?: string[];
  model?: string;
}

export interface DeliberationState {
  query: string;
  setQuery: (q: string) => void;
  opinions: Opinion[];
  verdict: string | null;
  cost: DeliberationCost | null;
  isStreaming: boolean;
  error: string | null;
  submit: (q: string, conversationId?: string, councilConfig?: CouncilConfig) => Promise<void>;
  reset: () => void;
  stop: () => void;
  conversationId: string | null;
}

export function useDeliberation(): DeliberationState {
  const [query, setQuery] = useState("");
  const [opinions, setOpinions] = useState<Opinion[]>([]);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [cost, setCost] = useState<DeliberationCost | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setQuery("");
    setOpinions([]);
    setVerdict(null);
    setCost(null);
    setIsStreaming(false);
    setError(null);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const submit = useCallback(
    async (q: string, convId?: string, councilConfig?: CouncilConfig) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setQuery(q);
      setOpinions([]);
      setVerdict(null);
      setCost(null);
      setError(null);
      setIsStreaming(true);

      try {
        const body: Record<string, unknown> = { query: q };
        if (convId) body.conversationId = convId;
        if (councilConfig) body.councilConfig = councilConfig;

        const response = await fetchWithAuth("/api/ask", {
          method: "POST",
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(text || `Request failed: ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last partial line in the buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;

            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;

            let event: {
              type: string;
              agent?: string;
              content?: string;
              model?: string;
              tokens?: number;
              usd?: number;
              conversationId?: string;
            };
            try {
              event = JSON.parse(payload);
            } catch {
              continue;
            }

            switch (event.type) {
              case "opinion": {
                const agentName = event.agent ?? "Unknown";
                const content = event.content ?? "";
                const model = event.model ?? "";

                setOpinions((prev) => {
                  const idx = prev.findIndex((o) => o.agent === agentName);
                  if (idx === -1) {
                    return [
                      ...prev,
                      { agent: agentName, content, model, done: false },
                    ];
                  }
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    content: updated[idx].content + content,
                  };
                  return updated;
                });
                break;
              }

              case "opinion_done": {
                const agentName = event.agent ?? "";
                setOpinions((prev) =>
                  prev.map((o) =>
                    o.agent === agentName ? { ...o, done: true } : o
                  )
                );
                break;
              }

              case "verdict": {
                setVerdict((prev) => (prev ?? "") + (event.content ?? ""));
                break;
              }

              case "cost": {
                setCost({
                  tokens: event.tokens ?? 0,
                  usd: event.usd ?? 0,
                });
                break;
              }

              case "conversation": {
                if (event.conversationId) {
                  setConversationId(event.conversationId);
                }
                break;
              }

              case "done": {
                // Mark all opinions as done
                setOpinions((prev) =>
                  prev.map((o) => ({ ...o, done: true }))
                );
                break;
              }

              case "error": {
                setError(event.content ?? "An error occurred");
                break;
              }
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User cancelled — not an error
          return;
        }
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        setError(message);
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    []
  );

  return {
    query,
    setQuery,
    opinions,
    verdict,
    cost,
    isStreaming,
    error,
    submit,
    reset,
    stop,
    conversationId,
  };
}
