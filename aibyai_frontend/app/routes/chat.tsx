import { useState, useRef, useEffect, useCallback } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  MessageSquare,
  Send,
  Plus,
  Sparkles,
  Users,
  X,
  ChevronRight,
  ChevronLeft,
  Square,
  Search,
  Coins,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CouncilMember {
  id: string;
  name: string;
  model: string;
}

interface Message {
  id: string;
  role: "user" | "council";
  content?: string;
  opinions?: Opinion[];
  verdict?: string;
  tokens?: string;
  cost?: string;
}

interface Opinion {
  memberName: string;
  text: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "llama-3.3-70b", label: "Llama 3.3 70B" },
];

const ARCHETYPE_COLORS: Record<string, { badge: string; dot: string }> = {
  Architect: { badge: "bg-blue-500/20 text-blue-400 border-blue-500/30", dot: "bg-blue-500" },
  Pragmatist: { badge: "bg-amber-500/20 text-amber-400 border-amber-500/30", dot: "bg-amber-500" },
  Ethicist: { badge: "bg-purple-500/20 text-purple-400 border-purple-500/30", dot: "bg-purple-500" },
  Empiricist: { badge: "bg-green-500/20 text-green-400 border-green-500/30", dot: "bg-green-500" },
  Contrarian: { badge: "bg-red-500/20 text-red-400 border-red-500/30", dot: "bg-red-500" },
};

const DEFAULT_ARCHETYPE_COLOR = { badge: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" };

const MOCK_OPINIONS: Record<string, string[]> = {
  Architect: [
    "From a systems perspective, this requires careful consideration of boundaries and interfaces. The key is defining clear contracts between components so each can evolve independently without cascading failures across the system.",
    "Architecturally, scalability must be designed in from the start. Retrofitting distributed patterns onto a monolith is costly. I'd recommend event sourcing and CQRS to decouple reads from writes at the data layer.",
    "The structural approach here demands separation of concerns. By isolating domain logic from infrastructure concerns, we create a system that's testable in isolation and resilient to change at any layer.",
  ],
  Pragmatist: [
    "In practice, the simplest solution that works today is almost always preferable. Over-engineering upfront costs more than it saves. Start with what you need now and refactor when complexity actually demands it.",
    "From a pragmatic standpoint, teams ship faster when they use familiar patterns. The cognitive overhead of exotic architectures usually outweighs their theoretical benefits for most production systems.",
    "Real-world constraints matter: deadlines, team skill, operational complexity. The best solution is one your team can build, maintain, and debug at 2am during an incident without heroic effort.",
  ],
  Ethicist: [
    "We must consider the downstream effects on all stakeholders: users, developers, and communities affected by this system. Privacy and data minimization should be first-class concerns, not afterthoughts added at audit time.",
    "Ethical implications extend beyond compliance. How does this system affect power dynamics? Who bears the risk when things go wrong? Equitable design means building accountability and redress mechanisms in from day one.",
    "The long-term impact on user autonomy matters here. Systems that create dependency or obscure decision-making erode trust. Transparency and user control should be core design values, not optional features.",
  ],
  Empiricist: [
    "The data should guide this decision. Without measuring current baselines we're just guessing. I'd propose A/B testing multiple approaches and letting empirical evidence determine the winner rather than theoretical arguments.",
    "Historical data from similar systems shows mixed results. The research literature suggests effect sizes are smaller than intuition predicts. We need controlled experiments with clear success metrics before committing resources.",
    "Evidence-based engineering means being willing to challenge our assumptions. Run the experiment, measure rigorously, and be prepared to abandon the approach if the numbers don't support it.",
  ],
  Contrarian: [
    "Everyone is assuming the standard approach here, but what if the premise itself is flawed? The real problem might be that we're solving the wrong problem entirely. Let's question the constraints before accepting them.",
    "The conventional wisdom on this topic has significant blind spots. Counterintuitively, the opposite strategy has outperformed in several documented cases. We should at least stress-test the dominant assumption.",
    "I'd push back on the framing. The most dangerous ideas are the ones everyone agrees with because they stop thinking. What if the second-order effects of this decision undermine the first-order gains?",
  ],
};

const VERDICTS = [
  "After deliberation, the council recommends a pragmatic, iterative approach that balances architectural rigor with delivery velocity. Prioritize clear interfaces and testability while deferring premature optimization.",
  "The council converges on a measured strategy: establish strong foundational patterns early, measure empirically before scaling, and build ethical considerations into the design process rather than auditing them later.",
  "Synthesizing across perspectives: begin with the simplest solution that satisfies current requirements, instrument it thoroughly from day one, and create explicit review points to reassess architectural decisions as complexity grows.",
];

const mockConversations = [
  { id: "1", title: "Authentication Architecture", date: "2 hours ago", mode: "Council" },
  { id: "2", title: "Database Schema Review", date: "Yesterday", mode: "Council" },
  { id: "3", title: "API Rate Limiting Strategy", date: "2 days ago", mode: "Council" },
  { id: "4", title: "Frontend State Management", date: "3 days ago", mode: "Council" },
  { id: "5", title: "Microservices vs Monolith", date: "1 week ago", mode: "Council" },
];

const defaultMembers: CouncilMember[] = [
  { id: "m1", name: "Architect", model: "claude-sonnet-4-6" },
  { id: "m2", name: "Pragmatist", model: "gpt-4o" },
  { id: "m3", name: "Ethicist", model: "gemini-2.5-pro" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getColor(name: string) {
  return ARCHETYPE_COLORS[name] ?? DEFAULT_ARCHETYPE_COLOR;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [conversations, setConversations] = useState(mockConversations);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [councilMembers, setCouncilMembers] = useState<CouncilMember[]>(defaultMembers);
  const [configOpen, setConfigOpen] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingOpinions, setStreamingOpinions] = useState<Record<string, string>>({});
  const [completedMembers, setCompletedMembers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const stopRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingOpinions]);

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const simulateStreaming = useCallback(
    (memberName: string, fullText: string): Promise<void> => {
      return new Promise((resolve) => {
        let index = 0;
        const animate = () => {
          if (stopRef.current) {
            setStreamingOpinions((prev) => ({ ...prev, [memberName]: fullText }));
            resolve();
            return;
          }
          if (index < fullText.length) {
            const charsPerFrame = Math.max(1, Math.floor(Math.random() * 3) + 1);
            index = Math.min(index + charsPerFrame, fullText.length);
            setStreamingOpinions((prev) => ({ ...prev, [memberName]: fullText.slice(0, index) }));
            requestAnimationFrame(animate);
          } else {
            setCompletedMembers((prev) => new Set(prev).add(memberName));
            resolve();
          }
        };
        requestAnimationFrame(animate);
      });
    },
    []
  );

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isStreaming || councilMembers.length === 0) return;

    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Create conversation if needed
    let convId = selectedConvId;
    if (!convId) {
      const newConv = {
        id: Date.now().toString(),
        title: text.length > 40 ? text.slice(0, 40) + "…" : text,
        date: "Just now",
        mode: "Council",
      };
      setConversations((prev) => [newConv, ...prev]);
      setSelectedConvId(newConv.id);
      convId = newConv.id;
    }

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    setIsStreaming(true);
    stopRef.current = false;
    setStreamingOpinions({});
    setCompletedMembers(new Set());

    // Add placeholder council message
    const councilMsgId = (Date.now() + 1).toString();
    const councilMsg: Message = {
      id: councilMsgId,
      role: "council",
      opinions: councilMembers.map((m) => ({ memberName: m.name, text: "" })),
    };
    setMessages((prev) => [...prev, councilMsg]);

    // Stream each member sequentially
    for (const member of councilMembers) {
      if (stopRef.current) break;
      const opinionBank = MOCK_OPINIONS[member.name] ?? MOCK_OPINIONS["Architect"];
      const fullText = pickRandom(opinionBank);
      await simulateStreaming(member.name, fullText);
      // Small pause between members
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!stopRef.current) {
      const verdict = pickRandom(VERDICTS);
      // Update the council message with final opinions + verdict
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== councilMsgId) return m;
          return {
            ...m,
            opinions: councilMembers.map((cm) => {
              const opinionBank = MOCK_OPINIONS[cm.name] ?? MOCK_OPINIONS["Architect"];
              return { memberName: cm.name, text: pickRandom(opinionBank) };
            }),
            verdict,
            tokens: `${(Math.floor(Math.random() * 900) + 800).toLocaleString()} tokens`,
            cost: `$${(Math.random() * 0.04 + 0.01).toFixed(2)}`,
          };
        })
      );
    }

    setIsStreaming(false);
    setStreamingOpinions({});
  };

  const handleStop = () => {
    stopRef.current = true;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const addMember = () => {
    const names = ["Empiricist", "Contrarian", "Strategist", "Skeptic", "Visionary"];
    const existing = councilMembers.map((m) => m.name);
    const available = names.filter((n) => !existing.includes(n));
    const name = available[0] ?? `Member ${councilMembers.length + 1}`;
    setCouncilMembers((prev) => [
      ...prev,
      { id: Date.now().toString(), name, model: "gpt-4o" },
    ]);
  };

  const removeMember = (id: string) => {
    setCouncilMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const updateMember = (id: string, field: keyof CouncilMember, value: string) => {
    setCouncilMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ── Left: Conversation List ── */}
      <div className="w-64 border-r border-border flex flex-col shrink-0">
        <div className="p-3 border-b border-border space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => {
              setSelectedConvId(null);
              setMessages([]);
              setStreamingOpinions({});
            }}
          >
            <Plus className="size-3.5" />
            New Deliberation
          </Button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="pl-7 h-8 text-xs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {filteredConversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => {
                setSelectedConvId(conv.id);
                setMessages([]);
                setStreamingOpinions({});
              }}
              className={`w-full text-left px-3 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors ${
                selectedConvId === conv.id ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">{conv.title}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 ml-5">
                <Badge variant="outline" className="text-[10px]">
                  {conv.mode}
                </Badge>
                <span className="text-xs text-muted-foreground">{conv.date}</span>
              </div>
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* ── Center: Main Chat ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="max-w-sm text-center space-y-4">
              <div className="mx-auto size-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="size-8 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Council Deliberation</h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Configure your council on the right, then ask a question to receive
                  multi-perspective analysis.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {councilMembers.map((m) => {
                  const c = getColor(m.name);
                  return (
                    <Badge key={m.id} className={c.badge}>
                      {m.name}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-6 space-y-6 max-w-3xl mx-auto">
              {messages.map((msg) => {
                if (msg.role === "user") {
                  return (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground text-sm leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                // Council message
                return (
                  <div key={msg.id} className="space-y-3">
                    {councilMembers.map((member) => {
                      const c = getColor(member.name);
                      const streaming = streamingOpinions[member.name];
                      const isDone = completedMembers.has(member.name);
                      const text = streaming ?? (isDone ? "" : "");

                      return (
                        <div key={member.id} className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`size-2 rounded-full ${c.dot}`} />
                            <Badge className={`text-[11px] ${c.badge}`}>{member.name}</Badge>
                            <span className="text-[10px] text-muted-foreground">{member.model}</span>
                            {!isDone && isStreaming && streaming !== undefined && (
                              <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                            )}
                          </div>
                          <div className="ml-4 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm leading-relaxed min-h-[3rem]">
                            {text || (
                              <span className="text-muted-foreground italic text-xs">
                                {isStreaming && !isDone && streaming === undefined
                                  ? "Waiting…"
                                  : ""}
                              </span>
                            )}
                            {!isDone && isStreaming && streaming !== undefined && (
                              <span className="inline-block w-0.5 h-3.5 bg-primary/70 animate-pulse ml-0.5 align-middle" />
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Council Verdict */}
                    {msg.verdict && (
                      <Card className="border-primary/20 bg-primary/5 ml-4">
                        <CardHeader className="pb-2 pt-3 px-4">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Sparkles className="size-3.5 text-primary" />
                            Council Verdict
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="px-4 pb-3">
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {msg.verdict}
                          </p>
                          <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                            <Coins className="size-3" />
                            <span>{msg.tokens} · {msg.cost}</span>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        )}

        {/* Input area */}
        <div className="border-t border-border p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder="Ask the council… (Ctrl+Enter to send)"
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground px-2 py-1 min-h-[36px] max-h-40"
                disabled={isStreaming}
              />
              <div className="flex items-center gap-1 shrink-0">
                {isStreaming ? (
                  <Button size="sm" variant="destructive" onClick={handleStop} className="gap-1.5">
                    <Square className="size-3" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || councilMembers.length === 0}
                    className="gap-1.5"
                  >
                    <Send className="size-3.5" />
                    Send
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
              {councilMembers.length} council member{councilMembers.length !== 1 ? "s" : ""} · Ctrl+Enter to send
            </p>
          </div>
        </div>
      </div>

      {/* ── Right: Council Config ── */}
      <div
        className={`border-l border-border flex flex-col shrink-0 transition-all duration-200 ${
          configOpen ? "w-72" : "w-10"
        }`}
      >
        {/* Toggle button */}
        <div className="p-2 border-b border-border flex items-center justify-between">
          {configOpen && (
            <div className="flex items-center gap-2 px-1">
              <Users className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Council</span>
              <Badge variant="outline" className="text-[10px]">
                {councilMembers.length}
              </Badge>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 ml-auto"
            onClick={() => setConfigOpen((v) => !v)}
          >
            {configOpen ? (
              <ChevronRight className="size-4" />
            ) : (
              <ChevronLeft className="size-4" />
            )}
          </Button>
        </div>

        {configOpen && (
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {councilMembers.map((member) => {
                const c = getColor(member.name);
                return (
                  <div
                    key={member.id}
                    className="rounded-lg border border-border bg-card/50 p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${c.dot} shrink-0`} />
                      <Input
                        value={member.name}
                        onChange={(e) => updateMember(member.id, "name", e.target.value)}
                        className="h-7 text-xs flex-1 min-w-0"
                        placeholder="Member name"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeMember(member.id)}
                        disabled={isStreaming}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                    <Select
                      value={member.model}
                      onValueChange={(v) => updateMember(member.id, "model", v)}
                      disabled={isStreaming}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODELS.map((m) => (
                          <SelectItem key={m.value} value={m.value} className="text-xs">
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}

              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-xs"
                onClick={addMember}
                disabled={isStreaming || councilMembers.length >= 5}
              >
                <Plus className="size-3" />
                Add Member
              </Button>

              {councilMembers.length >= 5 && (
                <p className="text-[10px] text-muted-foreground text-center">
                  Maximum 5 council members
                </p>
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
