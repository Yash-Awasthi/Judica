import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX, Send, Swords, Gavel, Zap, Activity, ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter } from "../components/AnimatedCounter";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";

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
  conflictHighlights: string[]; 
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
  const [, setConsensusBreakdown] = useState<Record<string, any> | null>(null);
  const [running, setRunning] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [factsCount, setFactsCount] = useState(0);
  const eventSourceRef = useRef<{ close: () => void } | null>(null);
  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const scrollToBottom = (memberId: string) => {
    const el = columnRefs.current.get(memberId);
    if (el) el.scrollTop = el.scrollHeight;
  };

  const handleEvent = useCallback((data: Record<string, any>) => {
    const type = data.type as string;

    switch (type) {
      case "member_response": {
        const memberId = data.memberId as string;
        const memberName = data.memberName as string;
        const text = data.text as string;
        const usage = data.usage as { prompt_tokens: number; completion_tokens: number } | undefined;

        setMembers((prev) => {
          const existing = prev.find((mItem) => mItem.id === memberId);
          if (existing) {
            return prev.map((mItem) =>
                mItem.id === memberId
                ? { ...mItem, text, status: "done" as const, tokens: (usage?.completion_tokens || 0) }
                : mItem
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
            prev.map((mItem) => {
              if (mItem.id === c.agentA) return { ...mItem, conflictHighlights: [...mItem.conflictHighlights, c.claimA] };
              if (mItem.id === c.agentB) return { ...mItem, conflictHighlights: [...mItem.conflictHighlights, c.claimB] };
              return mItem;
            })
          );
        }
        break;
      }
      case "agent_message":
      case "debate_exchange": {
        const exchange: DebateExchange = {
          from: data.from as string,
          to: data.to as string,
          content: data.content as string,
          type: data.type as string,
          timestamp: new Date().toISOString(),
        };
        setExchanges((prev) => [...prev, exchange]);
        setMembers((prev) =>
          prev.map((mItem) => {
            if (mItem.name === (data.to as string)) {
              return {
                ...mItem,
                status: "debating" as const,
                critiques: [...mItem.critiques, { from: data.from as string, content: (data.content as string).substring(0, 200), type: data.type as string || "critique" }],
              };
            }
            return mItem;
          })
        );
        break;
      }
      case "synthesis_complete":
        setSynthesis(data.consensus as string);
        setRunning(false);
        if (data.consensus) playTTS(data.consensus as string);
        break;
      case "confidence_score":
        setConsensusScore(data.score as number);
        setConsensusBreakdown(data.breakdown as Record<string, any>);
        break;
      case "orchestration_error":
        setRunning(false);
        eventSourceRef.current?.close();
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDebate = useCallback(async () => {
    if (!query.trim() || running) return;
    setRunning(true);
    setMembers([]);
    setConflicts([]);
    setExchanges([]);
    setSynthesis(null);
    setConsensusScore(null);
    setFactsCount(0);

    try {
      const res = await fetchWithAuth("/api/council/debate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!res.ok) { setRunning(false); return; }
      const { sessionId } = await res.json();
      const abortController = new AbortController();
      eventSourceRef.current = { close: () => abortController.abort() };

      fetchWithAuth(`/api/council/debate/${sessionId}/stream`, { signal: abortController.signal })
        .then(async (streamRes) => {
            if (!streamRes.body) return;
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
                        try { handleEvent(JSON.parse(line.slice(6))); } catch(_e){ /* ignore malformed chunks */ }
                    }
                }
            }
            setRunning(false);
        }).catch(() => setRunning(false));
    } catch (_err) { setRunning(false); }
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
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
      }
    } catch (_err) { /* ignore tts errors */ }
  };

  const meterPercent = consensusScore !== null ? Math.round(consensusScore * 100) : 0;
  const meterColor = consensusScore === null ? "bg-white/10" : consensusScore < 0.4 ? "bg-[var(--accent-coral)]" : consensusScore < 0.7 ? "bg-[var(--accent-gold)]" : "bg-[var(--accent-mint)]";

  return (
    <div className="h-full flex flex-col bg-[#000000] relative overflow-hidden selection:bg-[var(--accent-mint)]/30 font-sans">
      <TechnicalGrid />
      
      {/* ━━━ Header HUD ━━━ */}
      <div className="shrink-0 relative z-20">
        <SectorHUD 
          sectorId="SYNC-06" 
          title="Deliberation_Arena" 
          subtitle="Adversarial Logic Engine // Real-time conflict resolution"
          accentColor="var(--accent-coral)"
          telemetry={[
            { label: "NODES", value: String(members.length), status: "online" },
            { label: "TRUTH", value: String(factsCount), status: "optimal" },
            { label: "UPLINK", value: "SECURE", status: "optimal" }
          ]}
        />

        {/* Action Bar */}
        <div className="mt-10 px-10 flex gap-4 max-w-5xl">
            <div className="relative flex-1 group">
                <div className="absolute inset-0 bg-white/[0.01] rounded-3xl pointer-events-none group-focus-within:bg-[var(--accent-mint)]/[0.02] transition-colors" />
                <Send size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-[var(--accent-mint)] opacity-30 group-focus-within:opacity-100 transition-all" />
                <input
                    className="w-full bg-black/40 border border-white/5 rounded-3xl pl-16 pr-6 py-5 text-sm text-white placeholder:text-white/10 focus:outline-none focus:border-[var(--accent-mint)]/40 transition-all font-diag uppercase tracking-tighter"
                    placeholder="DEFINE_LOGIC_PARAMETER_FOR_DELIBERATION..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && startDebate()}
                    disabled={running}
                />
            </div>
            <button
                onClick={startDebate}
                disabled={running || !query.trim()}
                className="px-10 h-[64px] rounded-3xl bg-[var(--accent-mint)] text-black font-black uppercase tracking-[0.3em] text-[10px] shadow-[0_0_40px_rgba(110,231,183,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-20 disabled:grayscale flex items-center gap-4"
            >
                {running ? <Activity size={16} className="animate-spin" /> : <Zap size={16} fill="currentColor" strokeWidth={0} />}
                {running ? "PROCESSING" : "EXECUTE"}
            </button>
            <button
                onClick={() => setVoiceMode(!voiceMode)}
                className={`flex items-center gap-3 h-[64px] px-6 rounded-3xl border transition-all font-diag text-[9px] font-black uppercase tracking-widest ${
                    voiceMode 
                    ? "bg-[var(--accent-mint)]/10 border-[var(--accent-mint)]/40 text-[var(--accent-mint)] shadow-[0_0_20px_rgba(110,231,183,0.1)]" 
                    : "bg-white/[0.02] border-white/5 text-white/30 hover:text-white"
                }`}
            >
                {voiceMode ? <Volume2 size={16} /> : <VolumeX size={16} />}
                {voiceMode ? "Audio_Live" : "Audio_Muted"}
            </button>
        </div>
      </div>

      {/* ━━━ Telemetry Strip ━━━ */}
      <AnimatePresence>
        {(members.length > 0 || factsCount > 0) && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="shrink-0 flex gap-12 px-10 py-6 border-y border-white/5 mt-10 bg-white/[0.01] backdrop-blur-3xl relative z-20"
          >
            {[
              { label: "Neural_Nodes", val: members.length, color: "text-[var(--accent-mint)]" },
              { label: "Truth_Vectors", val: factsCount, color: "text-[var(--accent-blue)]" },
              { label: "Conflict_Points", val: conflicts.length, color: "text-[var(--accent-coral)]" },
              { label: "Comm_Bursts", val: exchanges.length, color: "text-[var(--accent-gold)]" },
            ].map((s, i) => (
                <div key={i} className="flex flex-col gap-1">
                    <span className="text-[8px] font-diag text-white/20 uppercase tracking-[0.3em] font-black">{s.label}</span>
                    <div className={`text-2xl font-black font-mono tracking-tighter ${s.color}`}>
                        <AnimatedCounter value={s.val} />
                    </div>
                </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ━━━ Arena View ━━━ */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-10 scrollbar-custom relative z-10">
        {members.length === 0 && !running ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-20 group">
                <div className="w-32 h-32 rounded-[2rem] bg-white/[0.02] border border-white/5 flex items-center justify-center mb-10 group-hover:border-[var(--accent-mint)]/20 transition-all duration-700">
                    <Swords size={48} className="text-white group-hover:text-[var(--accent-mint)] transition-all duration-700" />
                </div>
                <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter mb-4">Arena_Idle</h2>
                <p className="text-[10px] font-diag text-white/40 uppercase tracking-[0.4em]">Awaiting high-fidelity deliberative input...</p>
            </div>
        ) : (
            <div className="flex gap-10 h-full min-w-max pb-10">
                {members.map((mItem, idx) => (
                    <motion.div
                        key={mItem.id}
                        initial={{ opacity: 0, x: 50 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="w-[480px] flex flex-col glass-panel rounded-[2rem] overflow-hidden border border-white/5 shadow-2xl relative group/card"
                    >
                        {/* Unit Badge */}
                        <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between relative bg-white/[0.02]">
                            <div className="flex items-center gap-5">
                                <div className="w-14 h-14 rounded-3xl border border-white/10 flex items-center justify-center text-xl font-black italic shadow-inner bg-gradient-to-br from-white/10 to-transparent">
                                    {mItem.name[0]}
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-black text-white tracking-widest uppercase italic">{mItem.name}</span>
                                    <span className="text-[8px] font-diag text-[var(--accent-mint)] uppercase tracking-[0.2em] mt-1 opacity-60">Neural_Class: {mItem.model || "Core_Unit"}</span>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5">
                                    <span className="text-[8px] font-mono text-white/20 uppercase tracking-widest">{mItem.status}</span>
                                    <div className={`w-1.5 h-1.5 rounded-full ${mItem.status === "thinking" ? "bg-[var(--accent-gold)] animate-pulse" : mItem.status === "debating" ? "bg-[var(--accent-coral)] animate-bounce" : "bg-[var(--accent-mint)]"}`} />
                                </div>
                                <span className="text-[9px] font-mono text-white/10">{mItem.tokens} tkn</span>
                            </div>
                        </div>

                        {/* Inference Terminal */}
                        <div
                            ref={(el) => { if (el) columnRefs.current.set(mItem.id, el); }}
                            className="flex-1 p-8 overflow-y-auto scrollbar-custom text-sm font-diag font-medium text-white/60 leading-relaxed space-y-6"
                            aria-live="polite"
                            aria-atomic="false"
                        >
                            {mItem.text ? (
                                <div className="whitespace-pre-wrap selection:bg-[var(--accent-mint)]/20">
                                    {mItem.text}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center gap-4 opacity-20">
                                    <Activity size={24} className="text-[var(--accent-mint)] animate-pulse" />
                                    <span className="text-[9px] font-diag uppercase tracking-[0.3em] font-black">STREAMING_NEURAL_PULSE...</span>
                                </div>
                            )}

                            {/* Conflicts / Critiques */}
                            <AnimatePresence>
                                {mItem.critiques.length > 0 && (
                                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-4">
                                        <div className="text-[8px] font-diag text-[var(--accent-coral)] uppercase tracking-[0.4em] font-black flex items-center gap-3">
                                            <ShieldAlert size={10} /> Conflict_Report
                                        </div>
                                        {mItem.critiques.map((c, i) => (
                                            <div key={i} className="p-5 rounded-2xl bg-red-400/[0.03] border border-red-400/10 hover:border-red-400/30 transition-all">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <span className="text-[8px] font-black text-red-100 bg-red-500/20 px-2 py-0.5 rounded uppercase tracking-widest">{c.from}</span>
                                                    <span className="text-[8px] font-diag text-white/20 uppercase tracking-widest font-black italic">{c.type}</span>
                                                </div>
                                                <p className="text-[10px] italic text-white/50 leading-relaxed font-diag">{c.content}</p>
                                            </div>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                ))}
            </div>
        )}
      </div>

      {/* ━━━ Synthesis Footprints ━━━ */}
      <AnimatePresence>
        {synthesis && (
            <motion.div
                initial={{ y: 200 }}
                animate={{ y: 0 }}
                exit={{ y: 200 }}
                className="shrink-0 bg-black/80 backdrop-blur-3xl border-t border-[var(--accent-mint)]/20 p-10 relative z-30"
                aria-live="assertive"
                aria-label="Council synthesis verdict"
            >
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[var(--accent-mint)] to-transparent" />
                <div className="max-w-7xl mx-auto flex gap-12">
                    <div className="w-80 flex-shrink-0">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 rounded-2xl bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] flex items-center justify-center">
                                <Gavel size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-white italic tracking-tighter uppercase">COUNCIL_VERDICT</h3>
                                <p className="text-[8px] font-diag text-[var(--accent-mint)] uppercase tracking-[0.3em] font-black">Final_Sythesis_v9.2</p>
                            </div>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="flex justify-between items-end">
                                <span className="text-[9px] font-diag text-white/20 uppercase tracking-widest font-black">Consensus_Confidence</span>
                                <span className="text-xl font-black text-[var(--accent-mint)] font-mono">{meterPercent}%</span>
                            </div>
                            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                                <motion.div 
                                    initial={{ width: 0 }} 
                                    animate={{ width: `${meterPercent}%` }} 
                                    className={`h-full ${meterColor} shadow-[0_0_20px_var(--accent-mint)]`}
                                />
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex-1 p-8 rounded-3xl bg-white/[0.01] border border-white/5 max-h-[300px] overflow-y-auto scrollbar-custom">
                        <div className="text-sm font-diag font-medium text-white/70 leading-relaxed italic border-l-2 border-[var(--accent-mint)]/30 pl-8">
                            {synthesis}
                        </div>
                    </div>
                </div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
