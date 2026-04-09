import React, { useState, useEffect, useCallback } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { Dashboard } from "./components/Dashboard";
import type { UserMetrics, Conversation } from "./types/index.js";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useCouncilMembers } from "./hooks/useCouncilMembers";
import { useDeliberation } from "./hooks/useDeliberation";

function AppContent() {
  const { token, user: username, login, logout, fetchWithAuth } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [currentSummon, setCurrentSummon] = useState<string>("default");

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isInChat, setIsInChat] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("council_sidebar_width");
    return saved ? parseInt(saved, 10) : 264;
  });

  const { members, setMembers } = useCouncilMembers();

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

  const onConversationCreated = useCallback((id: string) => {
    setActiveConvoId(id);
    loadConversations();
  }, [loadConversations]);

  const { messages, setMessages, isStreaming, sendMessage } = useDeliberation({
    members,
    conversationId: activeConvoId,
    fetchWithAuth,
    onConversationCreated,
  });

  useEffect(() => {
    localStorage.setItem("council_sidebar_width", sidebarWidth.toString());
  }, [sidebarWidth]);

  const handleLogout = useCallback(async () => {
    await logout();
    setActiveConvoId(null);
    setMessages([]);
  }, [logout, setMessages]);

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
        const data = await res.json() as { chats: any[] };
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
              onSendMessage={sendMessage}
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
