import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX, Send, Swords, Users, FileWarning, MessageSquare, Gavel } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter } from "../components/AnimatedCounter";

interface MemberColumn {
  id: string;
  name: string;
  model: string;
  persona?: string;
  status: "idle" | "thinking" | "done" | "debating";
  text: string;
  critiques: Array<{ from: string; content: string; type: string }>;
  tokens: number;
  latencyMs: number;
  conflictHighlights: string[]; // sentences to highlight
}

interface ConflictLine {
  agentA: string;
  agentB: string;
  claimA: string;
  claimB: string;
  severity: number;
}

interface DebateExchange {
  from: string;
  to: string;
  content: string;
  type: string;
  timestamp: string;
}

export function DebateDashboardView() {
  const { fetchWithAuth } = useAuth();

  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<MemberColumn[]>([]);
  const [conflicts, setConflicts] = useState<ConflictLine[]>([]);
  const [exchanges, setExchanges] = useState<DebateExchange[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [consensusScore, setConsensusScore] = useState<number | null>(null);
  const [consensusBreakdown, setConsensusBreakdown] = useState<Record<string, unknown> | null>(null);
  const [running, setRunning] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [factsCount, setFactsCount] = useState(0);
  const eventSourceRef = useRef<{ close: () => void } | null>(null);
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Auto-scroll columns
  const scrollToBottom = (memberId: string) => {
    const el = columnRefs.current.get(memberId);
    if (el) el.scrollTop = el.scrollHeight;
  };

  const handleEvent = useCallback((data: Record<string, unknown>) => {
    const type = data.type as string;

    switch (type) {
      case "preprocessing_complete":
        break;

      case "member_response": {
        const memberId = data.memberId as string;
        const memberName = data.memberName as string;
        const text = data.text as string;
        const usage = data.usage as { prompt_tokens: number; completion_tokens: number } | undefined;

        setMembers((prev) => {
          const existing = prev.find((m) => m.id === memberId);
          if (existing) {
            return prev.map((m) =>
              m.id === memberId
                ? { ...m, text, status: "done" as const, tokens: (usage?.completion_tokens || 0) }
                : m
            );
          }
          return [
            ...prev,
            {
              id: memberId,
              name: memberName,
              model: "",
              status: "done" as const,
              text,
              critiques: [],
              tokens: usage?.completion_tokens || 0,
              latencyMs: 0,
              conflictHighlights: [],
            },
          ];
        });
        setTimeout(() => scrollToBottom(memberId), 50);
        break;
      }

      case "facts_extracted":
        setFactsCount(data.count as number);
        break;

      case "conflicts_found": {
        const conflictList = (data.conflicts || []) as ConflictLine[];
        setConflicts(conflictList);

        for (const c of conflictList) {
          setMembers((prev) =>
            prev.map((m) => {
              if (m.id === c.agentA) {
                return { ...m, conflictHighlights: [...m.conflictHighlights, c.claimA] };
              }
              if (m.id === c.agentB) {
                return { ...m, conflictHighlights: [...m.conflictHighlights, c.claimB] };
              }
              return m;
            })
          );
        }
        break;
      }

      case "debate_exchange":
      case "agent_message": {
        const exchange: DebateExchange = {
          from: data.from as string,
          to: data.to as string,
          content: data.content as string,
          type: data.type as string,
          timestamp: new Date().toISOString(),
        };
        setExchanges((prev) => [...prev, exchange]);

        setMembers((prev) =>
          prev.map((m) => {
            if (m.name === (data.to as string)) {
              return {
                ...m,
                status: "debating" as const,
                critiques: [...m.critiques, { from: data.from as string, content: (data.content as string).substring(0, 200), type: data.type as string || "critique" }],
              };
            }
            return m;
          })
        );
        break;
      }

      case "synthesis_complete": {
        const consensus = data.consensus as string;
        setSynthesis(consensus);
        setRunning(false);

        if (consensus) {
          playTTS(consensus);
        }
        break;
      }

      case "confidence_score": {
        setConsensusScore(data.score as number);
        setConsensusBreakdown(data.breakdown as Record<string, unknown>);
        break;
      }

      case "orchestration_error":
      case "workflow_error":
        setRunning(false);
        eventSourceRef.current?.close();
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start debate
  const startDebate = useCallback(async () => {
    if (!query.trim() || running) return;

    setRunning(true);
    setMembers([]);
    setConflicts([]);
    setExchanges([]);
    setSynthesis(null);
    setConsensusScore(null);
    setConsensusBreakdown(null);
    setFactsCount(0);

    try {
      const res = await fetchWithAuth("/api/council/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (!res.ok) {
        setRunning(false);
        return;
      }

      const { sessionId } = await res.json();

      const token = localStorage.getItem("council_token") || "";
      // Use fetch with Authorization header instead of EventSource with token in URL
      // to avoid leaking the token in browser history and server logs
      const streamUrl = `/api/council/debate/${sessionId}/stream`;
      const abortController = new AbortController();

      fetch(streamUrl, {
        headers: {
          "Accept": "text/event-stream",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        signal: abortController.signal,
      }).then(async (streamRes) => {
        if (!streamRes.ok || !streamRes.body) {
          setRunning(false);
          return;
        }
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                handleEvent(data);
              } catch (e) { console.warn("SSE parse error", e); }
            }
          }
        }
        setRunning(false);
      }).catch(() => {
        setRunning(false);
      });

      // Store abort controller so we can cancel on error
      eventSourceRef.current = { close: () => abortController.abort() };
    } catch (err) {
      console.error("Debate start failed", err);
      setRunning(false);
    }
  }, [query, running, fetchWithAuth, handleEvent]);

  const voiceModeRef = useRef(voiceMode);
  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);

  const playTTS = async (text: string) => {
    if (!voiceModeRef.current) return;
    try {
      const res = await fetchWithAuth("/api/voice/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.substring(0, 2000), voice: "alloy" }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
      }
    } catch (err) {
      console.error("TTS failed", err);
    }
  };

  const meterPercent = consensusScore !== null ? Math.round(consensusScore * 100) : 0;
  const meterColor = consensusScore === null
    ? "bg-[var(--border-medium)]"
    : consensusScore < 0.4
      ? "bg-[var(--accent-coral)]"
      : consensusScore < 0.7
        ? "bg-[var(--accent-gold)]"
        : "bg-[var(--accent-mint)]";

  function highlightText(text: string, highlights: string[]): JSX.Element {
    if (highlights.length === 0) return <>{text}</>;

    const parts: Array<{ text: string; highlighted: boolean }> = [];
    let remaining = text;

    for (const h of highlights) {
      const idx = remaining.toLowerCase().indexOf(h.toLowerCase().substring(0, 50));
      if (idx >= 0) {
        if (idx > 0) parts.push({ text: remaining.substring(0, idx), highlighted: false });
        parts.push({ text: remaining.substring(idx, idx + h.length), highlighted: true });
        remaining = remaining.substring(idx + h.length);
      }
    }
    if (remaining) parts.push({ text: remaining, highlighted: false });

    if (parts.length === 0) return <>{text}</>;

    return (
      <>
        {parts.map((p, i) =>
          p.highlighted ? (
            <span key={i} className="bg-[var(--accent-coral)]/15 border-b-2 border-[var(--accent-coral)]/40 px-0.5">{p.text}</span>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </>
    );
  }

  // Status dot color
  function statusColor(status: string): string {
    switch (status) {
      case "thinking": return "bg-[var(--accent-gold)] animate-pulse";
      case "debating": return "bg-[var(--accent-blue)] animate-pulse";
      case "done": return "bg-[var(--accent-mint)]";
      default: return "bg-[var(--border-medium)]";
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg)] overflow-hidden">
      {/* ━━━ Top Bar ━━━ */}
      <div className="shrink-0 px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-1)]">
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2">
            <div className="relative flex-1 max-w-2xl">
              <Swords size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--accent-mint)]" />
              <input
                className="input-base pl-11 pr-4 py-3 text-base"
                placeholder="Enter your question for the council..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startDebate()}
                disabled={running}
              />
            </div>
            <button
              onClick={startDebate}
              disabled={running || !query.trim()}
              className="btn-pill-primary px-6 py-3 disabled:opacity-40"
            >
              <Send size={16} />
              {running ? "Debating..." : "Start Debate"}
            </button>
          </div>
          <button
            onClick={() => setVoiceMode(!voiceMode)}
            className={`p-2.5 rounded-button border transition-all ${
              voiceMode
                ? "bg-[rgba(110,231,183,0.08)] border-[rgba(110,231,183,0.2)] text-[var(--accent-mint)]"
                : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            title={voiceMode ? "Voice mode ON" : "Voice mode OFF"}
          >
            {voiceMode ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>
      </div>

      {/* ━━━ Stats Bar ━━━ */}
      {(members.length > 0 || factsCount > 0) && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="shrink-0 grid grid-cols-4 gap-3 px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg)]"
        >
          {[
            { icon: <Users size={14} />, label: "Agents", value: members.length },
            { icon: <FileWarning size={14} />, label: "Facts", value: factsCount },
            { icon: <Swords size={14} />, label: "Conflicts", value: conflicts.length },
            { icon: <MessageSquare size={14} />, label: "Exchanges", value: exchanges.length },
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="text-[var(--accent-mint)]">{stat.icon}</span>
              <span className="font-semibold text-[var(--text-primary)]">
                <AnimatedCounter value={stat.value} />
              </span>
              <span>{stat.label}</span>
            </div>
          ))}
        </motion.div>
      )}

      {/* ━━━ Agent Columns ━━━ */}
      <div className="flex-1 overflow-x-auto p-4">
        {members.length === 0 && !running ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-[var(--glass-bg)] border border-[var(--glass-border)] flex items-center justify-center mx-auto mb-4">
                <Swords size={28} className="text-[var(--accent-mint)] opacity-60" />
              </div>
              <p className="text-lg font-semibold text-[var(--text-primary)] mb-1">Debate Arena</p>
              <p className="text-sm text-[var(--text-muted)]">Enter a question to start the deliberation</p>
            </div>
          </div>
        ) : (
          <div
            className="grid gap-4 h-full"
            style={{ gridTemplateColumns: `repeat(${Math.max(members.length, 1)}, minmax(280px, 1fr))` }}
          >
            {members.map((member, idx) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1, duration: 0.3 }}
                className="flex flex-col surface-card overflow-hidden"
              >
                {/* Column Header */}
                <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        backgroundColor: `hsl(${(idx * 70) % 360}, 60%, 85%)`,
                        color: `hsl(${(idx * 70) % 360}, 60%, 30%)`,
                        boxShadow: member.status === "thinking" || member.status === "debating"
                          ? `0 0 12px hsl(${(idx * 70) % 360}, 60%, 60%)`
                          : "none",
                      }}
                    >
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-[var(--text-primary)]">{member.name}</div>
                      {member.model && (
                        <div className="text-[10px] text-[var(--text-muted)] font-mono">{member.model}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${statusColor(member.status)}`} />
                    <span className="text-[10px] text-[var(--text-muted)] capitalize font-semibold">{member.status}</span>
                  </div>
                </div>

                {/* Response Text */}
                <div
                  ref={(el) => { if (el) columnRefs.current.set(member.id, el); }}
                  className="flex-1 p-4 overflow-y-auto text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed scrollbar-custom"
                >
                  {member.text ? (
                    highlightText(member.text, member.conflictHighlights)
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <span className="w-5 h-5 border-2 border-[var(--accent-mint)] border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                {/* Critiques */}
                <AnimatePresence>
                  {member.critiques.length > 0 && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: "auto" }}
                      className="border-t border-[var(--border-subtle)] px-3 py-2 bg-[var(--glass-bg)] space-y-1.5 max-h-32 overflow-y-auto scrollbar-custom"
                    >
                      {member.critiques.map((c, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-pill font-semibold shrink-0 ${
                            c.type === "rebuttal" ? "bg-[var(--accent-coral)]/12 text-[var(--accent-coral)]" :
                            c.type === "concession" ? "bg-[var(--accent-mint)]/12 text-[var(--accent-mint)]" :
                            "bg-[var(--accent-gold)]/12 text-[var(--accent-gold)]"
                          }`}>
                            {c.from}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)] leading-tight">{c.content}</span>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Footer */}
                {member.status === "done" && (
                  <div className="px-4 py-2 border-t border-[var(--border-subtle)] flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                    <span className="font-mono">{member.tokens} tokens</span>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ━━━ Consensus Meter ━━━ */}
      <AnimatePresence>
        {(consensusScore !== null || running) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 px-6 py-4 bg-[var(--bg-surface-1)] border-t border-[var(--border-subtle)]"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Consensus</span>
              {consensusScore !== null && (
                <span
                  className="text-sm font-bold font-mono"
                  style={{
                    color: consensusScore < 0.4 ? "var(--accent-coral)" : consensusScore < 0.7 ? "var(--accent-gold)" : "var(--accent-mint)"
                  }}
                >
                  {meterPercent}%
                </span>
              )}
            </div>
            <div className="w-full bg-[var(--border-subtle)] rounded-pill h-2 overflow-hidden">
              <motion.div
                className={`h-full rounded-pill ${meterColor}`}
                initial={{ width: 0 }}
                animate={{ width: consensusScore !== null ? `${meterPercent}%` : running ? "15%" : "0%" }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </div>
            {consensusBreakdown && (
              <div className="flex gap-4 mt-2 text-[10px] text-[var(--text-muted)] font-mono">
                <span>Claims: {Math.round((consensusBreakdown.claimAgreement as number) * 100)}%</span>
                <span>Debate: {Math.round((consensusBreakdown.debateResolution as number) * 100)}%</span>
                <span>Conflicts: {consensusBreakdown.totalConflicts as number}</span>
                <span>Concessions: {consensusBreakdown.totalConcessions as number}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ━━━ Synthesis Panel ━━━ */}
      <AnimatePresence>
        {synthesis && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            className="shrink-0 px-6 py-5 verdict-box border-t border-[var(--border-subtle)]"
          >
            <h3 className="font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
              <Gavel size={16} className="text-[var(--accent-mint)]" />
              Council Synthesis
            </h3>
            <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{synthesis}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
