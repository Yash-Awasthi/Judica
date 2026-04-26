import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
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
import { Settings, Shield, MessageSquare, Brain, Gauge, ChevronDown, Filter, AlignLeft } from "lucide-react";

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

export default function SettingsPage() {
  const [autoCouncil, setAutoCouncil] = useState(true);
  const [debateRound, setDebateRound] = useState(true);
  const [coldValidator, setColdValidator] = useState(false);
  const [piiDetection, setPiiDetection] = useState(true);
  const [autoAnonymize, setAutoAnonymize] = useState(false);
  // Phase 1.1 — content filter toggles (LLM Guard scanner pattern; off by default)
  const [blockProfanity, setBlockProfanity] = useState(false);
  const [blockAdultContent, setBlockAdultContent] = useState(false);
  // Phase 1.24 — response verbosity control
  const [verbosityLevel, setVerbosityLevel] = useState("standard");
  const [deliberationMode, setDeliberationMode] = useState("standard");
  const [enableStreaming, setEnableStreaming] = useState(true);
  const [showCost, setShowCost] = useState(true);
  const [memoryBackend, setMemoryBackend] = useState("local");
  const [quotasOpen, setQuotasOpen] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure your AI council preferences and system behavior
            </p>
          </div>
        </div>

        {/* Council Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="size-4" />
              Council Preferences
            </CardTitle>
            <CardDescription>
              Control how the AI council deliberates on your queries
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <ToggleRow
              label="Auto-Council Mode"
              description="Automatically select optimal archetypes for each query"
              checked={autoCouncil}
              onCheckedChange={setAutoCouncil}
            />
            <ToggleRow
              label="Enable Debate Round"
              description="Enable multi-round deliberation between archetypes"
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

        {/* Privacy & Safety */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="size-4" />
              Privacy &amp; Safety
            </CardTitle>
            <CardDescription>
              Manage data protection and safety guardrails
            </CardDescription>
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
              description="Automatically redact detected PII before sending to providers"
              checked={autoAnonymize}
              onCheckedChange={setAutoAnonymize}
            />
          </CardContent>
        </Card>

        {/* Phase 1.1 — Content Filters (LLM Guard scanner pattern) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="size-4" />
              Content Filters
            </CardTitle>
            <CardDescription>
              Applied as a scanner layer before input reaches models and after output returns.
              Both filters are <strong>off by default</strong> — toggling on stores your preference per account.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <ToggleRow
              label="Block Profanity"
              description="Redact profanity from your input and AI responses using a pattern scanner."
              checked={blockProfanity}
              onCheckedChange={setBlockProfanity}
            />
            <ToggleRow
              label="Block Adult / Explicit Content"
              description="Block adult or sexually explicit content in input and output. Off by default."
              checked={blockAdultContent}
              onCheckedChange={setBlockAdultContent}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              Chat Preferences
            </CardTitle>
            <CardDescription>
              Customize your chat experience and display options
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-0 divide-y divide-border">
            <div className="flex items-center justify-between py-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Default Deliberation Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Choose the default reasoning strategy for council sessions
                </p>
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
              description="Stream archetype responses as they are generated"
              checked={enableStreaming}
              onCheckedChange={setEnableStreaming}
            />
            <ToggleRow
              label="Show Cost Per Message"
              description="Display estimated token cost alongside each response"
              checked={showCost}
              onCheckedChange={setShowCost}
            />
            {/* Phase 1.24 — Response Verbosity Control */}
            <div className="flex items-center justify-between py-4">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <AlignLeft className="size-3.5" />
                  Response Verbosity
                </Label>
                <p className="text-sm text-muted-foreground">
                  Control the depth and length of AI responses
                </p>
              </div>
              <Select value={verbosityLevel} onValueChange={setVerbosityLevel}>
                <SelectTrigger className="w-44" aria-label="Response verbosity level">
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

        {/* Memory Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="size-4" />
              Memory Configuration
            </CardTitle>
            <CardDescription>
              Manage long-term memory storage and retrieval
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Memory Backend</Label>
                <p className="text-sm text-muted-foreground">
                  Select the storage engine for memory chunks
                </p>
              </div>
              <Select value={memoryBackend} onValueChange={setMemoryBackend}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="qdrant">Qdrant</SelectItem>
                  <SelectItem value="getzep">GetZep</SelectItem>
                  <SelectItem value="google_drive">Google Drive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              1,247 chunks &bull; ~4.8 MB estimated
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                Compact Memory
              </Button>
              <Button variant="destructive" size="sm">
                Clear All Memory
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quotas & Limits */}
        <Collapsible open={quotasOpen} onOpenChange={setQuotasOpen}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="size-4" />
                    Quotas &amp; Limits
                  </CardTitle>
                  <ChevronDown
                    className={`size-4 text-muted-foreground transition-transform ${
                      quotasOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
                <CardDescription>
                  View your current usage against daily limits
                </CardDescription>
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
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: "23%" }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Daily Tokens</span>
                    <span className="text-muted-foreground">247,562 / 1,000,000</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: "24.7%" }}
                    />
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
