import React, { useState, useEffect, useCallback, useRef, Component, type ErrorInfo, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useCouncilStream, type SSEEvent } from "./hooks/useCouncilStream";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar, type Conversation } from "./components/Sidebar";
import { ChatArea, type ChatMessage } from "./components/ChatArea";
import { Dashboard } from "./components/Dashboard";
import { v4 as uuidv4 } from "uuid";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-bg text-text p-8 text-center font-sans">
          <div className="w-16 h-16 rounded-2xl bg-danger/10 border border-danger/20 flex items-center justify-center mb-6">
            <span className="material-symbols-outlined text-danger text-3xl">error</span>
          </div>
          <h1 className="text-xl font-black tracking-tight text-text mb-3">Neural Link Severed</h1>
          <p className="text-text-muted mb-8 max-w-sm text-sm leading-relaxed">
            The interface encountered an unexpected disconnect. {this.state.error?.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-accent/10 border border-accent/20 rounded-xl hover:bg-accent/20 transition-all text-accent text-xs font-bold uppercase tracking-widest"
          >
            Re-initialize Uplink
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface UserMetrics {
  totalRequests: number;
  totalConversations: number;
  cache: {
    hits: number;
    hitRatePercentage: number;
  };
  performance: {
    averageLatencyMs: number;
    totalTokensUsed: number;
  };
}

export interface CouncilMember {
  id: string;
  name: string;
  type: "openai-compat" | "anthropic" | "google";
  apiKey: string;
  model: string;
  baseUrl?: string;
  active: boolean;
  role: string;
  tone: string;
  customBehaviour: string;
}

function AppContent() {
  const { token, user: username, login, logout, fetchWithAuth } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentSummon, setCurrentSummon] = useState<string>("default");

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isInChat, setIsInChat] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("council_sidebar_width");
    return saved ? parseInt(saved, 10) : 264;
  });

  const activeMsgIdRef = useRef<string | null>(null);

  const { startStream } = useCouncilStream({
    onEvent: (event) => {
      if (activeMsgIdRef.current) {
        updateMessageFromStream.current(activeMsgIdRef.current, event);
      }
    },
    onError: (msg) => {
      console.error("Stream error in App:", msg);
    }
  });

  const [members, setMembers] = useState<CouncilMember[]>(() => {
    const saved = localStorage.getItem("council_members");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Clean up invalid cached models
        return parsed.map((m: any) => ({
          ...m,
          model: m.model === "gemini-2.5-flash" || m.model === "gemini-2.0-flash" ? "mistral-large-latest" : 
                 m.model === "gpt-4o" ? "llama-3.3-70b-versatile" :
                 m.model === "claude-sonnet-4-20250514" ? "claude-3-5-sonnet-20241022" : 
                 m.model,
          baseUrl: m.model === "gpt-4o" ? "https://api.groq.com/openai/v1" : 
                   m.model === "gemini-2.0-flash" ? "https://api.mistral.ai/v1" :
                   m.baseUrl
        }));
      } catch (err) {
        console.error("Failed to parse cached council members", err);
      }
    }
    return [
      {
        id: "1",
        name: "The Architect",
        type: "openai-compat" as const,
        apiKey: "",
        model: "mistral-large-latest",
        baseUrl: "https://api.mistral.ai/v1",
        active: true,
        role: "Expert",
        tone: "Academic",
        customBehaviour: ""
      },
      {
        id: "2",
        name: "The Contrarian",
        type: "openai-compat" as const,
        apiKey: "",
        model: "llama-3.3-70b-versatile",
        baseUrl: "https://api.groq.com/openai/v1",
        active: true,
        role: "Devil's Advocate",
        tone: "Blunt",
        customBehaviour: ""
      },
      {
        id: "3",
        name: "The Pragmatist",
        type: "openai-compat" as const,
        apiKey: "",
        model: "mistral-small-latest",
        baseUrl: "https://api.mistral.ai/v1",
        active: true,
        role: "Pragmatist",
        tone: "Concise",
        customBehaviour: ""
      },
      {
        id: "4",
        name: "The Summarizer",
        type: "openai-compat" as const,
        apiKey: "",
        model: "llama-3.3-70b-versatile",
        baseUrl: "https://api.groq.com/openai/v1",
        active: true,
        role: "Critic",
        tone: "Concise",
        customBehaviour: "You are an Unbiased Summarizer. Provide a completely neutral, objective summary of the debate using your large context window. Do not invent new arguments."
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem("council_members", JSON.stringify(members));
  }, [members]);

  useEffect(() => {
    localStorage.setItem("council_sidebar_width", sidebarWidth.toString());
  }, [sidebarWidth]);

  const handleLogout = useCallback(async () => {
    await logout();
    setActiveConvoId(null);
    setMessages([]);
  }, [logout]);

  const checkProfile = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchWithAuth("/api/auth/me");
      if (!res.ok) {
        if (res.status === 401) handleLogout();
        return;
      }
      
      // Auto-refresh logic utilizing fetchWithAuth
      try {
        const payload = JSON.parse(atob(token.split('.')[1])) as { exp: number };
        const exp = payload.exp * 1000;
        if (exp - Date.now() < 24 * 60 * 60 * 1000) {
          const refreshRes = await fetchWithAuth("/api/auth/refresh", { method: "POST" });
          if (refreshRes.ok) {
             const refreshData = await refreshRes.json() as { token: string; username: string };
             login(refreshData.token, refreshData.username);
          }
        }
      } catch (err) {
        console.error("Failed to parse token for auto-refresh", err);
      }
    } catch (err) {
      console.error("Failed to check profile", err);
    }
  }, [token, handleLogout, fetchWithAuth, login]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/history?limit=50");
      if (res.ok) {
        const data = await res.json() as { data: Conversation[] };
        setConversations(data.data || []);
      }
    } catch (err) {
      console.error("Failed to load conversations", err);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (token) {
      checkProfile();
      loadConversations();
    }
  }, [token, checkProfile, loadConversations]);

  const handleSelectConversation = async (id: string, _title?: string) => {
    setActiveConvoId(id);
    setIsSidebarOpen(false);
    setIsInChat(true);
    setIsLoadingHistory(true);
    try {
      const res = await fetchWithAuth(`/api/history/${id}?limit=100`);
      if (res.ok) {
        const data = await res.json() as { chats: ChatMessage[] };
        setMessages(data.chats || []);
      }
    } catch (err) {
      console.error("Failed to load history", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleNewConversation = (summon?: string) => {
    setActiveConvoId(null);
    setMessages([]);
    setCurrentSummon(summon || "default");
    setIsSidebarOpen(false);
    setIsInChat(true);
  };

  const handleHome = () => {
    setActiveConvoId(null);
    setMessages([]);
    setIsSidebarOpen(false);
    setIsInChat(false);
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/history/${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== id));
        if (activeConvoId === id) {
          handleHome();
        }
      }
    } catch (err) {
      console.error("Failed to delete conversation", err);
    }
  };

  const handleExport = async (format: "markdown" | "json") => {
    if (!activeConvoId) return;
    try {
      const res = await fetchWithAuth(`/api/export/${format}/${activeConvoId}`);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deliberation-${activeConvoId}.${format === "markdown" ? "md" : "json"}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  const handleShowMetrics = async () => {
    setShowMetrics(true);
    setIsSidebarOpen(false);
    try {
      const res = await fetchWithAuth("/api/metrics");
      if (res.ok) {
        const data = await res.json() as { metrics: UserMetrics };
        setMetrics(data.metrics);
      }
    } catch (err) {
      console.error("Failed to fetch metrics", err);
    }
  };

  const updateMessageFromStream = useRef((msgId: string, event: SSEEvent) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const newMsg = { ...m };
      if (!newMsg.opinions) newMsg.opinions = [];

      const cleanContent = (content: string) =>
        content
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .replace(/<think>[\s\S]*/g, "")
          .trim();

      switch (event.type) {
        case "member_chunk": {
          const idx = newMsg.opinions.findIndex(o => o.name === event.name);
          const rawOpinion = idx === -1 ? event.chunk : newMsg.opinions[idx].opinion + event.chunk;
          const cleanOpinion = cleanContent(rawOpinion);
          if (idx === -1) {
            newMsg.opinions = [...newMsg.opinions, { name: event.name, archetype: "", opinion: cleanOpinion }];
          } else {
            newMsg.opinions = newMsg.opinions.map((o, i) =>
              i === idx ? { ...o, opinion: cleanOpinion } : o
            );
          }
          break;
        }
        case "opinion": {
          const idx = newMsg.opinions.findIndex(o => o.name === event.name);
          const cleanOpinion = cleanContent(event.opinion);
          if (idx === -1) {
            newMsg.opinions = [...newMsg.opinions, { name: event.name, archetype: event.archetype, opinion: cleanOpinion }];
          } else {
            newMsg.opinions = newMsg.opinions.map((o, i) =>
              i === idx ? { ...o, archetype: event.archetype, opinion: cleanOpinion } : o
            );
          }
          break;
        }
        case "verdict": {
          newMsg.verdict = cleanContent(event.verdict);
          break;
        }
        case "verdict_chunk": {
          newMsg.verdict = cleanContent((newMsg.verdict || "") + event.chunk);
          break;
        }
        case "done": {
          if (event.verdict) newMsg.verdict = cleanContent(event.verdict);
          if (event.conversationId) {
            setTimeout(() => {
              setActiveConvoId(event.conversationId!);
              loadConversations();
            }, 0);
          }
          break;
        }
      }
      return newMsg;
    }));
  });

  const handleSendMessage = async (text: string, summon: string, useStream: boolean, rounds: number) => {
    setIsStreaming(true);
    const msgId = uuidv4();
    activeMsgIdRef.current = msgId;

    const newMsg: ChatMessage = { id: msgId, question: text, opinions: [], verdict: "" };
    setMessages(prev => [...prev, newMsg]);

    const body = {
      question: text,
      summon: summon || undefined,
      rounds: rounds || undefined,
      conversationId: activeConvoId || undefined,
      members: members
        .filter(m => m.active)
        .map(m => ({ ...m, systemPrompt: m.customBehaviour || undefined }))
    };

    try {
      if (useStream) {
        await startStream(body);
      } else {
        const res = await fetchWithAuth("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        if (!res.ok) throw new Error("Request failed");
        const data = await res.json() as {
          opinions: Array<{ name: string; archetype: string; opinion: string }>;
          verdict: string;
          latency: number;
          cacheHit: boolean;
          conversationId?: string;
        };

        setMessages(prev => prev.map(m => m.id === msgId ? {
          ...m,
          opinions: data.opinions,
          verdict: data.verdict,
          durationMs: data.latency,
          cacheHit: data.cacheHit
        } : m));

        if (!activeConvoId && data.conversationId) {
          setActiveConvoId(data.conversationId);
          loadConversations();
        }
      }
    } catch (err) {
      console.error("Chat error", err);
    } finally {
      setIsStreaming(false);
    }
  };

  if (!token) {
    return <AuthScreen onLogin={login} />;
  }

  const activeTitle = conversations.find(c => c.id === activeConvoId)?.title || "New Deliberation";

  return (
    <ErrorBoundary>
      <div
        className="flex h-screen overflow-hidden bg-bg text-text font-sans"
        style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
      >
        {/* Mobile overlay */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/70 z-30 md:hidden backdrop-blur-sm"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        <Sidebar
          conversations={conversations}
          activeId={activeConvoId}
          username={username}
          isOpen={isSidebarOpen}
          onSelect={handleSelectConversation}
          onHome={handleHome}
          onNew={() => handleNewConversation()}
          onDelete={handleDeleteConversation}
          onLogout={handleLogout}
          onShowMetrics={handleShowMetrics}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
        />

        <div className="flex-1 flex flex-col min-w-0 bg-[#000000] relative">
          {!isInChat && !activeConvoId && messages.length === 0 ? (
            <Dashboard onSelectTemplate={(summon) => handleNewConversation(summon)} />
          ) : (
            <ChatArea
              messages={messages}
              isStreaming={isStreaming}
              onSendMessage={handleSendMessage}
              onToggleSidebar={() => setIsSidebarOpen(true)}
              activeTitle={activeTitle}
              defaultSummon={currentSummon}
              onExport={handleExport}
              members={members}
              onUpdateMembers={setMembers}
              isLoading={isLoadingHistory}
            />
          )}
        </div>

        {/* Metrics Modal */}
        {showMetrics && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => setShowMetrics(false)}
            />
            <div className="relative w-full max-w-lg glass-panel rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
              <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
                    <span className="material-symbols-outlined text-accent text-base" style={{ fontVariationSettings: "'FILL' 1" }}>bar_chart</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold tracking-tight">Usage Statistics</h3>
                    <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">Council Analytics</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMetrics(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors text-text-muted hover:text-text"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              <div className="p-6 space-y-4">
                {!metrics ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-4 text-text-muted">
                    <span className="material-symbols-outlined animate-spin text-4xl text-accent">cycle</span>
                    <span className="text-xs uppercase tracking-widest font-bold">Retrieving Data...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Total Requests", value: metrics.totalRequests || 0, color: "text-text" },
                      { label: "Conversations", value: metrics.totalConversations || 0, color: "text-text" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="glass-panel p-5 rounded-xl">
                        <p className="text-[9px] text-text-muted uppercase font-black tracking-widest mb-1">{label}</p>
                        <p className={`text-3xl font-black ${color}`}>{value.toLocaleString()}</p>
                      </div>
                    ))}
                    <div className="glass-panel p-5 rounded-xl">
                      <p className="text-[9px] text-text-muted uppercase font-black tracking-widest mb-1">Cache Hit Rate</p>
                      <div className="flex items-baseline gap-2">
                        <p className="text-3xl font-black text-accent">{metrics.cache?.hitRatePercentage || 0}%</p>
                        <p className="text-[10px] text-text-muted font-bold">({metrics.cache?.hits || 0} hits)</p>
                      </div>
                    </div>
                    <div className="glass-panel p-5 rounded-xl">
                      <p className="text-[9px] text-text-muted uppercase font-black tracking-widest mb-1">Avg Latency</p>
                      <p className="text-3xl font-black text-text">{((metrics.performance?.averageLatencyMs || 0) / 1000).toFixed(1)}s</p>
                    </div>
                    <div className="col-span-2 p-5 rounded-xl verdict-box">
                      <p className="text-[9px] text-accent uppercase font-black tracking-widest mb-1">Total Tokens Consumed</p>
                      <p className="text-4xl font-black text-text">{(metrics.performance?.totalTokensUsed || 0).toLocaleString()}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex justify-end">
                <button
                  onClick={() => setShowMetrics(false)}
                  className="px-6 py-2 bg-accent text-black text-xs font-black uppercase tracking-widest rounded-lg transition-all hover:brightness-110"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
