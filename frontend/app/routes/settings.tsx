import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { Settings, Shield, MessageSquare, Brain, Gauge, ChevronDown, Filter, AlignLeft, Users, Plus, Trash2, Globe, Key, Loader2, CheckCircle2 } from "lucide-react";
import {
  type CouncilMember,
  type MemberMode,
  API_PROVIDERS,
  loadCouncilMembers,
  saveCouncilMembers,
  newMember,
} from "~/lib/council";
import { connectProvider, isProviderConnected } from "~/lib/deliberate";

// ── Helpers ──────────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ── Council Member Row ────────────────────────────────────────────────────────

const BROWSER_CAPABLE = new Set(["chatgpt", "gemini", "claude"]);

function MemberRow({
  member,
  onChange,
  onRemove,
}: {
  member: CouncilMember;
  onChange: (m: CouncilMember) => void;
  onRemove?: () => void;
}) {
  const canBrowser = BROWSER_CAPABLE.has(member.id);
  const selectedProvider = API_PROVIDERS.find((p) => p.id === member.provider);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Check connection status when member is in browser mode
  useEffect(() => {
    if (!canBrowser || member.mode !== "browser") { setConnected(null); return; }
    isProviderConnected(member.id).then(setConnected);
  }, [member.id, member.mode, canBrowser]);

  const handleConnect = async () => {
    setConnecting(true);
    await connectProvider(member.id);
    // Re-check after window closes
    const status = await isProviderConnected(member.id);
    setConnected(status);
    setConnecting(false);
  };

  const handleModeChange = (mode: MemberMode) => {
    onChange({ ...member, mode });
  };

  const handleProviderChange = (providerId: string) => {
    const p = API_PROVIDERS.find((x) => x.id === providerId)!;
    onChange({
      ...member,
      provider: providerId,
      model: p.defaultModel,
      baseUrl: p.defaultBaseUrl,
    });
  };

  return (
    <div className={`rounded-lg border p-4 space-y-3 transition-opacity ${member.enabled ? "" : "opacity-50"}`}>
      {/* Header row */}
      <div className="flex items-center gap-3">
        <Switch
          checked={member.enabled}
          onCheckedChange={(v) => onChange({ ...member, enabled: v })}
        />
        <Input
          className="h-7 text-sm font-medium w-32 px-2"
          value={member.label}
          onChange={(e) => onChange({ ...member, label: e.target.value })}
        />

        {/* Mode toggle — browser only for chatgpt/gemini/claude */}
        <div className="flex items-center rounded-md border overflow-hidden text-xs ml-auto">
          {canBrowser && (
            <button
              className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                member.mode === "browser"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => handleModeChange("browser")}
            >
              <Globe className="size-3" />
              Browser
            </button>
          )}
          <button
            className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
              member.mode === "api"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => handleModeChange("api")}
          >
            <Key className="size-3" />
            API
          </button>
        </div>

        {onRemove && (
          <button
            onClick={onRemove}
            className="text-muted-foreground hover:text-destructive transition-colors ml-1"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {/* Browser mode — show connection status + Connect button */}
      {canBrowser && member.mode === "browser" && (
        <div className="flex items-center gap-3 pl-9">
          <div className="flex items-center gap-1.5 text-xs">
            {connected === null ? (
              <span className="size-2 rounded-full bg-muted-foreground/40 inline-block" />
            ) : connected ? (
              <CheckCircle2 className="size-3.5 text-green-500" />
            ) : (
              <span className="size-2 rounded-full bg-amber-400 inline-block" />
            )}
            <span className="text-muted-foreground">
              {connected === null ? "Checking…" : connected ? "Connected" : "Not signed in"}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? (
              <><Loader2 className="size-3 animate-spin" /> Opening…</>
            ) : (
              <><Globe className="size-3" /> {connected ? "Re-connect" : "Connect account"}</>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">
            Sign in with your existing {member.label} subscription
          </span>
        </div>
      )}

      {/* API config — visible when mode is api */}
      {member.mode === "api" && (
        <div className="grid grid-cols-2 gap-2 pl-9">
          {/* Provider */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Provider</Label>
            <Select value={member.provider} onValueChange={handleProviderChange}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Model</Label>
            <Input
              className="h-7 text-xs"
              placeholder="model name"
              value={member.model}
              onChange={(e) => onChange({ ...member, model: e.target.value })}
            />
          </div>

          {/* API Key — hidden for Ollama */}
          {selectedProvider?.needsKey !== false && (
            <div className="space-y-1 col-span-2">
              <Label className="text-xs text-muted-foreground">API Key</Label>
              <Input
                className="h-7 text-xs font-mono"
                type="password"
                placeholder="sk-..."
                value={member.apiKey}
                onChange={(e) => onChange({ ...member, apiKey: e.target.value })}
              />
            </div>
          )}

          {/* Base URL — shown for ollama and custom */}
          {(member.provider === "ollama" || member.provider === "custom") && (
            <div className="space-y-1 col-span-2">
              <Label className="text-xs text-muted-foreground">Base URL</Label>
              <Input
                className="h-7 text-xs font-mono"
                placeholder="http://localhost:11434/v1"
                value={member.baseUrl}
                onChange={(e) => onChange({ ...member, baseUrl: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [members, setMembers] = useState<CouncilMember[]>(loadCouncilMembers);
  const [councilSaved, setCouncilSaved] = useState(false);

  const updateMember = (id: string, updated: CouncilMember) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? updated : m)));
  };

  const removeMember = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const addMember = () => {
    setMembers((prev) => [...prev, newMember()]);
  };

  const saveCouncil = () => {
    saveCouncilMembers(members);
    // Sync to electron main if running in desktop
    if (typeof window !== "undefined" && (window as any).molecule) {
      (window as any).molecule.setCouncilMembers(members);
    }
    setCouncilSaved(true);
    setTimeout(() => setCouncilSaved(false), 2000);
  };

  const [autoCouncil, setAutoCouncil] = useState(true);
  const [debateRound, setDebateRound] = useState(true);
  const [coldValidator, setColdValidator] = useState(false);
  const [piiDetection, setPiiDetection] = useState(true);
  const [autoAnonymize, setAutoAnonymize] = useState(false);
  const [blockProfanity, setBlockProfanity] = useState(false);
  const [blockAdultContent, setBlockAdultContent] = useState(false);
  const [verbosityLevel, setVerbosityLevel] = useState("standard");
  const [deliberationMode, setDeliberationMode] = useState("standard");
  const [enableStreaming, setEnableStreaming] = useState(true);
  const [quotasOpen, setQuotasOpen] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure your council members and deliberation preferences
            </p>
          </div>
        </div>

        {/* Council Members */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" />
              Council Members
            </CardTitle>
            <CardDescription>
              Toggle members on/off. Switch between <strong>Browser</strong> (uses your existing subscription — no API key) or <strong>API</strong> (uses a key you provide). Mix and match freely.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                onChange={(updated) => updateMember(m.id, updated)}
                onRemove={BROWSER_CAPABLE.has(m.id) ? undefined : () => removeMember(m.id)}
              />
            ))}

            <button
              onClick={addMember}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              <Plus className="size-4" />
              Add member
            </button>

            <Button onClick={saveCouncil} size="sm" className="mt-1">
              {councilSaved ? "Saved ✓" : "Save Council"}
            </Button>
          </CardContent>
        </Card>

        {/* Council Behaviour */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="size-4" />
              Council Behaviour
            </CardTitle>
            <CardDescription>
              Control how the council deliberates
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <ToggleRow
              label="Auto-Council Mode"
              description="Automatically select optimal members for each query"
              checked={autoCouncil}
              onCheckedChange={setAutoCouncil}
            />
            <ToggleRow
              label="Enable Debate Round"
              description="Enable multi-round deliberation between members"
              checked={debateRound}
              onCheckedChange={setDebateRound}
            />
            <ToggleRow
              label="Cold Validator"
              description="Add a critical validator pass after consensus"
              checked={coldValidator}
              onCheckedChange={setColdValidator}
            />
          </CardContent>
        </Card>

        {/* Chat Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              Chat Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 divide-y divide-border">
            <div className="flex items-center justify-between py-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Default Deliberation Mode</Label>
                <p className="text-sm text-muted-foreground">Reasoning strategy for council sessions</p>
              </div>
              <Select value={deliberationMode} onValueChange={setDeliberationMode}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="socratic">Socratic</SelectItem>
                  <SelectItem value="red_blue">Red/Blue Team</SelectItem>
                  <SelectItem value="hypothesis">Hypothesis</SelectItem>
                  <SelectItem value="confidence">Confidence</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ToggleRow
              label="Enable Streaming"
              description="Stream member responses as they are generated"
              checked={enableStreaming}
              onCheckedChange={setEnableStreaming}
            />
            <div className="flex items-center justify-between py-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <AlignLeft className="size-3.5" />
                  Response Verbosity
                </Label>
                <p className="text-sm text-muted-foreground">Depth and length of AI responses</p>
              </div>
              <Select value={verbosityLevel} onValueChange={setVerbosityLevel}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="concise">Concise — 2–3 sentences</SelectItem>
                  <SelectItem value="standard">Standard — balanced</SelectItem>
                  <SelectItem value="detailed">Detailed — structured</SelectItem>
                  <SelectItem value="exhaustive">Exhaustive — comprehensive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Privacy & Safety */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="size-4" />
              Privacy &amp; Safety
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <ToggleRow
              label="PII Detection"
              description="Scan messages for personally identifiable information"
              checked={piiDetection}
              onCheckedChange={setPiiDetection}
            />
            <ToggleRow
              label="Auto-anonymize High Risk"
              description="Automatically redact detected PII before sending"
              checked={autoAnonymize}
              onCheckedChange={setAutoAnonymize}
            />
          </CardContent>
        </Card>

        {/* Content Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="size-4" />
              Content Filters
            </CardTitle>
            <CardDescription>
              Both filters are <strong>off by default</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <ToggleRow
              label="Block Profanity"
              description="Redact profanity from input and AI responses."
              checked={blockProfanity}
              onCheckedChange={setBlockProfanity}
            />
            <ToggleRow
              label="Block Adult / Explicit Content"
              description="Block adult or sexually explicit content in input and output."
              checked={blockAdultContent}
              onCheckedChange={setBlockAdultContent}
            />
          </CardContent>
        </Card>

        {/* Quotas */}
        <Collapsible open={quotasOpen} onOpenChange={setQuotasOpen}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="size-4" />
                    Quotas &amp; Limits
                  </CardTitle>
                  <ChevronDown className={`size-4 text-muted-foreground transition-transform ${quotasOpen ? "rotate-180" : ""}`} />
                </div>
                <CardDescription>View current usage against daily limits</CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Daily Requests</span>
                    <span className="text-muted-foreground">23 / 100</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: "23%" }} />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Daily Tokens</span>
                    <span className="text-muted-foreground">247,562 / 1,000,000</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: "24.7%" }} />
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>
    </div>
  );
}
