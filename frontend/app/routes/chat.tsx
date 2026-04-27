import { useState, useRef, useEffect, useCallback } from "react";
import type { Route } from "./+types/chat";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { useStore } from "~/context/StoreContext";
import { useAuth } from "~/context/AuthContext";
import { deliberate, listThreads, createThread, deleteThread, getMessages, onOpinion, onVerdict, onDone, toggleGlass } from "~/lib/deliberate";
import { loadCouncilMembers } from "~/lib/council";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ScrollArea } from "~/components/ui/scroll-area";
import { useSidebar } from "~/components/ui/sidebar";
import { Switch } from "~/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
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
  RotateCcw,
  Clock,
  Zap,
  Save,
  FolderOpen,
  Trash2,
  Mic,
  Globe,
  VolumeX,
  Volume2,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CouncilMember {
  id: string;
  name: string;
  model: string;
  /** Phase 1.2 — per-member mute toggle */
  muted?: boolean;
  /** Per-member capability flags */
  deepThinking?: boolean;
  webSearch?: boolean;
}

interface CouncilPreset {
  id: string;
  name: string;
  members: Omit<CouncilMember, "id">[];
}

interface MessageGroup {
  id: string;
  userMessage: string;
  opinions: Record<string, string>;
  verdict: string | null;
  isStreaming: boolean;
  tokens?: string;
  cost?: string;
  latencyMs?: number;
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

const mockConversations: { id: string; title: string; date: string; mode: string }[] = [];

const defaultMembers: CouncilMember[] = [
  { id: "m1", name: "Architect", model: "claude-sonnet-4-6" },
  { id: "m2", name: "Pragmatist", model: "gpt-4o" },
  { id: "m3", name: "Ethicist", model: "gemini-2.5-pro" },
];

const BUILT_IN_PRESETS: CouncilPreset[] = [
  {
    id: "balanced",
    name: "Balanced Council",
    members: [
      { name: "The Architect", model: "claude-sonnet-4-6" },
      { name: "The Pragmatist", model: "gpt-4o" },
      { name: "The Ethicist", model: "gemini-2.5-pro" },
    ],
  },
  {
    id: "technical",
    name: "Technical Review",
    members: [
      { name: "The Architect", model: "claude-sonnet-4-6" },
      { name: "The Empiricist", model: "gpt-4o" },
      { name: "The Contrarian", model: "claude-sonnet-4-6" },
    ],
  },
  {
    id: "strategy",
    name: "Strategy & Ethics",
    members: [
      { name: "The Pragmatist", model: "gpt-4o" },
      { name: "The Ethicist", model: "gemini-2.5-pro" },
      { name: "The Contrarian", model: "claude-sonnet-4-6" },
    ],
  },
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

// ─── Add Member Dialog ───────────────────────────────────────────────────────

interface AddMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (member: Omit<CouncilMember, "id">) => void;
}

function AddMemberDialog({ open, onClose, onAdd }: AddMemberDialogProps) {
  const store = useStore();

  // Archetype selection
  const [selectedArchetype, setSelectedArchetype] = useState("");
  const [showNewArchetype, setShowNewArchetype] = useState(false);
  const [newArchName, setNewArchName] = useState("");
  const [newArchDescription, setNewArchDescription] = useState("");
  const [newArchThinkingStyle, setNewArchThinkingStyle] = useState("");

  // Model selection
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [showNewModel, setShowNewModel] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [newModelApiUrl, setNewModelApiUrl] = useState("");
  const [newModelApiKey, setNewModelApiKey] = useState("");

  const allArchetypes = [
    ...BUILT_IN_ARCHETYPES.map((a) => ({ id: a.name, name: a.name, description: a.description, model: a.model })),
    ...store.customArchetypes.map((a) => ({ id: a.id, name: a.name, description: a.description, model: a.model ?? "gpt-4o" })),
  ];

  const resetForm = () => {
    setSelectedArchetype("");
    setShowNewArchetype(false);
    setNewArchName("");
    setNewArchDescription("");
    setNewArchThinkingStyle("");
    setSelectedModel("gpt-4o");
    setShowNewModel(false);
    setNewModelName("");
    setNewModelApiUrl("");
    setNewModelApiKey("");
  };

  const handleCreateArchetype = () => {
    if (!newArchName.trim()) return;
    store.addCustomArchetype({
      name: newArchName.trim(),
      icon: "Hexagon",
      color: "violet",
      thinkingStyle: newArchThinkingStyle.trim() || "General purpose",
      description: newArchDescription.trim(),
    });
    setSelectedArchetype(newArchName.trim());
    setShowNewArchetype(false);
    setNewArchName("");
    setNewArchDescription("");
    setNewArchThinkingStyle("");
  };

  const handleCreateModel = () => {
    if (!newModelName.trim() || !newModelApiUrl.trim()) return;
    store.addCustomModel({
      label: newModelName.trim(),
      apiUrl: newModelApiUrl.trim(),
      apiKey: newModelApiKey.trim() || undefined,
    });
    setSelectedModel(`custom-model-pending`);
    setShowNewModel(false);
    setNewModelName("");
    setNewModelApiUrl("");
    setNewModelApiKey("");
  };

  // After store updates, pick the latest custom model
  useEffect(() => {
    if (selectedModel === "custom-model-pending" && store.customModels.length > 0) {
      setSelectedModel(store.customModels[store.customModels.length - 1].id);
    }
  }, [store.customModels, selectedModel]);

  const handleSubmit = () => {
    const archName = selectedArchetype || "Custom Member";
    onAdd({ name: archName, model: selectedModel });
    resetForm();
    onClose();
  };

  // When archetype changes, also set its default model
  const handleArchetypeChange = (value: string) => {
    if (value === "__new__") {
      setShowNewArchetype(true);
      return;
    }
    setSelectedArchetype(value);
    setShowNewArchetype(false);
    const arch = allArchetypes.find((a) => a.name === value);
    if (arch?.model) setSelectedModel(arch.model);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Council Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Archetype selector */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Archetype</Label>
            <Select value={selectedArchetype} onValueChange={handleArchetypeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an archetype..." />
              </SelectTrigger>
              <SelectContent>
                {allArchetypes.map((a) => (
                  <SelectItem key={a.id} value={a.name}>
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">{a.name}</span>
                      {a.description && (
                        <span className="text-[10px] text-muted-foreground">{a.description}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="__new__">
                  <span className="flex items-center gap-1.5 text-primary">
                    <Plus className="size-3" />
                    Create New Archetype...
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Inline new archetype form */}
          {showNewArchetype && (
            <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 space-y-3">
              <p className="text-xs font-medium text-primary">New Archetype</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Name *</Label>
                <Input
                  value={newArchName}
                  onChange={(e) => setNewArchName(e.target.value)}
                  placeholder="e.g. The Strategist"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Input
                  value={newArchDescription}
                  onChange={(e) => setNewArchDescription(e.target.value)}
                  placeholder="Short description of thinking style"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Thinking Style</Label>
                <Input
                  value={newArchThinkingStyle}
                  onChange={(e) => setNewArchThinkingStyle(e.target.value)}
                  placeholder="e.g. Strategic, big-picture"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowNewArchetype(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={handleCreateArchetype} disabled={!newArchName.trim()}>
                  Create
                </Button>
              </div>
            </div>
          )}

          <Separator />

          {/* Model selector */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Model</Label>
            <Select
              value={selectedModel}
              onValueChange={(v) => {
                if (v === "__new_model__") {
                  setShowNewModel(true);
                  return;
                }
                setSelectedModel(v);
                setShowNewModel(false);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {store.allModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
                <SelectItem value="__new_model__">
                  <span className="flex items-center gap-1.5 text-primary">
                    <Plus className="size-3" />
                    Add New Model...
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Inline new model form */}
          {showNewModel && (
            <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 space-y-3">
              <p className="text-xs font-medium text-primary">New Model</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Name *</Label>
                <Input
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder="e.g. Mistral Large"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API URL *</Label>
                <Input
                  value={newModelApiUrl}
                  onChange={(e) => setNewModelApiUrl(e.target.value)}
                  placeholder="https://api.example.com/v1/chat"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">API Key</Label>
                <Input
                  type="password"
                  value={newModelApiKey}
                  onChange={(e) => setNewModelApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowNewModel(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={handleCreateModel} disabled={!newModelName.trim() || !newModelApiUrl.trim()}>
                  Add Model
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { resetForm(); onClose(); }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!selectedArchetype}>Add Member</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inline Archetype Creation Dialog ────────────────────────────────────────

function InlineArchetypeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const store = useStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [thinkingStyle, setThinkingStyle] = useState("");

  const reset = () => { setName(""); setDescription(""); setThinkingStyle(""); };

  const handleCreate = () => {
    if (!name.trim()) return;
    store.addCustomArchetype({
      name: name.trim(),
      icon: "Hexagon",
      color: "violet",
      thinkingStyle: thinkingStyle.trim() || "General purpose",
      description: description.trim(),
    });
    onCreated(name.trim());
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create New Archetype</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Strategist" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Thinking Style</Label>
            <Input value={thinkingStyle} onChange={(e) => setThinkingStyle(e.target.value)} placeholder="e.g. Strategic, big-picture" className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={!name.trim()}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inline Model Creation Dialog ────────────────────────────────────────────

function InlineModelDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (modelId: string) => void;
}) {
  const store = useStore();
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const reset = () => { setName(""); setApiUrl(""); setApiKey(""); };

  const handleCreate = () => {
    if (!name.trim() || !apiUrl.trim()) return;
    const newId = store.addCustomModel({
      label: name.trim(),
      apiUrl: apiUrl.trim(),
      apiKey: apiKey.trim() || undefined,
    });
    onCreated(newId);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add New Model</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mistral Large" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">API URL *</Label>
            <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://api.example.com/v1/chat" className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="h-8 text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={!name.trim() || !apiUrl.trim()}>Add Model</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// Skip SSR — this page is fully interactive and uses browser APIs extensively
export function clientLoader() {
  return {};
}

export default function ChatPage() {
  const store = useStore();
  const { user } = useAuth();
  const userKey = user?.id ? `judica-chats-${user.id}` : null;

  const [conversations, setConversations] = useState<typeof mockConversations>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  // Load threads from SQLite on mount
  useEffect(() => {
    listThreads().then((threads: any[]) => {
      if (threads.length > 0) {
        setConversations(threads.map((t: any) => ({
          id: t.id,
          title: t.title ?? "Untitled",
          date: new Date(t.updated_at).toLocaleDateString(),
          mode: "Council",
        })));
      } else if (userKey) {
        // fallback to localStorage for non-Electron
        try {
          const stored = localStorage.getItem(userKey);
          if (stored) setConversations(JSON.parse(stored));
        } catch { /* ignore */ }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When a thread is selected, load its messages from SQLite
  useEffect(() => {
    if (!selectedConvId) return;
    setActiveThreadId(selectedConvId);
    getMessages(selectedConvId).then((msgs: any[]) => {
      if (!msgs || msgs.length === 0) { setMessageGroups([]); return; }
      // Rebuild messageGroups from DB messages
      const roundMap = new Map<number, MessageGroup>();
      let maxRound = 1;
      for (const msg of msgs) {
        maxRound = Math.max(maxRound, msg.round ?? 1);
        if (!roundMap.has(msg.round)) {
          roundMap.set(msg.round, { id: `${selectedConvId}-${msg.round}`, userMessage: "", opinions: {}, verdict: null, isStreaming: false });
        }
        const group = roundMap.get(msg.round)!;
        if (msg.role === "user") group.userMessage = msg.content;
        if (msg.role === "opinion") group.opinions[msg.member ?? "Unknown"] = msg.content;
        if (msg.role === "verdict") group.verdict = msg.content;
      }
      setRound(maxRound);
      setMessageGroups(Array.from(roundMap.values()).sort((a, b) => {
        const ra = parseInt(a.id.split("-").pop() ?? "1");
        const rb = parseInt(b.id.split("-").pop() ?? "1");
        return ra - rb;
      }));
    });
  }, [selectedConvId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist selected conversation
  useEffect(() => {
    if (selectedConvId) sessionStorage.setItem("judica-conv", selectedConvId);
    else sessionStorage.removeItem("judica-conv");
  }, [selectedConvId]);
  const [messageGroups, setMessageGroups] = useState<MessageGroup[]>([]);
  const [inputValue, setInputValue] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("judica-draft") ?? "";
    }
    return "";
  });

  // Persist draft to sessionStorage
  useEffect(() => {
    sessionStorage.setItem("judica-draft", inputValue);
  }, [inputValue]);
  const [councilMembers, setCouncilMembers] = useState<CouncilMember[]>(() => {
    // Load from settings (real providers)
    const providers = loadCouncilMembers();
    const mapped = providers
      .filter((m) => m.enabled)
      .map((m) => ({ id: m.id, name: m.label, model: m.model || m.provider }));
    return mapped.length > 0 ? mapped : defaultMembers;
  });

  // Active thread tracking
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const [glassOn, setGlassOn] = useState(false);
  const [savedPresets, setSavedPresets] = useState<CouncilPreset[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("judica-presets");
        return stored ? JSON.parse(stored) : [];
      } catch { return []; }
    }
    return [];
  });

  // Persist presets
  useEffect(() => {
    localStorage.setItem("judica-presets", JSON.stringify(savedPresets));
  }, [savedPresets]);

  const allPresets = [...BUILT_IN_PRESETS, ...savedPresets];

  const saveCurrentAsPreset = () => {
    const name = prompt("Preset name:");
    if (!name?.trim()) return;
    const preset: CouncilPreset = {
      id: `preset-${Date.now()}`,
      name: name.trim(),
      members: councilMembers.map(({ name, model }) => ({ name, model })),
    };
    setSavedPresets((prev) => [...prev, preset]);
    setToast(`Saved preset "${name.trim()}"`);
  };

  const loadPreset = (preset: CouncilPreset) => {
    setCouncilMembers(
      preset.members.map((m, i) => ({ id: `p${Date.now()}-${i}`, ...m }))
    );
    setToast(`Loaded "${preset.name}"`);
  };

  const deletePreset = (id: string) => {
    setSavedPresets((prev) => prev.filter((p) => p.id !== id));
  };

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
  // Inline creation states for council member card dropdowns
  const [inlineArchOpen, setInlineArchOpen] = useState(false);
  const [inlineArchTarget, setInlineArchTarget] = useState<string | null>(null); // member id
  const [inlineModelOpen, setInlineModelOpen] = useState(false);
  const [inlineModelTarget, setInlineModelTarget] = useState<string | null>(null); // member id
  const [deepResearch, setDeepResearch] = useState(false);
  const stopRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Responsive layout stages:
  // <640: too narrow — only one panel visible at a time (overlays)
  // 640-1024: 1st stage — two panels max (history+chat default)
  // 1024-1400: 2nd stage — three panels max
  // >1400: 3rd stage — all four panels
  const [layoutStage, setLayoutStage] = useState(3);
  const [layoutInitialized, setLayoutInitialized] = useState(false);

  // Detect mobile and very narrow screens
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const mobile = w < 768;
      const veryNarrow = w < 480;
      setIsMobile(mobile);
      if (mobile || veryNarrow) {
        setHistoryOpen(false);
        setConfigOpen(false);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;

      // Escape — close overlays/panels
      if (e.key === "Escape") {
        if (mobileHistoryOpen) { setMobileHistoryOpen(false); return; }
        if (mobileCouncilOpen) { setMobileCouncilOpen(false); return; }
        if (customDialogOpen) { setCustomDialogOpen(false); return; }
        if (inlineArchOpen) { setInlineArchOpen(false); return; }
        if (inlineModelOpen) { setInlineModelOpen(false); return; }
        if (configOpen) { setConfigOpen(false); return; }
        if (historyOpen && layoutStage <= 1) { setHistoryOpen(false); return; }
      }

      if (isInput) return; // Don't hijack typing in inputs

      // / — focus search
      if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('[placeholder="Search..."]');
        if (searchInput) {
          if (!historyOpen) setHistoryOpen(true);
          setTimeout(() => searchInput.focus(), 100);
        }
      }

      // N — new deliberation
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setSelectedConvId(null);
        setMessageGroups([]);
        setStreamingOpinions({});
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mobileHistoryOpen, mobileCouncilOpen, customDialogOpen, inlineArchOpen, inlineModelOpen, configOpen, historyOpen, layoutStage]);

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

  const filteredConversations = conversations.filter((c) => {
    if (!c || typeof c.title !== "string") return true;
    return c.title.toLowerCase().includes(searchQuery.toLowerCase());
  });

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

  const handleSend = async (retryText?: string) => {
    const text = retryText ?? inputValue.trim();
    if (!text || isStreaming || councilMembers.length === 0) return;

    if (!retryText) setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const startTime = performance.now();

    // Create thread if first message in session
    let tid = activeThreadId;
    let thisRound = round;

    if (!tid) {
      tid = await createThread();
      setActiveThreadId(tid);
      thisRound = 1;
      setRound(1);
      const newConv = { id: tid, title: text.slice(0, 50), date: "Just now", mode: "Council" };
      setConversations((prev) => [newConv, ...prev]);
      setSelectedConvId(tid);
    } else {
      thisRound = round + 1;
      setRound((r) => r + 1);
    }

    const groupId = `${tid}-${thisRound}`;
    const newGroup: MessageGroup = { id: groupId, userMessage: text, opinions: {}, verdict: null, isStreaming: true };
    setMessageGroups((prev) => [...prev, newGroup]);
    setCurrentGroupId(groupId);
    setIsStreaming(true);
    stopRef.current = false;
    setStreamingOpinions({});
    setCompletedMembers(new Set());

    // Show thinking indicator for all enabled members
    const activeMembers = councilMembers.filter((m) => !m.muted);
    const thinkingState: Record<string, string> = {};
    for (const member of activeMembers) thinkingState[member.name] = "…";
    setStreamingOpinions(thinkingState);

    // Subscribe to IPC events
    const unsubOpinion = onOpinion((data) => {
      if (data.round !== thisRound) return;
      const displayName = data.label || data.provider;
      setStreamingOpinions((prev) => ({ ...prev, [displayName]: data.text }));
      setMessageGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, opinions: { ...g.opinions, [displayName]: data.text } } : g
        )
      );
      setCompletedMembers((prev) => new Set(prev).add(displayName));
    });

    const unsubVerdict = onVerdict((data) => {
      if (data.round !== thisRound) return;
      setMessageGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, verdict: data.text } : g))
      );
    });

    const unsubDone = onDone(() => {
      const elapsed = Math.round(performance.now() - startTime);
      setMessageGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, isStreaming: false, latencyMs: elapsed } : g))
      );
      setIsStreaming(false);
      setCurrentGroupId(null);
      setStreamingOpinions({});
      setCompletedMembers(new Set());
      unsubOpinion();
      unsubVerdict();
      unsubDone();
    });

    try {
      await deliberate({ threadId: tid, message: text, round: thisRound });
    } catch (err) {
      // If not in Electron, fall back to mock for development
      unsubOpinion(); unsubVerdict(); unsubDone();
      const elapsed = Math.round(performance.now() - startTime);
      const mockOp: Record<string, string> = {};
      for (const member of activeMembers) {
        const pool = MOCK_OPINIONS[member.name] ?? MOCK_OPINIONS["The Pragmatist"];
        mockOp[member.name] = pool[Math.floor(Math.random() * pool.length)] ?? "No response.";
      }
      const verdict = VERDICTS[Math.floor(Math.random() * VERDICTS.length)];
      setMessageGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, opinions: mockOp, verdict, isStreaming: false, latencyMs: elapsed }
            : g
        )
      );
      setIsStreaming(false);
      setCurrentGroupId(null);
      setStreamingOpinions({});
      setCompletedMembers(new Set());
    }
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
    setCouncilMembers((prev) => [
      ...prev,
      { id: Date.now().toString(), ...member },
    ]);
    if (councilMembers.length >= 5) {
      setToast("Above 5 members — make sure you have API keys configured for all models");
    }
  };

  const removeMember = (id: string) => {
    setCouncilMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const updateMember = (id: string, field: keyof CouncilMember, value: string) => {
    setCouncilMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m))
    );
  };

  const handleExportChat = (format: "markdown" | "json" = "markdown") => {
    if (messageGroups.length === 0) {
      setToast("No messages to export");
      return;
    }
    if (format === "json") {
      const data = messageGroups.map((group) => ({
        userMessage: group.userMessage,
        opinions: group.opinions,
        verdict: group.verdict,
        tokens: group.tokens ?? null,
        cost: group.cost ?? null,
        latencyMs: group.latencyMs ?? null,
      }));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "council-deliberation.json";
      a.click();
      URL.revokeObjectURL(url);
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

  const handleShare = async () => {
    const lastGroup = messageGroups[messageGroups.length - 1];
    if (!lastGroup) {
      setToast("Nothing to share yet");
      return;
    }
    let shareText = `Council Deliberation: ${lastGroup.userMessage}\n\n`;
    for (const [memberName, opinion] of Object.entries(lastGroup.opinions)) {
      shareText += `${memberName}: ${opinion.slice(0, 200)}...\n\n`;
    }
    if (lastGroup.verdict) {
      shareText += `Verdict: ${lastGroup.verdict.slice(0, 300)}...`;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: "JUDICA Council Deliberation", text: shareText });
      } catch {
        // user cancelled or not supported
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      setToast("Copied to clipboard");
    }
  };

  const handleGlassToggle = () => {
    const next = !glassOn;
    setGlassOn(next);
    toggleGlass(next);
  };

  const handleAttachment = (type: string) => {
    if (type === "file") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".txt,.md,.pdf,.csv,.json";
      input.onchange = () => {
        if (input.files?.[0]) {
          setToast(`Attached: ${input.files[0].name}`);
        }
      };
      input.click();
    } else if (type === "image") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = () => {
        if (input.files?.[0]) {
          setToast(`Image attached: ${input.files[0].name}`);
        }
      };
      input.click();
    } else if (type === "audio") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".mp3,.wav,.m4a,.ogg,audio/*";
      input.onchange = () => {
        if (input.files?.[0]) {
          setToast(`Audio attached: ${input.files[0].name}`);
        }
      };
      input.click();
    } else if (type === "video") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".mp4,.webm,.mov,video/*";
      input.onchange = () => {
        if (input.files?.[0]) {
          setToast(`Video attached: ${input.files[0].name}`);
        }
      };
      input.click();
    } else if (type === "link") {
      const url = prompt("Enter a URL:");
      if (url?.trim()) {
        setToast(`Link attached: ${url.trim()}`);
      }
    } else {
      setToast(`${type} attachments not yet supported`);
    }
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
            setActiveThreadId(null);
            setRound(1);
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
          <div
            key={conv.id}
            className={`group/conv flex items-center border-b border-border/50 hover:bg-muted/50 transition-colors ${
              selectedConvId === conv.id ? "bg-muted" : ""
            }`}
          >
            <button
              onClick={() => {
                setSelectedConvId(conv.id);
                setMessageGroups([]);
                setStreamingOpinions({});
                if (layoutStage === 0) setMobileHistoryOpen(false);
              }}
              className="flex-1 text-left px-3 py-3 min-w-0"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">{conv.title}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 ml-5">
                <Badge variant="outline" className="text-[10px]">{conv.mode}</Badge>
                <span className="text-xs text-muted-foreground">{conv.date}</span>
              </div>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteThread(conv.id);
                setConversations((prev) => prev.filter((c) => c.id !== conv.id));
                if (selectedConvId === conv.id) {
                  setSelectedConvId(null);
                  setActiveThreadId(null);
                  setRound(1);
                  setMessageGroups([]);
                }
              }}
              className="px-2 opacity-0 group-hover/conv:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              title="Delete"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </ScrollArea>
    </>
  );

  // Build archetype options for member card dropdowns
  const allArchetypeOptions = [
    ...BUILT_IN_ARCHETYPES.map((a) => ({ name: a.name, description: a.description })),
    ...store.customArchetypes.map((a) => ({ name: a.name, description: a.description })),
  ];

  // ── Council Panel content
  const CouncilPanelContent = (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        {/* Quick Add Archetype */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-0.5">
            Quick Add
          </p>
          <div className="flex gap-1.5">
            <Select
              value=""
              onValueChange={(v) => {
                if (v === "__custom__") {
                  setCustomDialogOpen(true);
                  return;
                }
                const arch = [...BUILT_IN_ARCHETYPES, ...store.customArchetypes.map((a) => ({ name: a.name, description: a.description, model: a.model ?? "gpt-4o" }))].find((a) => a.name === v);
                if (arch) {
                  addArchetype(arch);
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder="Add archetype..." />
              </SelectTrigger>
              <SelectContent>
                {BUILT_IN_ARCHETYPES.map((a) => (
                  <SelectItem key={a.name} value={a.name} className="text-xs">
                    <div className="flex flex-col">
                      <span>{a.name}</span>
                      <span className="text-[10px] text-muted-foreground">{a.description}</span>
                    </div>
                  </SelectItem>
                ))}
                {store.customArchetypes.length > 0 && (
                  <>
                    {store.customArchetypes.map((a) => (
                      <SelectItem key={a.id} value={a.name} className="text-xs">
                        <div className="flex flex-col">
                          <span>{a.name}</span>
                          {a.description && <span className="text-[10px] text-muted-foreground">{a.description}</span>}
                        </div>
                      </SelectItem>
                    ))}
                  </>
                )}
                <SelectItem value="__custom__" className="text-xs">
                  <span className="flex items-center gap-1.5 text-primary">
                    <Plus className="size-3" />
                    Create Custom...
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        {/* Presets */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-0.5">
              Presets
            </p>
            <button
              className="text-[10px] text-primary hover:underline"
              onClick={saveCurrentAsPreset}
              disabled={councilMembers.length === 0}
            >
              <span className="flex items-center gap-1"><Save className="size-2.5" /> Save Current</span>
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {allPresets.map((preset) => (
              <div key={preset.id} className="group/preset flex items-center">
                <button
                  className="text-[10px] px-2 py-1 rounded-md border border-border bg-card hover:bg-muted transition-colors truncate max-w-[120px]"
                  onClick={() => loadPreset(preset)}
                  title={`Load: ${preset.members.map((m) => m.name).join(", ")}`}
                >
                  {preset.name}
                </button>
                {!BUILT_IN_PRESETS.some((b) => b.id === preset.id) && (
                  <button
                    className="size-4 flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover/preset:opacity-100 -ml-1"
                    onClick={() => deletePreset(preset.id)}
                    title="Delete preset"
                  >
                    <X className="size-2.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-1.5">
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
                  <Select
                    onValueChange={(v) => {
                      if (v === "__new_archetype__") {
                        setInlineArchTarget(member.id);
                        setInlineArchOpen(true);
                        return;
                      }
                      updateMember(member.id, "name", v);
                      const arch = BUILT_IN_ARCHETYPES.find((a) => a.name === v);
                      if (arch) updateMember(member.id, "model", arch.model);
                    }}
                    disabled={isStreaming}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {allArchetypeOptions.map((a) => (
                        <SelectItem key={a.name} value={a.name} className="text-xs">
                          {a.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new_archetype__" className="text-xs">
                        <span className="flex items-center gap-1.5 text-primary">
                          <Plus className="size-3" />
                          Create New Archetype...
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Phase 1.2 — per-member mute toggle */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`size-6 shrink-0 ${member.muted ? "text-amber-500 hover:text-amber-400" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setCouncilMembers(prev => prev.map(m => m.id === member.id ? { ...m, muted: !m.muted } : m))}
                    title={member.muted ? "Unmute member" : "Mute member"}
                    aria-label={member.muted ? `Unmute ${member.name}` : `Mute ${member.name}`}
                    aria-pressed={member.muted}
                  >
                    {member.muted ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
                  </Button>

                  {/* Per-member configure */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                        title="Configure member"
                        disabled={isStreaming}
                      >
                        <Settings2 className="size-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent side="left" align="start" className="w-64 p-3 space-y-3">
                      <p className="text-xs font-semibold">{member.name} — Options</p>

                      {/* Model */}
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Model</Label>
                        <Select
                          value={member.model}
                          onValueChange={(v) => {
                            if (v === "__new_model__") { setInlineModelTarget(member.id); setInlineModelOpen(true); return; }
                            updateMember(member.id, "model", v);
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {store.allModels.map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">{m.label}</SelectItem>
                            ))}
                            <SelectItem value="__new_model__" className="text-xs">
                              <span className="flex items-center gap-1.5 text-primary"><Plus className="size-3" />Add model…</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Deep Thinking */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium">Deep Thinking</p>
                          <p className="text-[10px] text-muted-foreground">Extended reasoning / o1 mode</p>
                        </div>
                        <Switch
                          checked={!!member.deepThinking}
                          onCheckedChange={(v) => setCouncilMembers(prev => prev.map(m => m.id === member.id ? { ...m, deepThinking: v } : m))}
                        />
                      </div>

                      {/* Web Search */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium">Web Search</p>
                          <p className="text-[10px] text-muted-foreground">Ground answers in live web results</p>
                        </div>
                        <Switch
                          checked={!!member.webSearch}
                          onCheckedChange={(v) => setCouncilMembers(prev => prev.map(m => m.id === member.id ? { ...m, webSearch: v } : m))}
                        />
                      </div>

                      {/* Mute shortcut */}
                      <div className="flex items-center justify-between border-t pt-2">
                        <div>
                          <p className="text-xs font-medium">Mute</p>
                          <p className="text-[10px] text-muted-foreground">Skip this member this round</p>
                        </div>
                        <Switch
                          checked={!!member.muted}
                          onCheckedChange={(v) => setCouncilMembers(prev => prev.map(m => m.id === member.id ? { ...m, muted: v } : m))}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>

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
                    if (v === "__new_model__") {
                      setInlineModelTarget(member.id);
                      setInlineModelOpen(true);
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
                    {store.allModels.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">
                        {m.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="__new_model__" className="text-xs">
                      <span className="flex items-center gap-1.5 text-primary">
                        <Plus className="size-3" />
                        Add New Model...
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {/* Active flags */}
                {(member.deepThinking || member.webSearch) && (
                  <div className="flex gap-1 pt-0.5">
                    {member.deepThinking && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium">Deep Thinking</span>
                    )}
                    {member.webSearch && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">Web Search</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-xs"
            onClick={() => setCustomDialogOpen(true)}
            disabled={isStreaming}
          >
            <Plus className="size-3" />
            Add Member
          </Button>

          {councilMembers.length > 5 && (
            <p className="text-[10px] text-amber-500 text-center">
              More than 5 members — ensure API keys are configured
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
          style={{ width: historyOpen ? 288 : 0, minWidth: historyOpen ? 288 : 0, transition: 'width 0.2s, min-width 0.2s' }}
          className="overflow-hidden border-r border-border flex flex-col bg-background shrink-0"
        >
          <div className="w-72 flex flex-col h-full">
            {HistoryPanelContent}
          </div>
        </div>
      )}

      {/* ── Center: Main Chat ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="border-b border-border px-3 py-2 flex items-center gap-1.5 shrink-0">
          {/* Left controls — always visible */}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={toggleSidebar}
            title={mainSidebarOpen ? "Hide sidebar" : "Show sidebar"}
          >
            <PanelLeft className={`size-4 transition-transform ${!mainSidebarOpen ? "text-primary" : ""}`} />
          </Button>
          <Button
            variant={historyOpen ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs shrink-0"
            onClick={toggleHistory}
            title={historyOpen ? "Hide history" : "Show history"}
          >
            {historyOpen ? <ChevronLeft className="size-3.5" /> : <Menu className="size-3.5" />}
            <span className="hidden sm:inline">History</span>
          </Button>

          {/* Title area — fills remaining space */}
          <div className="flex-1 flex items-center gap-2 min-w-0 px-1">
            <Sparkles className="size-4 text-primary shrink-0 hidden sm:block" />
            <span className="text-sm font-medium truncate">Council Deliberation</span>
          </div>

          {/* Right controls */}
          {/* Export — dropdown with format options */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 lg:w-auto lg:px-3 lg:gap-1.5 shrink-0"
                title="Export chat"
              >
                <Download className="size-3.5" />
                <span className="hidden lg:inline text-xs">Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExportChat("markdown")}>
                <FileText className="size-3.5 mr-2" />
                Export as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportChat("json")}>
                <Download className="size-3.5 mr-2" />
                Export as JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Share — icon always visible, text label on >=1024 */}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 lg:w-auto lg:px-3 lg:gap-1.5 shrink-0"
            onClick={handleShare}
            title="Share"
          >
            <Share2 className="size-3.5" />
            <span className="hidden lg:inline text-xs">Share</span>
          </Button>

          <Button
            variant={glassOn ? "secondary" : "ghost"}
            size="icon"
            className="size-8 lg:w-auto lg:px-3 lg:gap-1.5 shrink-0"
            onClick={handleGlassToggle}
            title="Glass mode — overlay on any window"
          >
            <Globe className="size-3.5" />
            <span className="hidden lg:inline text-xs">Glass</span>
          </Button>

          <Button
            variant={configOpen ? "secondary" : "outline"}
            size="sm"
            className="gap-1.5 h-8 text-xs shrink-0"
            onClick={toggleCouncil}
          >
            <Users className="size-3.5" />
            <span className="hidden sm:inline">Council</span>
            <Badge variant="outline" className="text-[10px] ml-0.5">{councilMembers.length}</Badge>
          </Button>
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
                            <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                              {group.tokens && group.cost && (
                                <span className="flex items-center gap-1">
                                  <Coins className="size-3" />
                                  {group.tokens} · {group.cost}
                                </span>
                              )}
                              {group.latencyMs != null && (
                                <span className="flex items-center gap-1">
                                  <Clock className="size-3" />
                                  {group.latencyMs < 1000
                                    ? `${group.latencyMs}ms`
                                    : `${(group.latencyMs / 1000).toFixed(1)}s`}
                                </span>
                              )}
                              <button
                                className="flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
                                onClick={() => handleSend(group.userMessage)}
                                disabled={isStreaming}
                                title="Retry this prompt"
                              >
                                <RotateCcw className="size-3" />
                                Retry
                              </button>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {/* Retry for stopped/incomplete groups */}
                      {!group.verdict && !group.isStreaming && (
                        <div className="ml-4 flex items-center gap-2">
                          <button
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => handleSend(group.userMessage)}
                            disabled={isStreaming}
                          >
                            <RotateCcw className="size-3" />
                            Retry
                          </button>
                          {group.latencyMs != null && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="size-3" />
                              {group.latencyMs < 1000
                                ? `${group.latencyMs}ms`
                                : `${(group.latencyMs / 1000).toFixed(1)}s`}
                              (stopped)
                            </span>
                          )}
                        </div>
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
                  <DropdownMenuItem onClick={() => handleAttachment("file")}>
                    <FileText className="size-3.5 mr-2" />
                    Upload File
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttachment("image")}>
                    <Image className="size-3.5 mr-2" />
                    Add Image
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttachment("audio")}>
                    <Video className="size-3.5 mr-2" />
                    Add Audio
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttachment("video")}>
                    <Video className="size-3.5 mr-2" />
                    Add Video
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAttachment("link")}>
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
                <Button
                  variant={deepResearch ? "secondary" : "ghost"}
                  size="icon"
                  className={`size-8 shrink-0 ${deepResearch ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setDeepResearch((v) => !v)}
                  title={deepResearch ? "Deep Research ON" : "Deep Research OFF"}
                  disabled={isStreaming}
                >
                  <Globe className="size-4" />
                </Button>
                {isStreaming ? (
                  <Button size="sm" variant="destructive" onClick={handleStop} className="gap-1.5">
                    <Square className="size-3" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => handleSend()}
                    disabled={!inputValue.trim() || councilMembers.length === 0}
                    className="gap-1.5"
                  >
                    <Send className="size-3.5" />
                    Send
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1">
              <p className="text-[10px] text-muted-foreground">
                {councilMembers.length} council member{councilMembers.length !== 1 ? "s" : ""} · Ctrl+Enter to send
              </p>
              {messageGroups.length > 0 && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <span className="flex items-center gap-0.5">
                    <Zap className="size-2.5" />
                    {messageGroups.filter((g) => g.tokens).length} responses
                  </span>
                  <span>
                    {messageGroups.reduce((sum, g) => {
                      const n = parseInt((g.tokens ?? "0").replace(/[^0-9]/g, ""), 10);
                      return sum + (isNaN(n) ? 0 : n);
                    }, 0).toLocaleString()} tokens
                  </span>
                  <span>
                    ${messageGroups.reduce((sum, g) => {
                      const n = parseFloat((g.cost ?? "0").replace("$", ""));
                      return sum + (isNaN(n) ? 0 : n);
                    }, 0).toFixed(2)}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: Council Config (desktop, stages 1+) ── */}
      {layoutStage >= 1 && (
        <div
          style={{ width: configOpen ? 320 : 0, minWidth: configOpen ? 320 : 0, transition: 'width 0.2s, min-width 0.2s' }}
          className="overflow-hidden border-l border-border flex flex-col bg-background shrink-0"
        >
          <div className="w-80 flex flex-col h-full">
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
      <AddMemberDialog
        open={customDialogOpen}
        onClose={() => setCustomDialogOpen(false)}
        onAdd={addCustomMember}
      />

      {/* Inline Create Archetype Dialog (from member card dropdown) */}
      <InlineArchetypeDialog
        open={inlineArchOpen}
        onClose={() => { setInlineArchOpen(false); setInlineArchTarget(null); }}
        onCreated={(name) => {
          if (inlineArchTarget) updateMember(inlineArchTarget, "name", name);
          setInlineArchOpen(false);
          setInlineArchTarget(null);
        }}
      />

      {/* Inline Add Model Dialog (from member card dropdown) */}
      <InlineModelDialog
        open={inlineModelOpen}
        onClose={() => { setInlineModelOpen(false); setInlineModelTarget(null); }}
        onCreated={(modelId) => {
          if (inlineModelTarget) updateMember(inlineModelTarget, "model", modelId);
          setInlineModelOpen(false);
          setInlineModelTarget(null);
        }}
      />

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
