import { useState } from "react";
import {
  AVAILABLE_PROVIDERS,
  INITIAL_CONNECTED_PROVIDERS,
  type ConnectedProvider,
  type Provider,
} from "~/lib/mock-data";
import { cn } from "~/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Brain,
  Settings,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
  Cpu,
  Sparkles,
  Zap,
  Globe,
  Server,
  Router,
  Wind,
  CircuitBoard,
  MessageSquare,
  Wrench,
  Check,
} from "lucide-react";

const PROVIDER_ICONS: Record<string, React.ReactNode> = {
  openai: <Sparkles className="size-5" />,
  anthropic: <Brain className="size-5" />,
  google: <Globe className="size-5" />,
  groq: <Zap className="size-5" />,
  ollama: <Server className="size-5" />,
  openrouter: <Router className="size-5" />,
  mistral: <Wind className="size-5" />,
  cerebras: <CircuitBoard className="size-5" />,
  cohere: <MessageSquare className="size-5" />,
  custom: <Wrench className="size-5" />,
};

function getProviderIcon(iconKey: string) {
  return PROVIDER_ICONS[iconKey] ?? <Cpu className="size-5" />;
}

export default function LanguageModelsPage() {
  const [connectedProviders, setConnectedProviders] = useState<ConnectedProvider[]>(
    INITIAL_CONNECTED_PROVIDERS
  );
  const [defaultModel, setDefaultModel] = useState("gpt-4o");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [editingConnection, setEditingConnection] = useState<ConnectedProvider | null>(null);

  // Form state
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formEnabledModels, setFormEnabledModels] = useState<string[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const availableToConnect = AVAILABLE_PROVIDERS.filter(
    (p) => !connectedProviders.some((cp) => cp.providerId === p.id)
  );

  function openConnectDialog(provider: Provider) {
    setEditingProvider(provider);
    setEditingConnection(null);
    setFormDisplayName(provider.name);
    setFormApiKey("");
    setFormBaseUrl(provider.id === "ollama" ? "http://localhost:11434" : "");
    setFormEnabledModels(provider.models.map((m) => m.id));
    setShowApiKey(false);
    setIsTesting(false);
    setTestResult(null);
    setDialogOpen(true);
  }

  function openEditDialog(connection: ConnectedProvider) {
    const provider = AVAILABLE_PROVIDERS.find((p) => p.id === connection.providerId);
    if (!provider) return;
    setEditingProvider(provider);
    setEditingConnection(connection);
    setFormDisplayName(connection.displayName);
    setFormApiKey(connection.apiKey);
    setFormBaseUrl(connection.baseUrl ?? "");
    setFormEnabledModels([...connection.enabledModels]);
    setShowApiKey(false);
    setIsTesting(false);
    setTestResult(null);
    setDialogOpen(true);
  }

  function handleTestConnection() {
    setIsTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setIsTesting(false);
      setTestResult("success");
    }, 1000);
  }

  function handleSave() {
    if (!editingProvider) return;
    setIsSaving(true);
    setTimeout(() => {
      if (editingConnection) {
        setConnectedProviders((prev) =>
          prev.map((cp) =>
            cp.id === editingConnection.id
              ? {
                  ...cp,
                  displayName: formDisplayName,
                  apiKey: formApiKey,
                  baseUrl: formBaseUrl || undefined,
                  enabledModels: formEnabledModels,
                }
              : cp
          )
        );
      } else {
        const newConnection: ConnectedProvider = {
          id: `conn-${editingProvider.id}-${Date.now()}`,
          providerId: editingProvider.id,
          displayName: formDisplayName,
          apiKey: formApiKey,
          baseUrl: formBaseUrl || undefined,
          enabledModels: formEnabledModels,
          isDefault: connectedProviders.length === 0,
        };
        setConnectedProviders((prev) => [...prev, newConnection]);
      }
      setIsSaving(false);
      setDialogOpen(false);
    }, 500);
  }

  function handleDelete(connectionId: string) {
    setConnectedProviders((prev) => prev.filter((cp) => cp.id !== connectionId));
  }

  function toggleModel(modelId: string) {
    setFormEnabledModels((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  }

  function selectAllModels() {
    if (!editingProvider) return;
    setFormEnabledModels(editingProvider.models.map((m) => m.id));
  }

  function deselectAllModels() {
    setFormEnabledModels([]);
  }

  // Build grouped models for default model select
  const groupedModels = connectedProviders.map((cp) => {
    const provider = AVAILABLE_PROVIDERS.find((p) => p.id === cp.providerId);
    return {
      providerName: cp.displayName,
      models: provider?.models.filter((m) => cp.enabledModels.includes(m.id)) ?? [],
    };
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {/* Page Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-lg bg-primary/10">
              <Cpu className="size-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Language Models</h1>
              <p className="text-sm text-muted-foreground">
                Configure AI providers and API keys for the council
              </p>
            </div>
          </div>
        </div>

        {/* Default Model */}
        <Card>
          <CardHeader>
            <CardTitle>Default Model</CardTitle>
            <CardDescription>
              Select the default language model used across the council
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger className="w-full max-w-sm">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {groupedModels.map((group) => (
                  <SelectGroup key={group.providerName}>
                    <SelectLabel>{group.providerName}</SelectLabel>
                    {group.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Configured Providers */}
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-medium">Configured Providers</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Providers currently connected and available for use
            </p>
          </div>
          {connectedProviders.length === 0 ? (
            <Card>
              <CardContent className="py-8">
                <p className="text-center text-sm text-muted-foreground">
                  No providers configured yet. Add a provider below to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {connectedProviders.map((cp) => {
                const provider = AVAILABLE_PROVIDERS.find((p) => p.id === cp.providerId);
                return (
                  <Card key={cp.id} className="group/card">
                    <CardContent className="py-0">
                      <div className="flex items-center gap-3 py-3">
                        <div className="flex items-center justify-center size-9 rounded-lg bg-muted">
                          {provider && getProviderIcon(provider.icon)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{cp.displayName}</span>
                            {cp.isDefault && <Badge variant="secondary">Default</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {cp.enabledModels.length} model{cp.enabledModels.length !== 1 ? "s" : ""}{" "}
                            enabled
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEditDialog(cp)}
                          >
                            <Settings className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="opacity-0 group-hover/card:opacity-100 transition-opacity text-destructive hover:text-destructive"
                            onClick={() => handleDelete(cp.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Add a Provider */}
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-medium">Add a Provider</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect a new AI provider to expand available models
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {availableToConnect.map((provider) => (
              <Card key={provider.id}>
                <CardContent className="py-0">
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex items-center justify-center size-9 rounded-lg bg-muted">
                      {getProviderIcon(provider.icon)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{provider.name}</p>
                      <p className="text-xs text-muted-foreground">{provider.description}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openConnectDialog(provider)}
                    >
                      <Plus className="size-3 mr-1" />
                      Connect
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Provider Configuration Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {editingProvider && getProviderIcon(editingProvider.icon)}
                {editingConnection ? `Edit ${editingProvider?.name}` : `Connect ${editingProvider?.name}`}
              </DialogTitle>
              <DialogDescription>
                {editingConnection
                  ? "Update your provider configuration"
                  : `Configure your ${editingProvider?.name} connection`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Display Name */}
              <div className="space-y-1.5">
                <Label htmlFor="display-name">Display Name</Label>
                <Input
                  id="display-name"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  placeholder="Provider display name"
                />
              </div>

              {/* API Key */}
              {editingProvider?.id !== "ollama" && (
                <div className="space-y-1.5">
                  <Label htmlFor="api-key">API Key</Label>
                  <div className="relative">
                    <Input
                      id="api-key"
                      type={showApiKey ? "text" : "password"}
                      value={formApiKey}
                      onChange={(e) => setFormApiKey(e.target.value)}
                      placeholder={editingProvider?.apiKeyPlaceholder ?? "Enter your API key"}
                      className="pr-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setShowApiKey(!showApiKey)}
                    >
                      {showApiKey ? (
                        <EyeOff className="size-3" />
                      ) : (
                        <Eye className="size-3" />
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Base URL */}
              {(editingProvider?.supportsBaseUrl ||
                editingProvider?.id === "custom" ||
                editingProvider?.id === "ollama") && (
                <div className="space-y-1.5">
                  <Label htmlFor="base-url">Base URL</Label>
                  <Input
                    id="base-url"
                    value={formBaseUrl}
                    onChange={(e) => setFormBaseUrl(e.target.value)}
                    placeholder={
                      editingProvider?.id === "ollama"
                        ? "http://localhost:11434"
                        : "https://api.example.com/v1"
                    }
                  />
                </div>
              )}

              {/* Models */}
              {editingProvider && editingProvider.models.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Models</Label>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="xs" onClick={selectAllModels}>
                        Select All
                      </Button>
                      <Button variant="ghost" size="xs" onClick={deselectAllModels}>
                        Deselect All
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2 space-y-0.5 max-h-48 overflow-y-auto">
                    {editingProvider.models.map((model) => {
                      const isEnabled = formEnabledModels.includes(model.id);
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => toggleModel(model.id)}
                          className={cn(
                            "flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                            isEnabled && "bg-muted/50"
                          )}
                        >
                          <div
                            className={cn(
                              "flex items-center justify-center size-4 rounded border transition-colors",
                              isEnabled
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground/30"
                            )}
                          >
                            {isEnabled && <Check className="size-3" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium">{model.name}</span>
                            {model.description && (
                              <span className="text-xs text-muted-foreground ml-2">
                                {model.description}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Test Connection */}
              <Separator />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                >
                  {isTesting ? (
                    <Loader2 className="size-3 mr-1 animate-spin" />
                  ) : testResult === "success" ? (
                    <CheckCircle2 className="size-3 mr-1 text-green-500" />
                  ) : null}
                  {isTesting
                    ? "Testing..."
                    : testResult === "success"
                      ? "Connected"
                      : "Test Connection"}
                </Button>
                {testResult === "success" && (
                  <span className="text-xs text-green-500">Connection successful</span>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="size-3 mr-1 animate-spin" />}
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
