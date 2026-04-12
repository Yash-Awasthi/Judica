import { useReducer, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings2, Download, FileText, FileJson } from "lucide-react";
import { MessageList } from "./MessageList.js";
import { InputArea } from "./InputArea.js";
import { StreamingStatus } from "./StreamingStatus.js";
import { CouncilConfigPanel } from "./CouncilConfigPanel.js";
import { SkeletonLoader } from "./SkeletonLoader.js";
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

// Color palette for member avatars
const MEMBER_COLORS = [
  { bg: "#5eead4", shadow: "rgba(94,234,212,0.3)" },
  { bg: "#60a5fa", shadow: "rgba(96,165,250,0.3)" },
  { bg: "#a78bfa", shadow: "rgba(167,139,250,0.3)" },
  { bg: "#fb923c", shadow: "rgba(251,146,60,0.3)" },
  { bg: "#34d399", shadow: "rgba(52,211,153,0.3)" },
  { bg: "#f472b6", shadow: "rgba(244,114,182,0.3)" },
];

interface ChatAreaState {
  input: string;
  summon: string;
  rounds: number;
  useStream: boolean;
  showExport: boolean;
  showMemberConfig: boolean;
  playingAudioId: string | null;
  visibleKeyIds: Record<string, boolean>;
}

type ChatAreaAction =
  | { type: "SET_INPUT"; payload: string }
  | { type: "SET_SUMMON"; payload: string }
  | { type: "SET_ROUNDS"; payload: number }
  | { type: "SET_USE_STREAM"; payload: boolean }
  | { type: "SET_SHOW_EXPORT"; payload: boolean }
  | { type: "SET_SHOW_MEMBER_CONFIG"; payload: boolean }
  | { type: "SET_PLAYING_AUDIO_ID"; payload: string | null }
  | { type: "SET_VISIBLE_KEY_IDS"; payload: Record<string, boolean> };

function chatAreaReducer(state: ChatAreaState, action: ChatAreaAction): ChatAreaState {
  switch (action.type) {
    case "SET_INPUT": return { ...state, input: action.payload };
    case "SET_SUMMON": return { ...state, summon: action.payload };
    case "SET_ROUNDS": return { ...state, rounds: action.payload };
    case "SET_USE_STREAM": return { ...state, useStream: action.payload };
    case "SET_SHOW_EXPORT": return { ...state, showExport: action.payload };
    case "SET_SHOW_MEMBER_CONFIG": return { ...state, showMemberConfig: action.payload };
    case "SET_PLAYING_AUDIO_ID": return { ...state, playingAudioId: action.payload };
    case "SET_VISIBLE_KEY_IDS": return { ...state, visibleKeyIds: action.payload };
    default: return state;
  }
}

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
  const [state, dispatch] = useReducer(chatAreaReducer, {
    input: "",
    summon: defaultSummon,
    rounds: 3,
    useStream: true,
    showExport: false,
    showMemberConfig: false,
    playingAudioId: null,
    visibleKeyIds: {},
  });

  const { input, summon, rounds, useStream, showExport, showMemberConfig, playingAudioId, visibleKeyIds } = state;
  const setInput = (v: string) => dispatch({ type: "SET_INPUT", payload: v });
  const setSummon = (v: string) => dispatch({ type: "SET_SUMMON", payload: v });
  const setRounds = (v: number) => dispatch({ type: "SET_ROUNDS", payload: v });
  const setUseStream = (v: boolean) => dispatch({ type: "SET_USE_STREAM", payload: v });
  const setShowExport = (v: boolean) => dispatch({ type: "SET_SHOW_EXPORT", payload: v });
  const setShowMemberConfig = (v: boolean) => dispatch({ type: "SET_SHOW_MEMBER_CONFIG", payload: v });
  const setPlayingAudioId = (v: string | null) => dispatch({ type: "SET_PLAYING_AUDIO_ID", payload: v });
  const setVisibleKeyIds = (v: Record<string, boolean>) => dispatch({ type: "SET_VISIBLE_KEY_IDS", payload: v });
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
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)] relative">

      {/* ━━━ Top Bar ━━━ */}
      <header className="shrink-0 h-14 flex items-center justify-between px-5 md:px-8 bg-[var(--bg-surface-1)]/80 backdrop-blur-xl border-b border-[var(--border-subtle)] z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onToggleSidebar}
            className="md:hidden p-2 -ml-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg transition-colors hover:bg-[var(--glass-bg-hover)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <h2 className="text-[var(--text-primary)] font-semibold text-sm truncate max-w-[180px] sm:max-w-xs md:max-w-md">
            {activeTitle}
          </h2>

          <StreamingStatus isLoading={false} isStreaming={isStreaming} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Council Settings */}
          <button
            onClick={() => setShowMemberConfig(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-[var(--accent-mint)] hover:bg-[rgba(110,231,183,0.08)] rounded-button transition-all uppercase tracking-widest border border-[rgba(110,231,183,0.15)] hover:border-[rgba(110,231,183,0.3)]"
          >
            <Settings2 size={14} />
            <span className="hidden sm:inline">Council</span>
          </button>

          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setShowExport(!showExport)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] rounded-button transition-all uppercase tracking-widest"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Export</span>
            </button>

            <AnimatePresence>
              {showExport && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full right-0 mt-2 w-48 glass-panel rounded-card shadow-2xl z-50 py-2 border border-[var(--glass-border)]"
                  >
                    <div className="px-3 py-1.5 text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Export As</div>
                    <button
                      onClick={() => { onExport?.("markdown"); setShowExport(false); }}
                      className="w-full px-3 py-2 text-xs text-left text-[var(--text-secondary)] hover:bg-[rgba(110,231,183,0.06)] hover:text-[var(--accent-mint)] flex items-center gap-2.5 transition-colors"
                    >
                      <FileText size={14} /> Markdown (.md)
                    </button>
                    <button
                      onClick={() => { onExport?.("json"); setShowExport(false); }}
                      className="w-full px-3 py-2 text-xs text-left text-[var(--text-secondary)] hover:bg-[rgba(110,231,183,0.06)] hover:text-[var(--accent-mint)] flex items-center gap-2.5 transition-colors"
                    >
                      <FileJson size={14} /> JSON (.json)
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Loading overlay */}
      <StreamingStatus isLoading={isLoading} isStreaming={false} />

      {/* ━━━ Messages ━━━ */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto pt-6 pb-32 px-4 md:px-8 scrollbar-custom">
        {isLoading ? (
          <div className="max-w-3xl mx-auto space-y-6 pt-8">
            <SkeletonLoader variant="text" count={3} />
            <SkeletonLoader variant="card" count={2} />
          </div>
        ) : (
          <MessageList
            messages={messages}
            playingAudioId={playingAudioId}
            onPlayTTS={handlePlayTTS}
            getMemberColor={getMemberColor}
            visibleKeyIds={visibleKeyIds}
            setVisibleKeyIds={setVisibleKeyIds}
            onSuggestionClick={(suggestion) => {
              setInput(suggestion);
            }}
          />
        )}
      </div>

      {/* ━━━ Input + Config ━━━ */}
      <div className="shrink-0 mb-4 flex justify-center w-full relative">
        <CouncilConfigPanel
          isOpen={showMemberConfig}
          onClose={() => setShowMemberConfig(false)}
          summon={summon}
          onSummonChange={setSummon}
          rounds={rounds}
          onRoundsChange={setRounds}
          members={members}
          onAddMember={() => onUpdateMembers([...members, { id: Date.now().toString(), name: "New Member", type: "openai-compat", role: "Default", tone: "Concise", apiKey: "", model: "", active: true, customBehaviour: "" }])}
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
    </div>
  );
}
