import { useReducer, useRef, useEffect, useMemo, Dispatch, SetStateAction } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Settings2, Download, FileText, FileJson, Share2, Network, 
  ShieldCheck, Maximize2, Layers, Zap, MessageCircle
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { StreamingStatus } from "./StreamingStatus";
import { CouncilConfigPanel } from "./CouncilConfigPanel";
import { SkeletonLoader } from "./SkeletonLoader";
import { SectorHUD } from "./SectorHUD";
import { TechnicalGrid } from "./TechnicalGrid";
import { ConsensusVisualizer } from "./ConsensusVisualizer";
import { SummaryView } from "./SummaryView";
import type { ChatMessage, CouncilMember, Link } from "../types";

interface ChatAreaProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string, summon: string, useStream: boolean, rounds: number) => void;
  onToggleSidebar: () => void;
  _onToggleSidebar?: () => void; // internal use or future proof
  activeTitle: string;
  defaultSummon?: string;
  onExport?: (format: "markdown" | "json") => void;
  members: CouncilMember[];
  onUpdateMembers: (members: CouncilMember[]) => void;
  isLoading?: boolean;
  summaryData?: any;
  onGenerateSummary?: () => void;
  isGeneratingSummary?: boolean;
}

const MEMBER_COLORS = [
  { bg: "#6ee7b7", shadow: "rgba(110,231,183,0.3)" },
  { bg: "#60a5fa", shadow: "rgba(96,165,250,0.3)" },
  { bg: "#a78bfa", shadow: "rgba(167,139,250,0.3)" },
  { bg: "#fbbf24", shadow: "rgba(251,191,36,0.3)" },
  { bg: "#f472b6", shadow: "rgba(244,114,182,0.3)" },
];

interface ChatAreaState {
  input: string;
  summon: string;
  rounds: number;
  useStream: boolean;
  showExport: boolean;
  showMemberConfig: boolean;
  showVisualizer: boolean;
  playingAudioId: string | null;
  visibleKeyIds: Record<string, boolean>;
  activeTab: "discussion" | "summary";
}

type ChatAreaAction =
  | { type: "SET_INPUT"; payload: string }
  | { type: "SET_SUMMON"; payload: string }
  | { type: "SET_ROUNDS"; payload: number }
  | { type: "SET_USE_STREAM"; payload: boolean }
  | { type: "SET_SHOW_EXPORT"; payload: boolean }
  | { type: "SET_SHOW_MEMBER_CONFIG"; payload: boolean }
  | { type: "SET_SHOW_VISUALIZER"; payload: boolean }
  | { type: "SET_PLAYING_AUDIO_ID"; payload: string | null }
  | { type: "SET_VISIBLE_KEY_IDS"; payload: Record<string, boolean> }
  | { type: "SET_ACTIVE_TAB"; payload: "discussion" | "summary" };

function chatAreaReducer(state: ChatAreaState, action: ChatAreaAction): ChatAreaState {
  switch (action.type) {
    case "SET_INPUT": return { ...state, input: action.payload };
    case "SET_SUMMON": return { ...state, summon: action.payload };
    case "SET_ROUNDS": return { ...state, rounds: action.payload };
    case "SET_USE_STREAM": return { ...state, useStream: action.payload };
    case "SET_SHOW_EXPORT": return { ...state, showExport: action.payload };
    case "SET_SHOW_MEMBER_CONFIG": return { ...state, showMemberConfig: action.payload };
    case "SET_SHOW_VISUALIZER": return { ...state, showVisualizer: action.payload };
    case "SET_PLAYING_AUDIO_ID": return { ...state, playingAudioId: action.payload };
    case "SET_VISIBLE_KEY_IDS": return { ...state, visibleKeyIds: action.payload };
    case "SET_ACTIVE_TAB": return { ...state, activeTab: action.payload };
    default: return state;
  }
}

export function ChatArea({
  messages,
  isStreaming,
  onSendMessage,
  onToggleSidebar: _onToggleSidebar,
  activeTitle,
  defaultSummon = "default",
  onExport,
  members,
  onUpdateMembers,
  isLoading = false,
  summaryData,
  onGenerateSummary,
  isGeneratingSummary = false
}: ChatAreaProps) {
  const { fetchWithAuth } = useAuth();
  const [state, dispatch] = useReducer(chatAreaReducer, {
    input: "",
    summon: defaultSummon,
    rounds: 3,
    useStream: true,
    showExport: false,
    showMemberConfig: false,
    showVisualizer: true, // Default to true for premium feel
    playingAudioId: null,
    visibleKeyIds: {},
    activeTab: "discussion",
  });

  const { input, summon, rounds, useStream, showExport, showMemberConfig, showVisualizer, playingAudioId, visibleKeyIds } = state;
  const setInput = (v: string) => dispatch({ type: "SET_INPUT", payload: v });
  const setSummon = (v: string) => dispatch({ type: "SET_SUMMON", payload: v });
  const setRounds = (v: number) => dispatch({ type: "SET_ROUNDS", payload: v });
  const setUseStream = (v: boolean) => dispatch({ type: "SET_USE_STREAM", payload: v });
  const setShowExport = (v: boolean) => dispatch({ type: "SET_SHOW_EXPORT", payload: v });
  const setShowMemberConfig = (v: boolean) => dispatch({ type: "SET_SHOW_MEMBER_CONFIG", payload: v });
  const setShowVisualizer = (v: boolean) => dispatch({ type: "SET_SHOW_VISUALIZER", payload: v });
  const setPlayingAudioId = (v: string | null) => dispatch({ type: "SET_PLAYING_AUDIO_ID", payload: v });
  const setVisibleKeyIds: Dispatch<SetStateAction<Record<string, boolean>>> = (v) => {
    const value = typeof v === "function" ? v(state.visibleKeyIds) : v;
    dispatch({ type: "SET_VISIBLE_KEY_IDS", payload: value });
  };
  const setActiveTab = (v: "discussion" | "summary") => dispatch({ type: "SET_ACTIVE_TAB", payload: v });

  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlayTTS = async (msgId: string, text: string) => {
    if (playingAudioId === msgId) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      setPlayingAudioId(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlayingAudioId(msgId);
    try {
      const res = await fetchWithAuth("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  useEffect(() => { setSummon(defaultSummon); }, [defaultSummon]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
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

  const visualizerData = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    const center = { x: 150, y: 150 };
    const radius = 90;
    
    const activeNodes = members.filter(m => m.active).map((m, i, arr) => {
      const angle = (i / arr.length) * 2 * Math.PI - Math.PI / 2;
      return {
        id: m.name,
        name: m.name,
        type: (m.role.toLowerCase().includes("lead") ? "proposer" : m.role.toLowerCase().includes("moderator") ? "moderator" : "critic") as "proposer" | "moderator" | "critic",
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      };
    });

    const activeLinks: Link[] = [];
    if (lastMessage?.peerReviews) {
      lastMessage.peerReviews.forEach(review => {
        review.ranking.forEach((targetName, index) => {
          if (activeNodes.find(n => n.id === targetName)) {
            activeLinks.push({
              source: review.reviewer,
              target: targetName,
              strength: Math.max(0.2, 1 - index * 0.2),
              type: "critique"
            });
          }
        });
      });
    }

    let consensusScore = 0;
    if (lastMessage?.peerReviews && lastMessage.peerReviews.length > 0) {
      consensusScore = 85; 
    }

    return { nodes: activeNodes, links: activeLinks, consensusScore };
  }, [messages, members]);

  const annotations = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || !lastMessage.peerReviews) return [];
    return lastMessage.peerReviews.flatMap((review, i) => {
      return review.ranking.slice(0, 1).map(target => ({
        id: `anno-${i}-${target}`,
        nodeId: review.reviewer,
        title: "Reasoning Shift",
        content: `Agent identified a conflict. Initiating realignment.`,
        type: 'conflict' as const
      }));
    });
  }, [messages]);

  return (
    <div className="flex h-full bg-[#000000] overflow-hidden selection:bg-[var(--accent-mint)]/30 relative">
      <TechnicalGrid />
      
      {/* ━━━ Command Deck Header ━━━ */}
      <SectorHUD 
        sectorId="COMM-01" 
        title="Command_Deck"
        subtitle={`Session active // ${activeTitle}`}
        accentColor="var(--accent-mint)"
        telemetry={[
          { label: "LOGS", value: String(messages.length), status: "online" },
          { label: "COMPUTE", value: isStreaming ? "ULTRA" : "IDLE", status: isStreaming ? "alert" : "optimal" },
          { label: "UPLINK", value: "SECURE", status: "optimal" }
        ]}
      />

      <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[45] flex bg-white/[0.03] border border-white/10 rounded-2xl p-1 backdrop-blur-3xl pointer-events-auto">
        <button 
          onClick={() => setActiveTab("discussion")}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${
            state.activeTab === "discussion" 
              ? "bg-[var(--accent-mint)] text-black shadow-[0_0_20px_rgba(110,231,183,0.3)]" 
              : "text-white/20 hover:text-white"
          }`}
        >
          <MessageCircle size={14} />
          Discussion
        </button>
        <button 
          onClick={() => setActiveTab("summary")}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 ${
            state.activeTab === "summary" 
              ? "bg-[var(--accent-blue)] text-black shadow-[0_0_20px_rgba(96,165,250,0.3)]" 
              : "text-white/20 hover:text-white"
          }`}
        >
          <FileText size={14} />
          Summary
        </button>
      </div>

      {/* ━━━ Header Actions (Secondary) ━━━ */}
      <div className="absolute top-24 right-8 z-40 flex items-center gap-3">
          {/* Neural Map Toggle */}
          <button
            onClick={() => setShowVisualizer(!showVisualizer)}
            className={`group h-11 px-5 rounded-2xl flex items-center gap-3 text-[10px] font-black uppercase tracking-widest border transition-all duration-500 overflow-hidden relative pointer-events-auto ${
              showVisualizer 
                ? "bg-[var(--accent-mint)] text-black border-[var(--accent-mint)] shadow-[0_0_20px_rgba(110,231,183,0.3)]" 
                : "bg-white/5 text-white/40 border-white/10 hover:border-white/20 hover:text-white"
            }`}
          >
            <Network size={14} className={showVisualizer ? "animate-pulse" : "group-hover:rotate-12 transition-transform"} />
            <span className="hidden sm:inline">Neural_Map</span>
          </button>

          {/* Council Dashboard */}
          <button
            onClick={() => setShowMemberConfig(true)}
            className="h-11 px-5 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black text-white/40 uppercase tracking-widest hover:text-white hover:border-white/30 transition-all flex items-center gap-3 group pointer-events-auto"
          >
            <Settings2 size={14} className="group-hover:rotate-90 transition-transform duration-500" />
            <span className="hidden lg:inline">Council_Config</span>
          </button>

          {/* Export Manifest */}
          <div className="relative pointer-events-auto">
            <button
               onClick={() => setShowExport(!showExport)}
               className="h-11 w-11 lg:w-32 lg:px-5 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black text-white/40 uppercase tracking-widest hover:text-white hover:border-white/30 transition-all flex items-center justify-center lg:justify-between group"
            >
              <Download size={14} />
              <span className="hidden lg:inline">Manifest</span>
            </button>
            <AnimatePresence>
              {showExport && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute top-full right-0 mt-3 w-56 p-2 rounded-2xl bg-[#0a0a0a] border border-white/10 shadow-2xl z-50 backdrop-blur-3xl"
                  >
                    <div className="px-4 py-2 text-[8px] font-black text-white/20 uppercase tracking-[0.3em] font-diag">Download_Type</div>
                    <button onClick={() => { onExport?.("markdown"); setShowExport(false); }} className="w-full px-4 py-3 rounded-xl text-[10px] text-left text-white/60 hover:text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/5 flex items-center gap-3 transition-all font-black uppercase">
                       <FileText size={14} /> Markdown_.MD
                    </button>
                    <button onClick={() => { onExport?.("json"); setShowExport(false); }} className="w-full px-4 py-3 rounded-xl text-[10px] text-left text-white/60 hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/5 flex items-center gap-3 transition-all font-black uppercase">
                       <FileJson size={14} /> Neural_JSON
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
      </div>

      {/* ━━━ Command Core ━━━ */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="absolute inset-0 bg-transparent pointer-events-none z-0">
           <div className="absolute top-1/4 left-1/4 w-[40rem] h-[40rem] bg-[var(--accent-mint)]/5 blur-[120px] rounded-full animate-pulse" />
           <div className="absolute bottom-1/4 right-1/4 w-[30rem] h-[30rem] bg-[var(--accent-blue)]/5 blur-[100px] rounded-full animate-pulse delay-1000" />
        </div>

        {/* Neural Map Sidebar (Expanded) */}
        <AnimatePresence>
          {showVisualizer && (
            <motion.aside
              initial={{ width: 0, opacity: 0, x: -100 }}
              animate={{ width: 380, opacity: 1, x: 0 }}
              exit={{ width: 0, opacity: 0, x: -100 }}
              className="hidden 2xl:flex flex-col border-r border-white/5 bg-black/40 backdrop-blur-2xl overflow-hidden relative z-10"
            >
              <div className="p-10 space-y-10 flex-1 overflow-y-auto scrollbar-custom">
                <div>
                   <div className="flex items-center justify-between mb-6">
                      <h3 className="text-[10px] font-black text-white uppercase tracking-[0.4em] font-diag">Neural_Stability_Map</h3>
                      <Maximize2 size={12} className="text-white/20 hover:text-white cursor-pointer transition-colors" />
                   </div>
                   <div className="relative rounded-[2rem] bg-black/60 border border-white/5 p-4 shadow-inner overflow-hidden">
                      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
                      <ConsensusVisualizer 
                        nodes={visualizerData.nodes} 
                        links={visualizerData.links}
                        consensusScore={visualizerData.consensusScore}
                        annotations={annotations}
                      />
                   </div>
                </div>

                <div className="space-y-6">
                   <HUDCard 
                      icon={<ShieldCheck size={14} />} 
                      title="Lattice_Integrity" 
                      value={visualizerData.consensusScore > 0 ? `${visualizerData.consensusScore}%` : "CALIBRATING"} 
                      desc={isStreaming ? "Analyzing sync vectors..." : "Global synthesis stabilized at optimal threshold."}
                      color="var(--accent-mint)"
                   />
                   <div className="grid grid-cols-2 gap-4">
                      <HUDMiniStat icon={<Layers size={12} />} label="Pathways" value={visualizerData.links.length} />
                      <HUDMiniStat icon={<Zap size={12} />} label="Active_Units" value={visualizerData.nodes.length} />
                   </div>
                </div>
              </div>
              
              <div className="p-6 border-t border-white/5 bg-black/40">
                <button className="w-full h-12 rounded-xl bg-white/[0.03] border border-white/5 text-[9px] font-black text-white/40 uppercase tracking-widest hover:text-white hover:bg-white/10 hover:border-white/20 transition-all flex items-center justify-center gap-3 group">
                   <Share2 size={14} className="group-hover:rotate-12 transition-transform" />
                   Share_Diagnostic_Data
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
        
        {/* Messages Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto pt-10 pb-40 px-6 md:px-12 lg:px-24 scrollbar-custom relative z-10" role="log">
          {isLoading ? (
            <div className="max-w-4xl mx-auto space-y-10 pt-10 px-4">
              <SkeletonLoader variant="text" count={3} />
              <div className="grid grid-cols-2 gap-8"><SkeletonLoader variant="card" /><SkeletonLoader variant="card" /></div>
              <SkeletonLoader variant="text" count={5} />
            </div>
          ) : state.activeTab === "summary" ? (
             <SummaryView 
               data={summaryData} 
               onGenerate={onGenerateSummary || (() => {})} 
               isGenerating={isGeneratingSummary} 
             />
          ) : (
            <MessageList
              messages={messages}
              playingAudioId={playingAudioId}
              onPlayTTS={handlePlayTTS}
              getMemberColor={getMemberColor}
              visibleKeyIds={visibleKeyIds}
              setVisibleKeyIds={setVisibleKeyIds}
              onSuggestionClick={(suggestion) => setInput(suggestion)}
            />
          )}
          
          <AnimatePresence>
             {isStreaming && (
               <motion.div 
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: 10 }}
                 className="fixed bottom-36 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
               >
                  <StreamingStatus isLoading={false} isStreaming={true} />
               </motion.div>
             )}
          </AnimatePresence>
        </div>
      </div>

      {/* ━━━ Command Input Hub ━━━ */}
      {state.activeTab === "discussion" && (
        <footer className="shrink-0 absolute bottom-0 left-0 w-full z-50 pointer-events-none">
        <div className="max-w-4xl mx-auto px-6 pb-10 pointer-events-auto">
           <div className="relative group">
              <div className="absolute inset-0 bg-[var(--accent-mint)]/5 blur-[40px] rounded-[3rem] opacity-0 group-focus-within:opacity-100 transition-opacity duration-1000" />
              
              {/* Council Config Popover (Floating) */}
              <AnimatePresence>
                {showMemberConfig && (
                   <motion.div 
                     initial={{ opacity: 0, y: 50, scale: 0.9 }}
                     animate={{ opacity: 1, y: 0, scale: 1 }}
                     exit={{ opacity: 0, y: 50, scale: 0.9 }}
                     className="mb-6"
                   >
                     <CouncilConfigPanel
                       isOpen={showMemberConfig}
                       onClose={() => setShowMemberConfig(false)}
                       summon={summon}
                       onSummonChange={setSummon}
                       rounds={rounds}
                       onRoundsChange={setRounds}
                       members={members}
                       onAddMember={() => onUpdateMembers([...members, { id: Date.now().toString(), name: "New Unit", type: "openai-compat", role: "Generalist", tone: "Analytical", apiKey: "", model: "", active: true, customBehaviour: "" }])}
                       onRemoveMember={(id) => onUpdateMembers(members.filter(m => m.id !== id))}
                       onUpdateMember={(id, field, value) => onUpdateMembers(members.map(m => m.id === id ? { ...m, [field]: value } : m))}
                     />
                   </motion.div>
                )}
              </AnimatePresence>

              <div className="relative">
                <InputArea
                  input={input}
                  setInput={setInput}
                  useStream={useStream}
                  setUseStream={setUseStream}
                  isStreaming={isStreaming}
                  onSend={handleSend}
                  placeholder="Designate command for the neural lattice..."
                />
                
                {/* Visual Telemetry Overlays */}
                <div className="absolute -top-3 left-8 px-4 py-1.5 rounded-full bg-black border border-white/10 text-[8px] font-black text-white/40 uppercase tracking-[0.3em] font-diag flex items-center gap-2 shadow-2xl">
                   <div className="w-1 h-1 rounded-full bg-[var(--accent-mint)] animate-ping" />
                   Input_Capture_Ready
                </div>
              </div>
           </div>
        </div>
      </footer>
      )}
    </div>
  );
}

interface HUDCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  desc: string;
  color: string;
}

function HUDCard({ icon, title, value, desc, color }: HUDCardProps) {
  return (
    <div className="p-8 rounded-[2.5rem] bg-gradient-to-br from-white/[0.04] to-transparent border border-white/5 backdrop-blur-xl relative group hover:border-white/10 transition-all">
       <div className="absolute top-0 right-0 w-24 h-24 blur-[40px] opacity-10 pointer-events-none" style={{ backgroundColor: color }} />
       <div className="flex items-center gap-4 mb-4">
          <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center" style={{ color }}>{icon}</div>
          <h4 className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] font-diag">{title}</h4>
       </div>
       <div className="text-3xl font-black text-white tracking-tighter italic mb-3">{value}</div>
       <p className="text-[10px] text-white/20 font-diag leading-relaxed uppercase tracking-widest">{desc}</p>
    </div>
  );
}

interface HUDMiniStatProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}

function HUDMiniStat({ icon, label, value }: HUDMiniStatProps) {
  return (
    <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center gap-2 group hover:bg-white/[0.04] transition-all">
       <div className="text-white/20 group-hover:text-white transition-colors">{icon}</div>
       <div className="text-[14px] font-black text-white tracking-tighter font-diag">{value}</div>
       <span className="text-[7px] font-diag text-white/20 uppercase tracking-widest">{label}</span>
    </div>
  );
}
