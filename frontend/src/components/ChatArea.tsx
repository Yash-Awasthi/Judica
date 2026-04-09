import { useState, useRef, useEffect } from "react";
import { MessageList } from "./MessageList.js";
import { InputArea } from "./InputArea.js";
import { StreamingStatus } from "./StreamingStatus.js";
import { CouncilConfigPanel } from "./CouncilConfigPanel.js";
import type { ChatMessage, CouncilMember } from "../types/index.js";

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
  const [visibleKeyIds, setVisibleKeyIds] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
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
    onSendMessage(text, summon, useStream, rounds);
  };

  const getMemberColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return MEMBER_COLORS[Math.abs(hash) % MEMBER_COLORS.length];
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

          <StreamingStatus isLoading={false} isStreaming={isStreaming} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowMemberConfig(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-accent/80 hover:text-accent hover:bg-accent/10 rounded-xl transition-all uppercase tracking-widest border border-accent/20 hover:border-accent/40"
          >
            <span className="material-symbols-outlined text-[16px]">groups</span>
            <span className="hidden sm:inline">Council Settings</span>
          </button>

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
        </div>
      </header>

      {/* Loading overlay */}
      <StreamingStatus isLoading={isLoading} isStreaming={false} />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pt-20 pb-32 px-4 md:px-8 scrollbar-custom">
        <MessageList
          messages={messages}
          playingAudioId={playingAudioId}
          onPlayTTS={handlePlayTTS}
          getMemberColor={getMemberColor}
          visibleKeyIds={visibleKeyIds}
          setVisibleKeyIds={setVisibleKeyIds}
        />
      </div>

      {/* Input stays at bottom naturally */}
      <div className="shrink-0 mb-4 flex justify-center w-full">
        <CouncilConfigPanel
          isOpen={showMemberConfig}
          onClose={() => setShowMemberConfig(false)}
          summon={summon}
          onSummonChange={setSummon}
          rounds={rounds}
          onRoundsChange={setRounds}
          members={members}
          onAddMember={() => onUpdateMembers([...members, { id: Date.now().toString(), name: "New Member", type: "openai-compat", role: "Default", tone: "Concise" }])}
          onRemoveMember={(id) => onUpdateMembers(members.filter(m => m.id !== id))}
          onUpdateMember={(id, field, value) => onUpdateMembers(members.map(m => m.id === id ? { ...m, [field]: value } : m))}
        />
        <InputArea
          input={input}
          setInput={setInput}
          useStream={useStream}
          setUseStream={setUseStream}
          isStreaming={isStreaming}
          onSend={handleSend}
          placeholder="Ask the council anything..."
        />
      </div>

      {/* BG decoration */}
      <div className="fixed inset-0 pointer-events-none -z-10 bg-black">
        <div className="absolute top-[-5%] left-[20%] w-[500px] h-[500px] bg-accent/4 blur-[120px] rounded-full opacity-25 animate-glow-pulse" />
      </div>
    </div>
  );
}
