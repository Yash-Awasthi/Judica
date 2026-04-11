import { useState, useCallback, useRef, useEffect } from "react";
import { Volume2, VolumeX, Send } from "lucide-react";
import { useAuth } from "../context/AuthContext";

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
  const eventSourceRef = useRef<EventSource | null>(null);
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Auto-scroll columns
  const scrollToBottom = (memberId: string) => {
    const el = columnRefs.current.get(memberId);
    if (el) el.scrollTop = el.scrollHeight;
  };

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
      // Start orchestration via POST, then connect to SSE
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

      // Connect to SSE stream
      const token = localStorage.getItem("council_token") || "";
      const es = new EventSource(`/api/council/debate/${sessionId}/stream?token=${token}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleEvent(data);
        } catch {}
      };

      es.onerror = () => {
        setRunning(false);
        es.close();
      };
    } catch (err) {
      console.error("Debate start failed", err);
      setRunning(false);
    }
  }, [query, running, fetchWithAuth]);

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

        // Highlight conflicting claims in member columns
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

        // Add critique to target member
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

        // TTS
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
  }, []);

  // Voice mode state captured via ref for use in handleEvent
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

  // Consensus meter color
  const meterColor = consensusScore === null
    ? "bg-gray-300"
    : consensusScore < 0.4
      ? "bg-red-500"
      : consensusScore < 0.7
        ? "bg-orange-500"
        : "bg-green-500";

  const meterPercent = consensusScore !== null ? Math.round(consensusScore * 100) : 0;

  // Highlight conflicting text
  function highlightText(text: string, highlights: string[]): JSX.Element {
    if (highlights.length === 0) return <>{text}</>;

    let result = text;
    const parts: Array<{ text: string; highlighted: boolean }> = [];
    let remaining = result;

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
            <span key={i} className="bg-red-100 border-b-2 border-red-400 px-0.5">{p.text}</span>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top Bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b">
        <div className="flex-1 flex items-center gap-2">
          <input
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Enter your question for the council..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startDebate()}
            disabled={running}
          />
          <button
            onClick={startDebate}
            disabled={running || !query.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={16} /> {running ? "Debating..." : "Start Debate"}
          </button>
        </div>
        <button
          onClick={() => setVoiceMode(!voiceMode)}
          className={`p-2 rounded-lg border ${voiceMode ? "bg-blue-100 border-blue-300 text-blue-600" : "bg-gray-100 text-gray-500"}`}
          title={voiceMode ? "Voice mode ON" : "Voice mode OFF"}
        >
          {voiceMode ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
      </div>

      {/* Stats bar */}
      {(members.length > 0 || factsCount > 0) && (
        <div className="flex items-center gap-4 px-4 py-2 bg-gray-100 border-b text-xs text-gray-500">
          <span>{members.length} agents</span>
          <span>{factsCount} facts extracted</span>
          <span>{conflicts.length} conflicts</span>
          <span>{exchanges.length} debate exchanges</span>
        </div>
      )}

      {/* Main Content: Agent Columns */}
      <div className="flex-1 overflow-x-auto p-4">
        {members.length === 0 && !running ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <p className="text-lg mb-2">AI Deliberation Council</p>
              <p className="text-sm">Enter a question to start the debate</p>
            </div>
          </div>
        ) : (
          <div
            className="grid gap-4 h-full"
            style={{ gridTemplateColumns: `repeat(${Math.max(members.length, 1)}, minmax(280px, 1fr))` }}
          >
            {members.map((member) => (
              <div key={member.id} className="flex flex-col bg-white rounded-lg border shadow-sm overflow-hidden">
                {/* Column Header */}
                <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-sm text-gray-800">{member.name}</div>
                    {member.model && (
                      <div className="text-xs text-gray-400">{member.model}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        member.status === "thinking" ? "bg-yellow-400 animate-pulse" :
                        member.status === "debating" ? "bg-blue-400 animate-pulse" :
                        member.status === "done" ? "bg-green-400" :
                        "bg-gray-300"
                      }`}
                    />
                    <span className="text-xs text-gray-400 capitalize">{member.status}</span>
                  </div>
                </div>

                {/* Response Text */}
                <div
                  ref={(el) => { if (el) columnRefs.current.set(member.id, el); }}
                  className="flex-1 p-3 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap leading-relaxed"
                >
                  {member.text ? (
                    highlightText(member.text, member.conflictHighlights)
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>

                {/* Critiques */}
                {member.critiques.length > 0 && (
                  <div className="border-t px-3 py-2 bg-orange-50 space-y-1.5 max-h-32 overflow-y-auto">
                    {member.critiques.map((c, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          c.type === "rebuttal" ? "bg-red-100 text-red-700" :
                          c.type === "concession" ? "bg-green-100 text-green-700" :
                          "bg-orange-100 text-orange-700"
                        }`}>
                          {c.from}
                        </span>
                        <span className="text-xs text-gray-600">{c.content}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Footer */}
                {member.status === "done" && (
                  <div className="px-3 py-1.5 bg-gray-50 border-t flex items-center gap-3 text-xs text-gray-400">
                    <span>{member.tokens} tokens</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Consensus Meter */}
      {(consensusScore !== null || running) && (
        <div className="px-4 py-3 bg-white border-t">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-700">Consensus</span>
            {consensusScore !== null && (
              <span className="text-sm font-bold" style={{ color: consensusScore < 0.4 ? "#ef4444" : consensusScore < 0.7 ? "#f97316" : "#22c55e" }}>
                {meterPercent}%
              </span>
            )}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${meterColor}`}
              style={{ width: consensusScore !== null ? `${meterPercent}%` : running ? "15%" : "0%" }}
            />
          </div>
          {consensusBreakdown && (
            <div className="flex gap-4 mt-1 text-xs text-gray-400">
              <span>Claims: {Math.round((consensusBreakdown.claimAgreement as number) * 100)}%</span>
              <span>Debate: {Math.round((consensusBreakdown.debateResolution as number) * 100)}%</span>
              <span>Conflicts: {consensusBreakdown.totalConflicts as number}</span>
              <span>Concessions: {consensusBreakdown.totalConcessions as number}</span>
            </div>
          )}
        </div>
      )}

      {/* Synthesis Panel */}
      {synthesis && (
        <div className="px-4 py-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-t">
          <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            Council Synthesis
          </h3>
          <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{synthesis}</div>
        </div>
      )}
    </div>
  );
}
