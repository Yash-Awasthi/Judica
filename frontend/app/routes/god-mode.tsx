/**
 * God Mode — Phase 1.17
 *
 * Raw parallel view showing all council member responses side-by-side
 * before synthesis. Lets power users see every member's unfiltered output.
 *
 * Inspired by:
 * - OpenAI Playground multi-model compare view
 * - AnthropicAI Workbench raw output panels
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Eye, Send, Loader2, Zap, AlertTriangle } from "lucide-react";

interface MemberResponse {
  alias:     string;
  model:     string;
  text:      string;
  latencyMs: number;
  tokens:    number;
  status:    "loading" | "done" | "error";
  error?:    string;
}

const MEMBER_COLORS = [
  "border-blue-500/50 bg-blue-500/5",
  "border-purple-500/50 bg-purple-500/5",
  "border-green-500/50 bg-green-500/5",
  "border-orange-500/50 bg-orange-500/5",
  "border-pink-500/50 bg-pink-500/5",
  "border-cyan-500/50 bg-cyan-500/5",
];

export default function GodModePage() {
  const [question, setQuestion] = useState("");
  const [memberCount, setMemberCount] = useState(3);
  const [responses, setResponses] = useState<MemberResponse[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || isLoading) return;

    setIsLoading(true);
    setSynthesis(null);

    // Initialize placeholder states
    const placeholders: MemberResponse[] = Array.from({ length: memberCount }, (_, i) => ({
      alias:     `Reviewer ${String.fromCharCode(65 + i)}`,
      model:     "loading…",
      text:      "",
      latencyMs: 0,
      tokens:    0,
      status:    "loading",
    }));
    setResponses(placeholders);

    try {
      const res = await fetch("/api/blind-council/run", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body:    JSON.stringify({ question, memberCount, revealAliases: true }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      const data = await res.json() as {
        responses: Array<{ alias: string; response: string; riskScore: number }>;
        synthesis: string;
        aliasMap?: Record<string, string>;
      };

      const updated: MemberResponse[] = data.responses.map((r, i) => ({
        alias:     r.alias,
        model:     data.aliasMap?.[r.alias] ?? "unknown",
        text:      r.response,
        latencyMs: 0,
        tokens:    Math.ceil(r.response.length / 4),
        status:    "done",
      }));

      setResponses(updated);
      setSynthesis(data.synthesis);
    } catch (err) {
      setResponses(prev => prev.map(r => ({ ...r, status: "error" as const, error: (err as Error).message })));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex flex-col h-screen overflow-hidden" aria-label="God Mode — raw council responses">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center gap-3 shrink-0">
        <Eye className="size-5 text-muted-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-lg font-semibold">God Mode</h1>
          <p className="text-xs text-muted-foreground">
            Raw parallel view of all council member responses before synthesis
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="member-count" className="text-xs text-muted-foreground">Members:</label>
          <select
            id="member-count"
            value={memberCount}
            onChange={e => setMemberCount(Number(e.target.value))}
            className="text-sm border border-border rounded px-2 py-1 bg-background"
            aria-label="Number of council members"
          >
            {[2, 3, 4, 5, 6].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-b border-border px-6 py-3 flex gap-2 shrink-0"
        aria-label="Submit question to council"
      >
        <Input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask all council members in parallel…"
          disabled={isLoading}
          className="flex-1"
          aria-label="Question for council"
        />
        <Button type="submit" disabled={isLoading || !question.trim()} aria-label="Submit">
          {isLoading
            ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            : <Send className="size-4" aria-hidden="true" />
          }
          <span className="sr-only">{isLoading ? "Submitting…" : "Submit"}</span>
        </Button>
      </form>

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Member responses grid */}
        <ScrollArea className="flex-1">
          {responses.length > 0 ? (
            <div
              className="p-4 grid gap-3"
              style={{ gridTemplateColumns: `repeat(${Math.min(memberCount, 3)}, 1fr)` }}
              role="list"
              aria-label="Council member responses"
            >
              {responses.map((r, i) => (
                <article
                  key={r.alias}
                  className={`border rounded-lg p-4 ${MEMBER_COLORS[i % MEMBER_COLORS.length]}`}
                  role="listitem"
                  aria-label={`${r.alias} response`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold">{r.alias}</h2>
                    <div className="flex items-center gap-1.5">
                      {r.status === "loading" && (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Loading" />
                      )}
                      {r.status === "done" && (
                        <Badge variant="outline" className="text-[10px] h-5">
                          ~{r.tokens} tokens
                        </Badge>
                      )}
                      {r.status === "error" && (
                        <AlertTriangle className="size-3.5 text-destructive" aria-label="Error" />
                      )}
                    </div>
                  </div>

                  {r.status === "loading" && (
                    <div className="space-y-2" aria-busy="true" aria-label="Loading response">
                      <div className="h-3 bg-muted/60 rounded animate-pulse w-full" />
                      <div className="h-3 bg-muted/60 rounded animate-pulse w-4/5" />
                      <div className="h-3 bg-muted/60 rounded animate-pulse w-3/5" />
                    </div>
                  )}

                  {r.status === "done" && (
                    <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                      {r.text}
                    </p>
                  )}

                  {r.status === "error" && (
                    <p className="text-sm text-destructive">Error: {r.error}</p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6" role="status">
              <Eye className="size-10 text-muted-foreground/30 mb-3" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Submit a question to see all council members' raw responses side-by-side.
              </p>
            </div>
          )}

          {/* Synthesis panel */}
          {synthesis && (
            <div className="mx-4 mb-4 border border-border rounded-lg p-4 bg-muted/30" role="region" aria-label="Council synthesis">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="size-4 text-yellow-500" aria-hidden="true" />
                <span className="text-sm font-semibold">Synthesis</span>
              </div>
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {synthesis}
              </p>
            </div>
          )}
        </ScrollArea>
      </div>
    </main>
  );
}
