import { useCallback, useState, useEffect } from "react";
import { useNavigate, useOutletContext, useParams, useLocation } from "react-router-dom";
import { ChatArea } from "../components/ChatArea";
import { useCouncilMembers } from "../hooks/useCouncilMembers";
import { useDeliberation } from "../hooks/useDeliberation";
import { useAuth } from "../context/AuthContext";
import type { Conversation } from "../types/index.js";

interface OutletContextType {
  setIsSidebarOpen: (v: boolean) => void;
  loadConversations: () => void;
  conversations: Conversation[];
}

export function ChatView() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { fetchWithAuth } = useAuth();
  const location = useLocation();
  const { setIsSidebarOpen, loadConversations, conversations } = useOutletContext<OutletContextType>();

  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const { members, setMembers } = useCouncilMembers();

  const onConversationCreated = useCallback((id: string) => {
    navigate(`/chat/${id}`, { replace: true });
    loadConversations();
  }, [navigate, loadConversations]);

  const { messages, setMessages, isStreaming, sendMessage } = useDeliberation({
    members,
    conversationId: conversationId || null,
    fetchWithAuth,
    onConversationCreated,
  });

  useEffect(() => {
    const fetchHistory = async () => {
      if (conversationId) {
        setIsLoadingHistory(true);
        try {
          const res = await fetchWithAuth(`/api/history/${conversationId}?limit=100`);
          if (res.ok) {
            const data = await res.json() as { chats: any[] };
            setMessages(data.chats || []);
          } else {
             // Handle 404 or other errors by resetting to a new chat
             navigate('/chat');
          }
        } catch (err) {
          console.error("Failed to load history", err);
        } finally {
          setIsLoadingHistory(false);
        }
      } else {
         setMessages([]);
      }
    };
    fetchHistory();
  }, [conversationId, fetchWithAuth, setMessages, navigate]);

  const handleExport = async (format: "markdown" | "json") => {
    if (!conversationId) return;
    try {
      const res = await fetchWithAuth(`/api/export/${format}/${conversationId}`);
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `deliberation-${conversationId}.${format === "markdown" ? "md" : "json"}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  const activeTitle = conversations.find(c => c.id === conversationId)?.title || "New Deliberation";
  const searchParams = new URLSearchParams(location.search);
  const currentSummon = searchParams.get("summon") || "default";

  return (
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
  );
}
