import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
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
import { useSidebar } from "~/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
  Menu,
  PanelRight,
  PanelLeft,
  Download,
  Share2,
  Paperclip,
  FileText,
  Image,
  Video,
  Link,
  Settings2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CouncilMember {
  id: string;
  name: string;
  model: string;
}

interface MessageGroup {
  id: string;
  userMessage: string;
  opinions: Record<string, string>;
  verdict: string | null;
  isStreaming: boolean;
  tokens?: string;
  cost?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "llama-3.3-70b", label: "Llama 3.3 70B" },
];

const BUILT_IN_ARCHETYPES = [
  { name: "The Architect", description: "Systems-level thinking, design patterns, long-term structure", model: "claude-sonnet-4-6" },
  { name: "The Pragmatist", description: "Practical, delivery-focused, real-world constraints", model: "gpt-4o" },
  { name: "The Ethicist", description: "Moral implications, fairness, stakeholder impact", model: "gemini-2.5-pro" },
  { name: "The Empiricist", description: "Data-driven, evidence-based, measurement-first", model: "gpt-4o" },
  { name: "The Contrarian", description: "Devil's advocate, challenges assumptions, stress-tests ideas", model: "claude-sonnet-4-6" },
];

const ARCHETYPE_COLORS: Record<string, { badge: string; dot: string }> = {
  Architect: { badge: "bg-blue-500/20 text-blue-400 border-blue-500/30", dot: "bg-blue-500" },
  "The Architect": { badge: "bg-blue-500/20 text-blue-400 border-blue-500/30", dot: "bg-blue-500" },
  Pragmatist: { badge: "bg-amber-500/20 text-amber-400 border-amber-500/30", dot: "bg-amber-500" },
  "The Pragmatist": { badge: "bg-amber-500/20 text-amber-400 border-amber-500/30", dot: "bg-amber-500" },
  Ethicist: { badge: "bg-purple-500/20 text-purple-400 border-purple-500/30", dot: "bg-purple-500" },
  "The Ethicist": { badge: "bg-purple-500/20 text-purple-400 border-purple-500/30", dot: "bg-purple-500" },
  Empiricist: { badge: "bg-green-500/20 text-green-400 border-green-500/30", dot: "bg-green-500" },
  "The Empiricist": { badge: "bg-green-500/20 text-green-400 border-green-500/30", dot: "bg-green-500" },
  Contrarian: { badge: "bg-red-500/20 text-red-400 border-red-500/30", dot: "bg-red-500" },
  "The Contrarian": { badge: "bg-red-500/20 text-red-400 border-red-500/30", dot: "bg-red-500" },
};

const DEFAULT_ARCHETYPE_COLOR = { badge: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" };

const MOCK_OPINIONS: Record<string, string[]> = {
  Architect: [
    "From a systems perspective, this requires careful consideration of boundaries and interfaces. The key is defining clear contracts between components so each can evolve independently without cascading failures across the system.",
    "Architecturally, scalability must be designed in from the start. Retrofitting distributed patterns onto a monolith is costly. I'd recommend event sourcing and CQRS to decouple reads from writes at the data layer.",
    "The structural approach here demands separation of concerns. By isolating domain logic from infrastructure concerns, we create a system that's testable in isolation and resilient to change at any layer.",
  ],
  "The Architect": [
    "From a systems perspective, this requires careful consideration of boundaries and interfaces. The key is defining clear contracts between components so each can evolve independently without cascading failures across the system.",
    "Architecturally, scalability must be designed in from the start. Retrofitting distributed patterns onto a monolith is costly. I'd recommend event sourcing and CQRS to decouple reads from writes at the data layer.",
  ],
  Pragmatist: [
    "In practice, the simplest solution that works today is almost always preferable. Over-engineering upfront costs more than it saves. Start with what you need now and refactor when complexity actually demands it.",
    "From a pragmatic standpoint, teams ship faster when they use familiar patterns. The cognitive overhead of exotic architectures usually outweighs their theoretical benefits for most production systems.",
    "Real-world constraints matter: deadlines, team skill, operational complexity. The best solution is one your team can build, maintain, and debug at 2am during an incident without heroic effort.",
  ],
  "The Pragmatist": [
    "In practice, the simplest solution that works today is almost always preferable. Over-engineering upfront costs more than it saves. Start with what you need now and refactor when complexity actually demands it.",
    "Real-world constraints matter: deadlines, team skill, operational complexity. The best solution is one your team can build, maintain, and debug at 2am during an incident without heroic effort.",
  ],
  Ethicist: [
    "We must consider the downstream effects on all stakeholders: users, developers, and communities affected by this system. Privacy and data minimization should be first-class concerns, not afterthoughts added at audit time.",
    "Ethical implications extend beyond compliance. How does this system affect power dynamics? Who bears the risk when things go wrong? Equitable design means building accountability and redress mechanisms in from day one.",
    "The long-term impact on user autonomy matters here. Systems that create dependency or obscure decision-making erode trust. Transparency and user control should be core design values, not optional features.",
  ],
  "The Ethicist": [
    "We must consider the downstream effects on all stakeholders: users, developers, and communities affected by this system. Privacy and data minimization should be first-class concerns, not afterthoughts added at audit time.",
    "The long-term impact on user autonomy matters here. Systems that create dependency or obscure decision-making erode trust. Transparency and user control should be core design values, not optional features.",
  ],
  Empiricist: [
    "The data should guide this decision. Without measuring current baselines we're just guessing. I'd propose A/B testing multiple approaches and letting empirical evidence determine the winner rather than theoretical arguments.",
    "Historical data from similar systems shows mixed results. The research literature suggests effect sizes are smaller than intuition predicts. We need controlled experiments with clear success metrics before committing resources.",
    "Evidence-based engineering means being willing to challenge our assumptions. Run the experiment, measure rigorously, and be prepared to abandon the approach if the numbers don't support it.",
  ],
  "The Empiricist": [
    "The data should guide this decision. Without measuring current baselines we're just guessing. I'd propose A/B testing multiple approaches and letting empirical evidence determine the winner rather than theoretical arguments.",
    "Evidence-based engineering means being willing to challenge our assumptions. Run the experiment, measure rigorously, and be prepared to abandon the approach if the numbers don't support it.",
  ],
  Contrarian: [
    "Everyone is assuming the standard approach here, but what if the premise itself is flawed? The real problem might be that we're solving the wrong problem entirely. Let's question the constraints before accepting them.",
    "The conventional wisdom on this topic has significant blind spots. Counterintuitively, the opposite strategy has outperformed in several documented cases. We should at least stress-test the dominant assumption.",
    "I'd push back on the framing. The most dangerous ideas are the ones everyone agrees with because they stop thinking. What if the second-order effects of this decision undermine the first-order gains?",
  ],
  "The Contrarian": [
    "Everyone is assuming the standard approach here, but what if the premise itself is flawed? The real problem might be that we're solving the wrong problem entirely. Let's question the constraints before accepting them.",
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

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background text-sm px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
      <Sparkles className="size-3.5 shrink-0" />
      {message}
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// ─── Custom Member Dialog ────────────────────────────────────────────────────

interface CustomMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (member: Omit<CouncilMember, "id">) => void;
}

function CustomMemberDialog({ open, onClose, onAdd }: CustomMemberDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [temperature, setTemperature] = useState(0.7);
  const navigate = useNavigate();

  const handleArchetypeSelect = (archetype: typeof BUILT_IN_ARCHETYPES[0]) => {
    setName(archetype.name);
    setDescription(archetype.description);
    setModel(archetype.model);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    onAdd({ name: name.trim(), model });
    setName("");
    setDescription("");
    setSystemPrompt("");
    setModel("gpt-4o");
    setTemperature(0.7);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Custom Council Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Start from Archetype</label>
            <Select onValueChange={(v) => {
              const arch = BUILT_IN_ARCHETYPES.find(a => a.name === v);
              if (arch) handleArchetypeSelect(arch);
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an archetype (optional)" />
              </SelectTrigger>
              <SelectContent>
                {BUILT_IN_ARCHETYPES.map((a) => (
                  <SelectItem key={a.name} value={a.name}>
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">{a.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Strategist"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of this member's role"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a strategic advisor who..."
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Model</label>
            <Select
              value={model}
              onValueChange={(v) => {
                if (v === "__add_model__") {
                  onClose();
                  navigate("/language-models");
                  return;
                }
                setModel(v);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
                <SelectItem value="__add_model__">
                  <span className="flex items-center gap-1.5 text-primary">
                    <Plus className="size-3" />
                    Add Model...
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Temperature</label>
              <span className="text-sm text-muted-foreground tabular-nums">{temperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Precise (0)</span>
              <span>Creative (2)</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>Add Member</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [conversations, setConversations] = useState(mockConversations);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messageGroups, setMessageGroups] = useState<MessageGroup[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [councilMembers, setCouncilMembers] = useState<CouncilMember[]>(defaultMembers);

  // Panel visibility — initial state deferred to layout effect
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  // Mobile overlay state
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [mobileCouncilOpen, setMobileCouncilOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Main sidebar (root layout)
  const { toggleSidebar, open: mainSidebarOpen } = useSidebar();

  const [isStreaming, setIsStreaming] = useState(false);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [streamingOpinions, setStreamingOpinions] = useState<Record<string, string>>({});
  const [completedMembers, setCompletedMembers] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const stopRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Detect mobile
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setHistoryOpen(false);
        setConfigOpen(false);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Responsive layout stages:
  // <640: too narrow — only one panel visible at a time (overlays)
  // 640-1024: 1st stage — two panels max (history+chat default)
  // 1024-1400: 2nd stage — three panels max
  // >1400: 3rd stage — all four panels
  const [layoutStage, setLayoutStage] = useState(3);
  const [layoutInitialized, setLayoutInitialized] = useState(false);

  useEffect(() => {
    const updateLayout = () => {
      const w = window.innerWidth;
      let stage: number;
      if (w < 640) stage = 0;
      else if (w < 1024) stage = 1;
      else if (w < 1400) stage = 2;
      else stage = 3;
      setLayoutStage(stage);

      if (!layoutInitialized) {
        // Set initial panel state based on width
        if (stage === 0) {
          setHistoryOpen(false);
          setConfigOpen(false);
          setIsMobile(true);
        } else if (stage === 1) {
          setHistoryOpen(true);
          setConfigOpen(false);
        } else if (stage === 2) {
          setHistoryOpen(true);
          setConfigOpen(true);
        } else {
          setHistoryOpen(true);
          setConfigOpen(true);
        }
        setLayoutInitialized(true);
      }
    };
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, [layoutInitialized]);

  // Auto-manage panel visibility when resizing DOWN (close panels that don't fit)
  useEffect(() => {
    if (!layoutInitialized) return;
    if (layoutStage === 0) {
      setHistoryOpen(false);
      setConfigOpen(false);
    } else if (layoutStage === 1 && historyOpen && configOpen) {
      // Can only show 2 panels, default to keeping history
      setConfigOpen(false);
    }
  }, [layoutStage, layoutInitialized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enforce max panels when toggling
  const toggleHistory = () => {
    if (layoutStage === 0) {
      setMobileHistoryOpen(true);
      return;
    }
    setHistoryOpen(prev => {
      const next = !prev;
      if (next && layoutStage === 1) {
        setConfigOpen(false); // Only 2 panels at stage 1
      }
      return next;
    });
  };

  const toggleCouncil = () => {
    if (layoutStage === 0) {
      setMobileCouncilOpen(true);
      return;
    }
    setConfigOpen(prev => {
      const next = !prev;
      if (next && layoutStage === 1) {
        setHistoryOpen(false); // Only 2 panels at stage 1
      }
      return next;
    });
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageGroups, streamingOpinions]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const simulateStreaming = useCallback(
    (groupId: string, memberName: string, fullText: string): Promise<void> => {
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
            const partial = fullText.slice(0, index);
            setStreamingOpinions((prev) => ({ ...prev, [memberName]: partial }));
            // Also update the message group with current partial so it persists if stopped
            setMessageGroups((prev) =>
              prev.map((g) =>
                g.id === groupId
                  ? { ...g, opinions: { ...g.opinions, [memberName]: partial } }
                  : g
              )
            );
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
    if (!selectedConvId) {
      const newConv = {
        id: Date.now().toString(),
        title: text.length > 40 ? text.slice(0, 40) + "…" : text,
        date: "Just now",
        mode: "Council",
      };
      setConversations((prev) => [newConv, ...prev]);
      setSelectedConvId(newConv.id);
    }

    const groupId = Date.now().toString();

    // Add new message group — existing groups are untouched
    const newGroup: MessageGroup = {
      id: groupId,
      userMessage: text,
      opinions: {},
      verdict: null,
      isStreaming: true,
    };
    setMessageGroups((prev) => [...prev, newGroup]);
    setCurrentGroupId(groupId);
    setIsStreaming(true);
    stopRef.current = false;
    setStreamingOpinions({});
    setCompletedMembers(new Set());

    // Stream each member sequentially
    for (const member of councilMembers) {
      if (stopRef.current) break;
      const opinionBank = MOCK_OPINIONS[member.name] ?? MOCK_OPINIONS["Architect"];
      const fullText = pickRandom(opinionBank);
      await simulateStreaming(groupId, member.name, fullText);
      await new Promise((r) => setTimeout(r, 200));
    }

    if (!stopRef.current) {
      const verdict = pickRandom(VERDICTS);
      const finalOpinions: Record<string, string> = {};
      for (const member of councilMembers) {
        const opinionBank = MOCK_OPINIONS[member.name] ?? MOCK_OPINIONS["Architect"];
        finalOpinions[member.name] = pickRandom(opinionBank);
      }
      setMessageGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? {
                ...g,
                opinions: finalOpinions,
                verdict,
                isStreaming: false,
                tokens: `${(Math.floor(Math.random() * 900) + 800).toLocaleString()} tokens`,
                cost: `$${(Math.random() * 0.04 + 0.01).toFixed(2)}`,
              }
            : g
        )
      );
    } else {
      setMessageGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, isStreaming: false } : g))
      );
    }

    setIsStreaming(false);
    setCurrentGroupId(null);
    setStreamingOpinions({});
    setCompletedMembers(new Set());
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

  const addArchetype = (archetype: typeof BUILT_IN_ARCHETYPES[0]) => {
    if (councilMembers.length >= 5) {
      setToast("Maximum 5 council members reached");
      return;
    }
    if (councilMembers.some((m) => m.name === archetype.name)) {
      setToast(`${archetype.name} is already in your council`);
      return;
    }
    setCouncilMembers((prev) => [
      ...prev,
      { id: Date.now().toString(), name: archetype.name, model: archetype.model },
    ]);
  };

  const addCustomMember = (member: Omit<CouncilMember, "id">) => {
    if (councilMembers.length >= 5) {
      setToast("Maximum 5 council members reached");
      return;
    }
    setCouncilMembers((prev) => [
      ...prev,
      { id: Date.now().toString(), ...member },
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

  const handleExportChat = () => {
    if (messageGroups.length === 0) {
      setToast("No messages to export");
      return;
    }
    let content = "# Council Deliberation Export\n\n";
    for (const group of messageGroups) {
      content += `## You\n${group.userMessage}\n\n`;
      for (const [memberName, opinion] of Object.entries(group.opinions)) {
        content += `## ${memberName}\n${opinion}\n\n`;
      }
      if (group.verdict) {
        content += `## Council Verdict\n${group.verdict}\n\n`;
      }
      content += "---\n\n";
    }
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "council-deliberation.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = () => {
    setToast("Sharing coming soon");
  };

  const handleAttachment = (type: string) => {
    setToast(`${type} coming soon`);
  };

  // ── History Panel content (shared between desktop sidebar and mobile overlay)
  const HistoryPanelContent = (
    <>
      <div className="p-3 border-b border-border space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => {
            setSelectedConvId(null);
            setMessageGroups([]);
            setStreamingOpinions({});
            if (layoutStage === 0) setMobileHistoryOpen(false);
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
              setMessageGroups([]);
              setStreamingOpinions({});
              if (layoutStage === 0) setMobileHistoryOpen(false);
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
    </>
  );

  // ── Council Panel content
  const CouncilPanelContent = (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        {/* Archetype quick-add dropdown */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-0.5">
            Quick Add Archetype
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-xs justify-between"
                disabled={isStreaming || councilMembers.length >= 5}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="size-3" />
                  Add Archetype
                </span>
                <ChevronRight className="size-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {BUILT_IN_ARCHETYPES.map((a) => (
                <DropdownMenuItem
                  key={a.name}
                  onClick={() => addArchetype(a)}
                  className="flex flex-col items-start gap-0.5 py-2"
                >
                  <span className="font-medium text-xs">{a.name}</span>
                  <span className="text-[10px] text-muted-foreground leading-snug">{a.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={() => setCustomDialogOpen(true)}
            disabled={isStreaming || councilMembers.length >= 5}
          >
            <Settings2 className="size-3" />
            Create Custom
          </Button>
        </div>

        <div className="border-t border-border pt-3 space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-0.5">
            Current Council
          </p>
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
                  onValueChange={(v) => {
                    if (v === "__add_model__") {
                      window.location.href = "/language-models";
                      return;
                    }
                    updateMember(member.id, "model", v);
                  }}
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
                    <SelectItem value="__add_model__" className="text-xs">
                      <span className="flex items-center gap-1.5 text-primary">
                        <Plus className="size-3" />
                        Add Model...
                      </span>
                    </SelectItem>
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
      </div>
    </ScrollArea>
  );

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* ── Mobile History Overlay (stage 0 only) ── */}
      {layoutStage === 0 && mobileHistoryOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div className="w-72 bg-background border-r border-border flex flex-col h-full shadow-xl">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-medium">Chat History</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setMobileHistoryOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            {HistoryPanelContent}
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMobileHistoryOpen(false)} />
        </div>
      )}

      {/* ── Mobile Council Overlay (stage 0 only) ── */}
      {layoutStage === 0 && mobileCouncilOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="flex-1 bg-black/40" onClick={() => setMobileCouncilOpen(false)} />
          <div className="w-72 bg-background border-l border-border flex flex-col h-full shadow-xl">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Council</span>
                <Badge variant="outline" className="text-[10px]">{councilMembers.length}</Badge>
              </div>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setMobileCouncilOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            {CouncilPanelContent}
          </div>
        </div>
      )}

      {/* ── Left: History Panel (desktop, stages 1+) ── */}
      {layoutStage >= 1 && (
        <div
          className={`border-r border-border flex flex-col shrink-0 transition-all duration-200 overflow-hidden ${
            historyOpen ? "w-64" : "w-0"
          }`}
        >
          <div className="w-64 flex flex-col h-full">
            {HistoryPanelContent}
          </div>
        </div>
      )}

      {/* ── Center: Main Chat ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="border-b border-border px-4 py-2 flex items-center gap-2 shrink-0">
          {/* Left controls */}
          <div className="flex items-center gap-1">
            {/* Main sidebar toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={toggleSidebar}
              title={mainSidebarOpen ? "Hide main panel" : "Show main panel"}
            >
              <PanelLeft className="size-4" />
            </Button>
            <Button
              variant={historyOpen ? "secondary" : "ghost"}
              size="icon"
              className="size-8"
              onClick={toggleHistory}
              title={historyOpen ? "Hide history" : "Show history"}
            >
              {historyOpen ? <ChevronLeft className="size-4" /> : <Menu className="size-4" />}
            </Button>
          </div>

          {/* Title area */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <Sparkles className="size-4 text-primary shrink-0" />
            <span className="text-sm font-medium truncate">Council Deliberation</span>
            {councilMembers.length > 0 && (
              <div className="hidden sm:flex items-center gap-1 flex-wrap">
                {councilMembers.slice(0, 3).map((m) => {
                  const c = getColor(m.name);
                  return (
                    <Badge key={m.id} className={`text-[10px] ${c.badge}`}>
                      {m.name}
                    </Badge>
                  );
                })}
                {councilMembers.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">+{councilMembers.length - 3}</span>
                )}
              </div>
            )}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8 text-xs hidden sm:flex"
              onClick={handleExportChat}
              title="Export chat"
            >
              <Download className="size-3.5" />
              Export
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 sm:hidden"
              onClick={handleExportChat}
              title="Export chat"
            >
              <Download className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8 text-xs hidden sm:flex"
              onClick={handleShare}
              title="Share"
            >
              <Share2 className="size-3.5" />
              Share
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 sm:hidden"
              onClick={handleShare}
              title="Share"
            >
              <Share2 className="size-4" />
            </Button>
            {!configOpen && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 text-xs"
                onClick={toggleCouncil}
              >
                <Users className="size-3.5" />
                Council
                <Badge variant="outline" className="text-[10px] ml-0.5">{councilMembers.length}</Badge>
              </Button>
            )}
          </div>
        </div>

        {/* Message area */}
        {messageGroups.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6">
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
            <div className="p-4 sm:p-6 space-y-8 max-w-3xl mx-auto">
              {messageGroups.map((group) => {
                const isCurrentGroup = group.id === currentGroupId;

                return (
                  <div key={group.id} className="space-y-4">
                    {/* User message */}
                    <div className="flex justify-end">
                      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground text-sm leading-relaxed">
                        {group.userMessage}
                      </div>
                    </div>

                    {/* Council responses */}
                    <div className="space-y-3">
                      {councilMembers.map((member) => {
                        const c = getColor(member.name);
                        // For the current streaming group, use live streaming opinions.
                        // For past groups, use stored opinions.
                        const text = isCurrentGroup
                          ? (streamingOpinions[member.name] ?? group.opinions[member.name] ?? "")
                          : (group.opinions[member.name] ?? "");
                        const isDone = isCurrentGroup
                          ? completedMembers.has(member.name)
                          : !!group.opinions[member.name];
                        const isWaiting = isCurrentGroup && isStreaming && !isDone && !streamingOpinions[member.name];
                        const isTyping = isCurrentGroup && isStreaming && !!streamingOpinions[member.name] && !isDone;

                        return (
                          <div key={member.id} className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className={`size-2 rounded-full ${c.dot}`} />
                              <Badge className={`text-[11px] ${c.badge}`}>{member.name}</Badge>
                              <span className="text-[10px] text-muted-foreground">{member.model}</span>
                              {isTyping && (
                                <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                              )}
                            </div>
                            <div className="ml-4 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm leading-relaxed min-h-[3rem]">
                              {text || (
                                <span className="text-muted-foreground italic text-xs">
                                  {isWaiting ? "Waiting…" : ""}
                                </span>
                              )}
                              {isTyping && (
                                <span className="inline-block w-0.5 h-3.5 bg-primary/70 animate-pulse ml-0.5 align-middle" />
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Council Verdict */}
                      {group.verdict && (
                        <Card className="border-primary/20 bg-primary/5 ml-4">
                          <CardHeader className="pb-2 pt-3 px-4">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Sparkles className="size-3.5 text-primary" />
                              Council Verdict
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="px-4 pb-3">
                            <p className="text-sm leading-relaxed text-muted-foreground">
                              {group.verdict}
                            </p>
                            {group.tokens && group.cost && (
                              <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                                <Coins className="size-3" />
                                <span>{group.tokens} · {group.cost}</span>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        )}

        {/* Input area */}
        <div className="border-t border-border p-3 sm:p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2">
              {/* Attachment button */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                    title="Add attachment"
                    disabled={isStreaming}
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-48">
                  <DropdownMenuItem onClick={() => handleAttachment("File upload")}>
                    <FileText className="size-3.5 mr-2" />
                    Upload File
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttachment("Image upload")}>
                    <Image className="size-3.5 mr-2" />
                    Add Image
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttachment("Audio/Video upload")}>
                    <Video className="size-3.5 mr-2" />
                    Add Audio/Video
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttachment("Website link")}>
                    <Link className="size-3.5 mr-2" />
                    Add Website Link
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

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

      {/* ── Right: Council Config (desktop, stages 1+) ── */}
      {layoutStage >= 1 && (
        <div
          className={`border-l border-border flex flex-col shrink-0 transition-all duration-200 overflow-hidden ${
            configOpen ? "w-72" : "w-0"
          }`}
        >
          <div className="w-72 flex flex-col h-full">
            <div className="p-3 border-b border-border flex items-center gap-2 shrink-0">
              <Users className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Council</span>
              <Badge variant="outline" className="text-[10px]">{councilMembers.length}</Badge>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => {
                  setConfigOpen(false);
                  setMobileCouncilOpen(false);
                }}
                title="Hide council panel"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            {CouncilPanelContent}
          </div>
        </div>
      )}

      {/* ── Dialogs & Toasts ── */}
      <CustomMemberDialog
        open={customDialogOpen}
        onClose={() => setCustomDialogOpen(false)}
        onAdd={addCustomMember}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
