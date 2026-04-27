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

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Eye, Send, Loader2, Zap, AlertTriangle } from "lucide-react";
import { deliberate, createThread, onOpinion, onVerdict, onDone } from "~/lib/deliberate";
import { loadCouncilMembers } from "~/lib/council";

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
  const [responses, setResponses] = useState<MemberResponse[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const enabledMembers = loadCouncilMembers().filter(m => m.enabled);
  const memberCount = enabledMembers.length || 3;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || isLoading) return;

    setIsLoading(true);
    setSynthesis(null);

    const placeholders: MemberResponse[] = enabledMembers.map((m, i) => ({
      alias:     m.label,
      model:     m.model || m.provider,
      text:      "",
      latencyMs: 0,
      tokens:    0,
      status:    "loading",
    }));
    setResponses(placeholders);

    const startTimes: Record<string, number> = {};
    enabledMembers.forEach(m => { startTimes[m.label] = Date.now(); });

    const threadId = await createThread();

    const unsubOpinion = onOpinion((data) => {
      const alias = data.label || data.provider;
      const elapsed = Date.now() - (startTimes[alias] ?? Date.now());
      setResponses(prev => prev.map(r =>
        r.alias === alias
          ? { ...r, text: data.text, status: "done", latencyMs: elapsed, tokens: Math.ceil(data.text.length / 4) }
          : r
      ));
    });

    const unsubVerdict = onVerdict((data) => {
      setSynthesis(data.text);
    });

    const unsubDone = onDone(() => {
      unsubOpinion();
      unsubVerdict();
      unsubDone();
      setIsLoading(false);
    });

    try {
      await deliberate({ threadId, message: question, round: 1 });
    } catch {
      // Not in Electron — show mock parallel responses
      const mockTexts = [
        "From an architectural standpoint, this question touches on fundamental system design principles. The key considerations are scalability, maintainability, and the trade-offs between consistency and availability. A well-structured approach would decompose the problem into orthogonal concerns...",
        "Pragmatically speaking, the most important factor here is delivery speed and real-world constraints. Theory is valuable but implementation is where design meets reality. I'd focus on the simplest solution that works today and can be evolved tomorrow...",
        "The ethical dimension of this question deserves attention. Beyond technical correctness, we must ask: who is affected by this decision, and how? Long-term consequences for users and society should weigh heavily in the calculus here...",
      ];
      setResponses(enabledMembers.slice(0, 3).map((m, i) => ({
        alias: m.label,
        model: m.model || m.provider,
        text: mockTexts[i % mockTexts.length],
        latencyMs: 800 + i * 300,
        tokens: Math.ceil(mockTexts[i % mockTexts.length].length / 4),
        status: "done",
      })));
      setSynthesis("After deliberation, the council converges on a balanced approach: acknowledge the architectural constraints, deliver iteratively, and build ethical review into the process from day one rather than auditing after the fact.");
      unsubOpinion(); unsubVerdict(); unsubDone();
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
          <Badge variant="outline" className="text-xs">{memberCount} members</Badge>
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
