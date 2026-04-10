import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { AuthScreen } from "../components/AuthScreen";
import { useState, useCallback, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import type { Conversation } from "../types/index.js";

export function RootLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem("council_sidebar_width");
    return saved ? parseInt(saved, 10) : 264;
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const { token, user: username, logout, fetchWithAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const activeConvoId = location.pathname.startsWith('/chat/')
    ? location.pathname.split('/').pop() || null
    : null;

  useEffect(() => {
    localStorage.setItem("council_sidebar_width", sidebarWidth.toString());
  }, [sidebarWidth]);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetchWithAuth("/api/history?limit=50");
      if (res.ok) {
        const data = await res.json() as { data: Conversation[] };
        setConversations(data.data || []);
      }
    } catch (err) {
      console.error("Failed to load conversations", err);
    }
  }, [fetchWithAuth, token]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  const handleSelectConversation = (id: string, _title?: string) => {
    navigate(`/chat/${id}`);
    setIsSidebarOpen(false);
  };

  const handleNewConversation = () => {
    navigate('/chat');
    setIsSidebarOpen(false);
  };

  const handleHome = () => {
    navigate('/');
    setIsSidebarOpen(false);
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

  const handleShowMetrics = () => {
    navigate('/metrics');
    setIsSidebarOpen(false);
  };

  const handleLogin = (_newToken: string) => {
    // The AuthContext probably needs to be updated with the token.
    // AuthContext uses localStorage, so we'll just set it and let context pick it up, or maybe it sets it.
    // Actually the AuthScreen itself does:
    // localStorage.setItem("council_token", data.token);
    // onLogin(data.token);
    // Since AuthContext might need to re-render, we can just reload the page.
    window.location.reload();
  };

  if (!token) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  return (
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
        username={username || ""}
        isOpen={isSidebarOpen}
        onSelect={handleSelectConversation}
        onHome={handleHome}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onLogout={handleLogout}
        onShowMetrics={handleShowMetrics}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
      />

      <main className="flex-1 flex flex-col min-w-0 bg-[#000000] relative">
        <Outlet context={{ isSidebarOpen, setIsSidebarOpen, activeConvoId, loadConversations, conversations }} />
      </main>
    </div>
  );
}
