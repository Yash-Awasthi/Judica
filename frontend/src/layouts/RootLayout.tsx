import { useState, useEffect, useCallback } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Sidebar } from "../components/Sidebar";
import { AuthScreen } from "../components/AuthScreen";
import { OfflineIndicator } from "../components/OfflineIndicator";
import { PageTransition } from "../components/PageTransition";
import type { Conversation } from "../types/index.js";

export function RootLayout() {
  const { user, fetchWithAuth, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetchWithAuth("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (err) { console.warn("Failed to load conversations", err); }
  }, [user, fetchWithAuth]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const handleConversationSelect = useCallback((id: string, _title: string) => {
    setActiveConvId(id);
    navigate(`/chat/${id}`);
  }, [navigate]);

  const handleNewChat = useCallback(() => {
    setActiveConvId(null);
    navigate("/chat");
  }, [navigate]);

  const handleHome = useCallback(() => {
    setActiveConvId(null);
    navigate("/");
  }, [navigate]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConvId === id) {
          setActiveConvId(null);
          navigate("/");
        }
      }
    } catch (err) { console.warn("Failed to delete conversation", err); }
  }, [fetchWithAuth, activeConvId, navigate]);

  const handleShowMetrics = useCallback(() => {
    navigate("/metrics");
  }, [navigate]);

  // Update active ID when navigating via URL
  useEffect(() => {
    const match = location.pathname.match(/\/chat\/(.+)/);
    if (match) {
      setActiveConvId(match[1]);
    } else if (location.pathname === "/" || location.pathname === "/chat") {
      setActiveConvId(null);
    }
  }, [location.pathname]);

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)] relative">
      {/* Ambient background orbs — only render in dark mode */}
      <div className="bg-orb-mint w-[500px] h-[500px] top-[-10%] left-[20%] animate-drift hidden dark:block" />
      <div className="bg-orb-blue w-[400px] h-[400px] bottom-[-5%] right-[15%] animate-drift-slow hidden dark:block" />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        username={user || "User"}
        isOpen={sidebarOpen}
        onSelect={handleConversationSelect}
        onHome={handleHome}
        onNew={handleNewChat}
        onDelete={handleDelete}
        onLogout={logout}
        onShowMetrics={handleShowMetrics}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile hamburger */}
        <div className="md:hidden px-4 py-3 flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface-1)]">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="ml-3 text-sm font-bold text-[var(--text-primary)]">
            AIBY<span className="text-[var(--accent-mint)]">AI</span>
          </span>
        </div>

        {/* Page content with transition */}
        <div className="flex-1 overflow-hidden">
          <PageTransition className="h-full" key={location.pathname}>
            <Outlet context={{ loadConversations, setActiveConvId, setIsSidebarOpen: setSidebarOpen, conversations }} />
          </PageTransition>
        </div>
      </main>

      {/* Offline indicator */}
      <OfflineIndicator />
    </div>
  );
}
