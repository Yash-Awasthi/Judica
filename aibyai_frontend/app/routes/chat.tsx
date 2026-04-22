import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  MessageSquare,
  Bot,
  Brain,
  Cpu,
  Plus,
  Search,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  Sparkles,
  Trash2,
  UserPlus,
} from "lucide-react";
import gsap from "gsap";
import { cn } from "~/lib/utils";
import { api } from "~/lib/api";
import { useDeliberation } from "~/hooks/useDeliberation";
import { AgentOpinionCard } from "~/components/chat/AgentOpinionCard";
import { VerdictPanel } from "~/components/chat/VerdictPanel";
import { ChatInput } from "~/components/chat/ChatInput";
import {
  ConversationItem,
  type ConversationData,
} from "~/components/chat/ConversationItem";

// --- Types ---

interface HistoryMessage {
  role: string;
  content: string;
  opinions?: Array<{ agent: string; content: string; model: string }>;
  verdict?: string;
  cost?: { tokens: number; usd: number };
}

interface CouncilMember {
  name: string;
  model: string;
  icon: typeof Bot;
  color: string;
}

const AVAILABLE_MODELS = [
  "gpt-4",
  "gpt-4o",
  "gpt-3.5-turbo",
  "claude-3",
  "claude-3-opus",
  "gemini-pro",
  "gemini-1.5-pro",
];

const DEFAULT_COUNCIL: CouncilMember[] = [
  { name: "Analyst", model: "gpt-4", icon: Brain, color: "text-blue-500" },
  { name: "Creative", model: "claude-3", icon: Sparkles, color: "text-purple-500" },
  { name: "Critic", model: "gpt-4", icon: Cpu, color: "text-amber-500" },
  { name: "Strategist", model: "gemini-pro", icon: Users, color: "text-emerald-500" },
];

// --- Main Chat Page ---

export default function ChatPage() {
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [councilMembers, setCouncilMembers] = useState<CouncilMember[]>(DEFAULT_COUNCIL);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberModel, setNewMemberModel] = useState("gpt-4");

  const deliberation = useDeliberation();
  const mainRef = useRef<HTMLDivElement>(null);
  const opinionsRef = useRef<HTMLDivElement>(null);

  // Check mobile breakpoint
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setLeftPanelOpen(false);
        setRightPanelOpen(false);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Fetch conversations
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get<ConversationData[]>("/conversations");
        if (!cancelled) setConversations(data);
      } catch {
        // API not available yet — show empty state
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Load history when conversation changes
  useEffect(() => {
    if (!activeConversation) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get<HistoryMessage[]>(
          `/history/${activeConversation}?limit=100`
        );
        if (!cancelled) setHistory(data);
      } catch {
        if (!cancelled) setHistory([]);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [activeConversation]);

  // Scroll to bottom when new opinions arrive
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = mainRef.current.scrollHeight;
    }
  }, [deliberation.opinions, deliberation.verdict]);

  // GSAP stagger animation on opinions
  useEffect(() => {
    if (!opinionsRef.current || deliberation.opinions.length === 0) return;
    const cards = opinionsRef.current.children;
    if (cards.length === 0) return;
    gsap.fromTo(
      cards,
      { opacity: 0, y: 20 },
      {
        opacity: 1,
        y: 0,
        stagger: 0.1,
        duration: 0.4,
        ease: "power2.out",
        overwrite: true,
      }
    );
  }, [deliberation.opinions.length]);

  const handleSubmit = useCallback(
    (query: string) => {
      const councilConfig = {
        agents: councilMembers.map((m) => m.name),
      };
      deliberation.submit(query, activeConversation ?? undefined, councilConfig);
    },
    [deliberation, activeConversation, councilMembers]
  );

  const handleAddMember = useCallback(() => {
    const name = newMemberName.trim();
    if (!name) return;
    if (councilMembers.some((m) => m.name.toLowerCase() === name.toLowerCase())) return;
    setCouncilMembers((prev) => [
      ...prev,
      { name, model: newMemberModel, icon: Bot, color: "text-muted-foreground" },
    ]);
    setNewMemberName("");
    setShowAddMember(false);
  }, [newMemberName, newMemberModel, councilMembers]);

  const handleRemoveMember = useCallback((name: string) => {
    setCouncilMembers((prev) => prev.filter((m) => m.name !== name));
  }, []);

  const handleUpdateModel = useCallback((name: string, model: string) => {
    setCouncilMembers((prev) =>
      prev.map((m) => (m.name === name ? { ...m, model } : m))
    );
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveConversation(null);
    setHistory([]);
    deliberation.reset();
    if (isMobile) setLeftPanelOpen(false);
  }, [deliberation, isMobile]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      setActiveConversation(id);
      deliberation.reset();
      if (isMobile) setLeftPanelOpen(false);
    },
    [deliberation, isMobile]
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        await api.del(`/conversations/${id}`);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversation === id) {
          setActiveConversation(null);
          setHistory([]);
        }
      } catch {
        // silently fail
      }
    },
    [activeConversation]
  );

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const hasContent =
    history.length > 0 ||
    deliberation.opinions.length > 0 ||
    deliberation.verdict;

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background overflow-hidden">
        {/* Left Panel: Conversations */}
        {leftPanelOpen && (
          <div
            className={cn(
              "flex flex-col border-r border-border bg-muted/30 shrink-0",
              isMobile
                ? "absolute inset-y-0 left-0 z-40 w-72 shadow-xl"
                : "w-72"
            )}
          >
            <div className="p-3 space-y-2">
              <Button
                onClick={handleNewChat}
                className="w-full justify-start gap-2"
                size="sm"
              >
                <Plus className="w-4 h-4" />
                New Deliberation
              </Button>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
            <Separator />
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-0.5">
                {filteredConversations.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    {searchQuery ? "No conversations found" : "No conversations yet"}
                  </p>
                ) : (
                  filteredConversations.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isActive={conv.id === activeConversation}
                      onSelect={handleSelectConversation}
                      onDelete={handleDeleteConversation}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Mobile overlay */}
        {isMobile && leftPanelOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40"
            onClick={() => setLeftPanelOpen(false)}
          />
        )}

        {/* Center: Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="flex items-center gap-2 border-b border-border px-4 py-2.5 bg-background shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setLeftPanelOpen(!leftPanelOpen)}
                >
                  {leftPanelOpen ? (
                    <PanelLeftClose className="w-4 h-4" />
                  ) : (
                    <PanelLeftOpen className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {leftPanelOpen ? "Close sidebar" : "Open sidebar"}
              </TooltipContent>
            </Tooltip>

            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              <h1 className="text-sm font-semibold">AI Council</h1>
            </div>

            <div className="flex-1" />

            {!isMobile && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setRightPanelOpen(!rightPanelOpen)}
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Council settings</TooltipContent>
              </Tooltip>
            )}
          </header>

          {/* Message area */}
          <div ref={mainRef} className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {/* Empty state */}
              {!hasContent && (
                <EmptyState council={councilMembers} />
              )}

              {/* Historical messages */}
              {history.map((msg, i) => (
                <HistoryMessageView key={i} message={msg} />
              ))}

              {/* Current deliberation opinions */}
              {deliberation.opinions.length > 0 && (
                <div ref={opinionsRef} className="space-y-4">
                  {deliberation.opinions.map((opinion, i) => (
                    <AgentOpinionCard
                      key={opinion.agent}
                      opinion={opinion}
                      index={i}
                    />
                  ))}
                </div>
              )}

              {/* Verdict */}
              {deliberation.verdict && (
                <VerdictPanel
                  verdict={deliberation.verdict}
                  cost={deliberation.cost}
                  isStreaming={deliberation.isStreaming}
                />
              )}

              {/* Error */}
              {deliberation.error && (
                <Card className="border-destructive/30 bg-destructive/5">
                  <CardContent className="p-4">
                    <p className="text-sm text-destructive">{deliberation.error}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Input area */}
          <div className="border-t border-border bg-background px-4 py-3 shrink-0">
            <div className="max-w-3xl mx-auto">
              <ChatInput
                value={deliberation.query}
                onChange={deliberation.setQuery}
                onSubmit={handleSubmit}
                onStop={deliberation.stop}
                isStreaming={deliberation.isStreaming}
              />
            </div>
          </div>
        </div>

        {/* Right Panel: Council Members & Settings */}
        {rightPanelOpen && !isMobile && (
          <div className="w-64 border-l border-border bg-muted/30 shrink-0 flex flex-col">
            <div className="p-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Council Members
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 text-muted-foreground"
                onClick={() => setShowAddMember((v) => !v)}
              >
                <UserPlus className="w-3.5 h-3.5" />
              </Button>
            </div>
            <Separator />

            {/* Add member form */}
            {showAddMember && (
              <div className="p-3 space-y-2 border-b border-border bg-muted/50">
                <Input
                  placeholder="Agent name (e.g. Ethicist)"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && handleAddMember()}
                />
                <Select value={newMemberModel} onValueChange={setNewMemberModel}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_MODELS.map((m) => (
                      <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-1.5">
                  <Button size="sm" className="flex-1 h-7 text-xs gap-1" onClick={handleAddMember}>
                    <Plus className="w-3 h-3" />Add
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddMember(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {councilMembers.map((member) => {
                  const Icon = member.icon;
                  const isActive = deliberation.opinions.some(
                    (o) => o.agent === member.name && !o.done
                  );
                  const isDone = deliberation.opinions.some(
                    (o) => o.agent === member.name && o.done
                  );

                  return (
                    <Card key={member.name} size="sm" className="p-0 group">
                      <CardContent className="p-2.5">
                        <div className="flex items-center gap-2">
                          <Icon className={cn("w-4 h-4 shrink-0", member.color)} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">
                              {member.name}
                            </p>
                            <Select
                              value={member.model}
                              onValueChange={(v) => handleUpdateModel(member.name, v)}
                            >
                              <SelectTrigger className="h-5 text-[10px] border-0 p-0 bg-transparent shadow-none focus:ring-0 w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {AVAILABLE_MODELS.map((m) => (
                                  <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {isActive && (
                            <span className="relative flex h-2 w-2 shrink-0">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400/60" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                            </span>
                          )}
                          {isDone && !isActive && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
                              Done
                            </Badge>
                          )}
                          {!isActive && !isDone && councilMembers.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => handleRemoveMember(member.name)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
            <Separator />
            <div className="p-3">
              <p className="text-[10px] text-muted-foreground">
                {deliberation.isStreaming
                  ? "Council is deliberating..."
                  : `${councilMembers.length} member${councilMembers.length !== 1 ? "s" : ""} · Ready`}
              </p>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// --- Sub-components ---

function EmptyState({ council }: { council: CouncilMember[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }
    );
  }, []);

  return (
    <div ref={ref} className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
        <Brain className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        AI Council Deliberation
      </h2>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Ask a question and multiple AI agents will analyze it from different perspectives,
        then synthesize their insights into a comprehensive verdict.
      </p>
      <div className="flex items-center gap-4 flex-wrap justify-center">
        {council.map((member) => {
          const Icon = member.icon;
          return (
            <div key={member.name} className="flex flex-col items-center gap-1">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted">
                <Icon className={cn("w-5 h-5", member.color)} />
              </div>
              <span className="text-[10px] text-muted-foreground">{member.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryMessageView({ message }: { message: HistoryMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl bg-primary text-primary-foreground px-4 py-2.5">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {message.opinions?.map((opinion) => (
        <AgentOpinionCard
          key={opinion.agent}
          opinion={{ ...opinion, done: true }}
          index={0}
        />
      ))}
      {message.verdict && (
        <VerdictPanel
          verdict={message.verdict}
          cost={message.cost ?? null}
          isStreaming={false}
        />
      )}
      {!message.opinions && !message.verdict && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-foreground/80 whitespace-pre-wrap">
              {message.content}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
