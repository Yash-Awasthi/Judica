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
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetchWithAuth("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (err) {
      console.error("Failed to load conversations", err);
      setError("Failed to load conversations. Please try refreshing the page.");
    }
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
    } catch (err) {
      console.error("Failed to delete conversation", err);
      setError("Failed to delete conversation. Please try again.");
    }
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
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:text-text focus:p-2 focus:rounded">Skip to main content</a>
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
      <main id="main-content" className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Error banner */}
        {error && (
          <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/30 text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-400 hover:text-red-300 transition-colors"
              aria-label="Dismiss error"
            >
              &times;
            </button>
          </div>
        )}
        {/* Mobile hamburger */}
        <div className="md:hidden px-4 py-3 flex items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface-1)]">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
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
