import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface Opinion {
  name: string;
  archetype: string;
  opinion: string;
}

export interface ChatMessage {
  id: string;
  question: string;
  verdict?: string;
  opinions?: Opinion[];
  durationMs?: number;
  cacheHit?: boolean;
}

import type { CouncilMember } from "../App";

interface ChatAreaProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string, summon: string, useStream: boolean, rounds: number) => void;
  onToggleSidebar: () => void;
  activeTitle: string;
  defaultSummon?: string;
  onExport?: (format: "markdown" | "json") => void;
  members: CouncilMember[];
  onUpdateMembers: (members: CouncilMember[]) => void;
  isLoading?: boolean;
}

const ROLES = ["Default", "Analyst", "Devil's Advocate", "Optimist", "Pessimist", "Expert", "Critic", "Creative", "Pragmatist"];
const TONES = ["Concise", "Detailed", "Blunt", "Diplomatic", "Academic", "Casual"];

const ROLE_PRESETS: Record<string, string> = {
  "Default": "Respond directly and helpfully.",
  "Analyst": "Analyze systematically. Use data and logic. Break down into clear points.",
  "Devil's Advocate": "Challenge assumptions. Argue the opposite view. Be provocative but logical.",
  "Optimist": "Focus on opportunities, benefits, and positive outcomes.",
  "Pessimist": "Focus on risks, downsides, and what could go wrong.",
  "Expert": "Respond as a domain expert. Be precise and authoritative.",
  "Critic": "Identify flaws, weaknesses, and gaps in any argument.",
  "Creative": "Think outside the box. Suggest unconventional ideas.",
  "Pragmatist": "Focus only on practical, actionable real-world solutions.",
};

const TONE_PRESETS: Record<string, string> = {
  "Concise": "Be brief and to the point.",
  "Detailed": "Be thorough and comprehensive.",
  "Blunt": "Be direct and unfiltered.",
  "Diplomatic": "Be tactful and considerate.",
  "Academic": "Use formal academic language.",
  "Casual": "Use simple conversational language.",
};

// Color palette for member avatars — rich, distinct colors
const MEMBER_COLORS = [
  { bg: "#5eead4", shadow: "rgba(94,234,212,0.3)" },
  { bg: "#60a5fa", shadow: "rgba(96,165,250,0.3)" },
  { bg: "#a78bfa", shadow: "rgba(167,139,250,0.3)" },
  { bg: "#fb923c", shadow: "rgba(251,146,60,0.3)" },
  { bg: "#34d399", shadow: "rgba(52,211,153,0.3)" },
  { bg: "#f472b6", shadow: "rgba(244,114,182,0.3)" },
];

export function ChatArea({
  messages,
  isStreaming,
  onSendMessage,
  onToggleSidebar,
  activeTitle,
  defaultSummon = "default",
  onExport,
  members,
  onUpdateMembers,
  isLoading = false
}: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [summon, setSummon] = useState(defaultSummon);
  const [rounds, setRounds] = useState(3);
  const [useStream, setUseStream] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [showMemberConfig, setShowMemberConfig] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayTTS = async (msgId: string, text: string) => {
    if (playingAudioId === msgId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingAudioId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingAudioId(msgId);
    try {
      const token = localStorage.getItem("council_token");
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ text })
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingAudioId(null);
      audio.onerror = () => setPlayingAudioId(null);
      audio.play();
    } catch (err) {
      console.error(err);
      setPlayingAudioId(null);
    }
  };

  useEffect(() => {
    setSummon(defaultSummon);
  }, [defaultSummon]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    onSendMessage(text, summon, useStream, rounds);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px";
  };

  const getMemberColor = (index: number) => MEMBER_COLORS[index % MEMBER_COLORS.length];

  const mdComponents = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code: ({ className, children, ...props }: any) => {
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return (
          <pre className="bg-white/[0.04] border border-white/8 rounded-xl p-4 overflow-x-auto my-3 text-xs font-mono leading-relaxed scrollbar-custom">
            <code className={className} {...props}>{children}</code>
          </pre>
        );
      }
      return (
        <code className="bg-white/[0.06] border border-white/8 rounded px-1.5 py-0.5 text-accent/80 text-[0.85em] font-mono" {...props}>
          {children}
        </code>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: ({ children }: any) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ul: ({ children }: any) => <ul className="list-disc list-inside mb-3 space-y-1 text-text-muted">{children}</ul>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ol: ({ children }: any) => <ol className="list-decimal list-inside mb-3 space-y-1 text-text-muted">{children}</ol>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    li: ({ children }: any) => <li className="text-sm leading-relaxed">{children}</li>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strong: ({ children }: any) => <strong className="font-bold text-text">{children}</strong>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blockquote: ({ children }: any) => (
      <blockquote className="pl-4 border-l-2 border-accent/30 text-text-muted my-3 italic">{children}</blockquote>
    ),
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-bg relative">

      {/* Top NavBar */}
      <header className="fixed top-0 right-0 left-0 md:left-[var(--sidebar-w,16rem)] h-14 z-40 flex items-center justify-between px-5 md:px-8 bg-black/85 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onToggleSidebar}
            className="md:hidden p-2 -ml-2 text-text-muted hover:text-text rounded-lg transition-colors hover:bg-white/5"
          >
            <span className="material-symbols-outlined text-[20px]">menu</span>
          </button>

          <div className="min-w-0">
            <h2 className="text-text font-semibold text-sm truncate max-w-[180px] sm:max-w-xs md:max-w-md">
              {activeTitle}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/[0.03] border border-white/8 text-[9px] font-black uppercase tracking-[0.2em] text-text-dim shrink-0 hidden sm:flex">
            <span className="status-dot bg-accent text-accent animate-pulse" />
            Live Bridge
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setShowExport(!showExport)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-text-muted hover:text-text hover:bg-white/5 rounded-xl transition-all uppercase tracking-widest"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              <span className="hidden sm:inline">Export</span>
            </button>

            {showExport && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)} />
                <div className="absolute top-full right-0 mt-2 w-44 glass-panel rounded-xl shadow-2xl z-50 py-2 animate-fade-in border border-white/8">
                  <div className="px-3 py-1.5 text-[9px] font-black text-text-dim uppercase tracking-widest">Export As</div>
                  {[
                    { format: "markdown" as const, icon: "description", label: "Markdown (.md)" },
                    { format: "json" as const, icon: "data_object", label: "JSON (.json)" },
                  ].map(({ format, icon, label }) => (
                    <button
                      key={format}
                      onClick={() => { onExport?.(format); setShowExport(false); }}
                      className="w-full px-3 py-2 text-xs text-left text-text-muted hover:bg-accent/8 hover:text-accent flex items-center gap-2.5 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">{icon}</span>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="w-px h-4 bg-white/10 hidden sm:block" />

          {/* Council config toggle */}
          <button
            onClick={() => setShowMemberConfig(!showMemberConfig)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest border ${
              showMemberConfig
                ? "bg-accent/8 border-accent/20 text-accent"
                : "border-white/[0.06] text-text-muted hover:border-white/10 hover:text-text"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">groups</span>
            <span className="hidden sm:inline">Council</span>
          </button>
        </div>
      </header>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-accent/15 border-t-accent rounded-full animate-spin shadow-glow" />
            <span className="text-xs text-accent font-black uppercase tracking-[0.2em] animate-pulse">
              Syncing Neural Link...
            </span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pt-20 pb-52 px-4 md:px-8 space-y-10 scrollbar-custom">
        {messages.map((msg, idx) => (
          <div key={msg.id || idx} className="max-w-3xl mx-auto space-y-6 animate-slide-up">

            {/* User question bubble */}
            <div className="flex justify-end">
              <div className="glass-panel px-5 py-3.5 rounded-2xl rounded-tr-sm max-w-[85%] md:max-w-[75%] text-sm leading-relaxed shadow-2xl text-text border border-white/[0.06]">
                {msg.question}
              </div>
            </div>

            {/* Opinions */}
            {(msg.opinions?.length ?? 0) > 0 && (
              <div className="space-y-5">
                {msg.opinions?.map((op, i) => {
                  const color = getMemberColor(i);
                  return (
                    <div
                      key={i}
                      className="animate-slide-up"
                      style={{ animationDelay: `${i * 100}ms` }}
                    >
                      {/* Member header */}
                      <div className="flex items-center gap-3 mb-2">
                        <div
                          className="member-avatar"
                          style={{
                            backgroundColor: color.bg,
                            boxShadow: `0 0 12px -3px ${color.shadow}`
                          }}
                        >
                          {op.name[0]}
                        </div>
                        <div>
                          <span className="text-xs font-bold text-text tracking-tight">{op.name}</span>
                          {op.archetype && (
                            <span className="ml-2 text-[9px] uppercase tracking-[0.2em] font-black"
                              style={{ color: color.bg }}
                            >
                              {op.archetype}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Opinion body with accent-left border */}
                      <div
                        className="ml-11 pl-4 py-2 text-sm text-text-muted leading-relaxed border-l-2"
                        style={{ borderColor: `${color.bg}25` }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={mdComponents}
                        >
                          {op.opinion}
                        </ReactMarkdown>
                      </div>
                    </div>
                  );
                })}

                {/* Verdict */}
                {msg.verdict && (
                  <div className="mt-8 verdict-box rounded-2xl p-6 animate-slide-up">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-1 h-5 bg-accent rounded-full" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">
                          Final Verdict
                        </span>
                      </div>
                      
                      <button 
                        onClick={() => handlePlayTTS(msg.id || "temp", msg.verdict!)}
                        disabled={isStreaming}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {playingAudioId === (msg.id || "temp") ? (
                          <div className="flex items-center gap-1">
                            <span className="w-1 h-2 bg-accent animate-pulse" style={{ animationDelay: "0ms" }} />
                            <span className="w-1 h-3 bg-accent animate-pulse" style={{ animationDelay: "150ms" }} />
                            <span className="w-1 h-2 bg-accent animate-pulse" style={{ animationDelay: "300ms" }} />
                          </div>
                        ) : (
                          <span className="material-symbols-outlined text-[16px]">volume_up</span>
                        )}
                        <span className="text-[9px] font-black uppercase tracking-widest hidden sm:inline">
                          {playingAudioId === (msg.id || "temp") ? "Stop" : "Listen"}
                        </span>
                      </button>
                    </div>

                    {/* Verdict text with Markdown */}
                    <div className="text-[15px] leading-relaxed text-text font-medium [&>p]:mb-3 [&>p:last-child]:mb-0">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={mdComponents}
                      >
                        {msg.verdict}
                      </ReactMarkdown>
                    </div>

                    {/* Meta info */}
                    {(msg.durationMs || msg.cacheHit) && (
                      <div className="mt-5 pt-4 border-t border-accent/10 flex items-center gap-5 text-[9px] font-black text-text-dim uppercase tracking-wider">
                        {msg.durationMs && (
                          <span className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[12px] text-text-dim">timer</span>
                            {(msg.durationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                        {msg.cacheHit && (
                          <span className="flex items-center gap-1.5 text-accent">
                            <span className="w-1.5 h-1.5 bg-accent rounded-full" />
                            Instant Recall
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="max-w-3xl mx-auto flex items-center gap-3 text-text-muted text-xs font-medium animate-fade-in">
            <div className="flex gap-1">
              {[0, 0.15, 0.3].map((delay) => (
                <div
                  key={delay}
                  className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce"
                  style={{ animationDelay: `${delay}s` }}
                />
              ))}
            </div>
            <span className="text-accent text-[10px] uppercase font-black tracking-widest">The Council is deliberating...</span>
          </div>
        )}

        {/* Member config panel (inline) */}
        {showMemberConfig && (
          <div className="max-w-3xl mx-auto animate-slide-up">
            <div className="glass-panel p-6 rounded-2xl border border-white/8 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-accent text-base">settings</span>
                  <h3 className="text-xs font-black uppercase tracking-[0.2em] text-text">Council Configuration</h3>
                </div>
                <button
                  onClick={() => setShowMemberConfig(false)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors text-text-muted hover:text-text"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] text-text-dim uppercase tracking-widest font-bold">Total Members: {members.length}</span>
                <button
                  onClick={() => {
                    const newMember = {
                      id: Math.random().toString(36).substring(7),
                      name: "New Member",
                      type: "openai-compat" as const,
                      apiKey: "",
                      model: "gpt-4o-mini",
                      active: true,
                      role: "Default",
                      tone: "Concise",
                      customBehaviour: "Respond helpfully."
                    };
                    onUpdateMembers([...members, newMember]);
                  }}
                  className="px-3 py-1 bg-accent/10 hover:bg-accent/20 text-accent text-[9px] font-black uppercase tracking-widest rounded-lg flex items-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  Add Member
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto scrollbar-custom pr-2">
                {members.map((member, idx) => {
                  return (
                    <div
                      key={member.id}
                      className={`p-4 rounded-xl border transition-all ${
                        member.active
                          ? "bg-white/[0.025] border-white/8"
                          : "bg-black/30 border-white/[0.03] opacity-50"
                      }`}
                    >
                      {/* Member header */}
                      <div className="flex items-center justify-between mb-3 border-b border-white/[0.04] pb-3">
                        <div className="flex items-center gap-2 flex-1 mr-2">
                          <input
                            type="text"
                            value={member.name}
                            onChange={(e) => {
                              const newMembers = [...members];
                              newMembers[idx] = { ...member, name: e.target.value };
                              onUpdateMembers(newMembers);
                            }}
                            className="bg-transparent border-none text-[12px] font-bold text-text outline-none focus:ring-0 p-0 w-full"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              onUpdateMembers(members.filter((_, i) => i !== idx));
                            }}
                            className="text-danger/50 hover:text-danger transition-colors p-1"
                            title="Delete Member"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                          <label className="relative cursor-pointer">
                          <input
                            type="checkbox"
                            checked={member.active}
                            onChange={(e) => {
                              const newMembers = [...members];
                              newMembers[idx] = { ...member, active: e.target.checked };
                              onUpdateMembers(newMembers);
                            }}
                            className="sr-only"
                          />
                          <div
                            className={`w-7 h-4 rounded-full transition-colors ${member.active ? "bg-accent/40" : "bg-white/10"}`}
                          >
                            <div
                              className={`absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-all ${
                                member.active ? "right-0.5 bg-accent" : "left-0.5 bg-text-dim"
                              }`}
                            />
                          </div>
                        </label>
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <div className="grid grid-cols-2 gap-2">
                          {/* Role */}
                          <div className="space-y-1">
                            <label className="text-[8px] text-text-dim uppercase font-black tracking-widest">Role</label>
                            <select
                              value={member.role}
                              onChange={(e) => {
                                const role = e.target.value;
                                const newMembers = [...members];
                                const customPrompt = `${ROLE_PRESETS[role]} ${TONE_PRESETS[member.tone]}`;
                                newMembers[idx] = { ...member, role, customBehaviour: customPrompt };
                                onUpdateMembers(newMembers);
                              }}
                              className="w-full bg-black/50 border border-white/8 rounded-lg text-[10px] text-text p-1 outline-none focus:border-accent/30"
                            >
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>

                          {/* Tone */}
                          <div className="space-y-1">
                            <label className="text-[8px] text-text-dim uppercase font-black tracking-widest">Tone</label>
                            <select
                              value={member.tone}
                              onChange={(e) => {
                                const tone = e.target.value;
                                const newMembers = [...members];
                                const customPrompt = `${ROLE_PRESETS[member.role]} ${TONE_PRESETS[tone]}`;
                                newMembers[idx] = { ...member, tone, customBehaviour: customPrompt };
                                onUpdateMembers(newMembers);
                              }}
                              className="w-full bg-black/50 border border-white/8 rounded-lg text-[10px] text-text p-1 outline-none focus:border-accent/30"
                            >
                              {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* System override */}
                        <div className="space-y-1">
                          <label className="text-[8px] text-text-dim uppercase font-black tracking-widest">System Override</label>
                          <textarea
                            value={member.customBehaviour}
                            onChange={(e) => {
                              const newMembers = [...members];
                              newMembers[idx] = { ...member, customBehaviour: e.target.value };
                              onUpdateMembers(newMembers);
                            }}
                            rows={2}
                            className="w-full bg-black/50 border border-white/8 rounded-lg text-[10px] text-text p-2 outline-none resize-none scrollbar-custom focus:border-accent/30 transition-colors"
                            placeholder="Inject custom instructions..."
                          />
                        </div>

                        {/* API Key */}
                        <div className="space-y-1">
                          <label className="text-[8px] text-text-dim uppercase font-black tracking-widest">API Key</label>
                          <input
                            type="password"
                            value={member.apiKey}
                            onChange={(e) => {
                              const newMembers = [...members];
                              newMembers[idx] = { ...member, apiKey: e.target.value };
                              onUpdateMembers(newMembers);
                            }}
                            className="w-full bg-black/50 border border-white/8 rounded-lg text-[10px] text-text p-1.5 outline-none focus:border-accent/30 font-mono"
                            placeholder="sk-..."
                          />
                        </div>

                        {/* Model & provider row */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[8px] text-text-dim uppercase font-black tracking-widest">Model Name</label>
                            <input
                              type="text"
                              value={member.model}
                              onChange={(e) => {
                                const newMembers = [...members];
                                newMembers[idx] = { ...member, model: e.target.value };
                                onUpdateMembers(newMembers);
                              }}
                              className="w-full bg-black/50 border border-white/8 rounded-lg text-[10px] text-text p-1.5 outline-none focus:border-accent/30 font-mono"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] text-text-dim uppercase font-black tracking-widest">Type</label>
                            <select
                              value={member.type}
                              onChange={(e) => {
                                const newMembers = [...members];
                                newMembers[idx] = { ...member, type: e.target.value as any };
                                onUpdateMembers(newMembers);
                              }}
                              className="w-full bg-black/50 border border-white/8 rounded-lg text-[10px] text-text p-1.5 outline-none focus:border-accent/30"
                            >
                              <option value="openai-compat">OpenAI-Compat</option>
                              <option value="google">Google</option>
                              <option value="anthropic">Anthropic</option>
                            </select>
                          </div>
                        </div>

                        {/* Base URL (Optional) */}
                        <div className="space-y-1">
                          <label className="text-[8px] text-text-dim uppercase font-black tracking-widest">Base URL (optional)</label>
                          <input
                            type="url"
                            value={member.baseUrl || ""}
                            onChange={(e) => {
                              const newMembers = [...members];
                              newMembers[idx] = { ...member, baseUrl: e.target.value };
                              onUpdateMembers(newMembers);
                            }}
                            className="w-full bg-black/50 border border-white/8 rounded-lg text-[10px] text-text p-1.5 outline-none focus:border-accent/30 font-mono"
                            placeholder="e.g. https://api.openai.com/v1"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky input bar */}
      <section className="fixed bottom-0 right-0 left-0 md:left-[var(--sidebar-w,16rem)] p-4 md:p-6 flex justify-center bg-gradient-to-t from-bg via-bg/96 to-transparent z-40 pointer-events-none">
        <div className="w-full max-w-3xl bg-[#090909] rounded-2xl shadow-2xl overflow-hidden border border-white/[0.06] pointer-events-auto">

          {/* Controls bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.015] border-b border-white/[0.04]">
            <div className="flex items-center gap-4">
              {/* Summon selector */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-text-dim uppercase font-black tracking-widest">Summon:</span>
                <select
                  value={summon}
                  onChange={e => setSummon(e.target.value)}
                  className="bg-transparent border-none text-xs text-accent font-bold focus:ring-0 cursor-pointer outline-none"
                >
                  {[
                    ["default", "General Council"],
                    ["debate", "Debate Council"],
                    ["research", "Research Council"],
                    ["technical", "Technical Council"],
                    ["creative", "Creative Council"],
                    ["business", "Business Council"],
                  ].map(([val, label]) => (
                    <option key={val} className="bg-black text-text" value={val}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="h-3 w-px bg-white/10 hidden sm:block" />

              {/* Rounds selector */}
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-[9px] text-text-dim uppercase font-black tracking-widest">Rounds:</span>
                <select
                  value={rounds}
                  onChange={e => setRounds(parseInt(e.target.value))}
                  className="bg-transparent border-none text-xs text-text font-semibold focus:ring-0 cursor-pointer outline-none"
                >
                  <option className="bg-black" value="1">1 Round</option>
                  <option className="bg-black" value="3">3 Rounds (Rec)</option>
                  <option className="bg-black" value="5">5 Rounds (Deep)</option>
                </select>
              </div>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-3">
              {/* Stream toggle */}
              <label className="flex items-center gap-2 cursor-pointer group">
                <span className="text-[9px] text-text-dim uppercase font-black tracking-widest group-hover:text-text-muted transition-colors hidden sm:block">
                  Stream
                </span>
                <button
                  type="button"
                  onClick={() => setUseStream(!useStream)}
                  className={`relative w-8 h-4 rounded-full transition-colors ${useStream ? "bg-accent/40" : "bg-white/10"}`}
                  role="switch"
                  aria-checked={useStream}
                >
                  <div
                    className={`absolute top-0.5 w-3 h-3 rounded-full shadow transition-all ${
                      useStream ? "right-0.5 bg-accent" : "left-0.5 bg-text-dim"
                    }`}
                  />
                </button>
              </label>

              <div className="h-3 w-px bg-white/10 hidden sm:block" />

              {/* Active member count */}
              <button
                onClick={() => setShowMemberConfig(!showMemberConfig)}
                className="flex items-center gap-1.5 text-[9px] text-text-dim uppercase font-black tracking-widest hover:text-accent transition-colors"
              >
                <span className="material-symbols-outlined text-[13px]">group</span>
                <span className="hidden sm:inline">{members.filter(m => m.active).length} active</span>
              </button>
            </div>
          </div>

          {/* Text area + send button */}
          <div className="relative flex items-end p-3 gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent border-none focus:ring-0 text-text text-sm p-3 min-h-[52px] max-h-32 resize-none placeholder:text-white/15 outline-none scrollbar-custom leading-relaxed"
              placeholder="State your case for council deliberation..."
              rows={1}
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              className="w-10 h-10 rounded-xl bg-accent text-black flex items-center justify-center transition-all hover:brightness-110 active:scale-90 shadow-glow disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed flex-shrink-0 mb-1"
            >
              {isStreaming ? (
                <div className="w-4 h-4 border-2 border-black/20 border-t-black/70 rounded-full animate-spin" />
              ) : (
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
              )}
            </button>
          </div>

          {/* Footer status */}
          <div className="px-5 py-2.5 bg-white/[0.008] border-t border-white/[0.03] hidden md:flex items-center justify-between text-[9px] text-text-dim font-mono uppercase tracking-widest">
            <div className="flex items-center gap-4">
              <span>{members.filter(m => m.active).length} members active</span>
              <div className="w-16 h-0.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent/50 rounded-full transition-all"
                  style={{ width: `${(members.filter(m => m.active).length / members.length) * 100}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span>v1.0 — magistrate</span>
            </div>
          </div>
        </div>
      </section>

      {/* BG decoration */}
      <div className="fixed inset-0 pointer-events-none -z-10 bg-black">
        <div className="absolute top-[-5%] left-[20%] w-[500px] h-[500px] bg-accent/4 blur-[120px] rounded-full opacity-25 animate-glow-pulse" />
      </div>
    </div>
  );
}
