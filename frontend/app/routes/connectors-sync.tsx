/**
 * Connector Sync Dashboard
 *
 * Full-page route wrapping ConnectorSyncPanel.
 * Lists all connectors, shows sync job history per connector,
 * and allows triggering/scheduling new syncs.
 */

import { useState, useEffect } from "react";
import { ConnectorSyncPanel } from "~/components/ConnectorSyncPanel";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Input } from "~/components/ui/input";
import {
  RefreshCw, Search, Plug, CheckCircle2, AlertCircle, Clock, Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Connector {
  id:           string;
  name:         string;
  source:       string;
  status:       "active" | "error" | "disabled" | "not_attempted";
  lastSyncAt?:  string;
  syncedDocs:   number;
  errorMsg?:    string;
}

// ── Connector status helpers ──────────────────────────────────────────────────

const STATUS_ICONS: Record<Connector["status"], React.ReactNode> = {
  active:        <CheckCircle2 className="size-3.5 text-green-400" />,
  error:         <AlertCircle  className="size-3.5 text-destructive" />,
  disabled:      <Clock        className="size-3.5 text-muted-foreground" />,
  not_attempted: <Clock        className="size-3.5 text-muted-foreground" />,
};

const STATUS_LABEL: Record<Connector["status"], string> = {
  active:        "Active",
  error:         "Error",
  disabled:      "Disabled",
  not_attempted: "Never synced",
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConnectorsSyncPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);

  const fetchConnectors = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/connectors?limit=100");
      if (!res.ok) throw new Error(`Failed to load connectors (${res.status})`);
      const data = await res.json();
      const list: Connector[] = (data.connectors ?? []).map((c: any) => ({
        id:          c.id,
        name:        c.name,
        source:      c.source ?? c.connectorType ?? "unknown",
        status:      c.status ?? "not_attempted",
        lastSyncAt:  c.lastSuccessfulIndexTime ?? c.lastSyncAt,
        syncedDocs:  c.totalDocCount ?? 0,
        errorMsg:    c.errorMsg,
      }));
      setConnectors(list);
      if (!selected && list.length > 0) setSelected(list[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
  };

  useEffect(() => { fetchConnectors(); }, []);

  const filtered = connectors.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.source.toLowerCase().includes(search.toLowerCase())
  );

  const selectedConnector = connectors.find((c) => c.id === selected);

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Left — connector list */}
      <aside
        className="w-72 shrink-0 flex flex-col border-r border-border"
        style={{ background: "hsl(var(--card))" }}
      >
        <div className="border-b border-border px-4 py-4 flex items-center gap-2">
          <Plug className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold flex-1">Connectors</h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={fetchConnectors}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter connectors…"
              className="pl-7 h-7 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          {loading && connectors.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="px-4 py-4 text-xs text-destructive">{error}</div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              {search ? "No matches" : "No connectors configured"}
            </p>
          ) : (
            <div className="p-2 space-y-0.5">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className="w-full flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors"
                  style={{
                    background:
                      selected === c.id
                        ? "hsl(var(--primary)/0.1)"
                        : "transparent",
                    border: `1px solid ${selected === c.id ? "hsl(var(--primary)/0.25)" : "transparent"}`,
                  }}
                >
                  <div className="mt-0.5 shrink-0">{STATUS_ICONS[c.status]}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{c.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground capitalize">{c.source}</span>
                      <Badge
                        variant="outline"
                        className="text-[10px] h-3.5 px-1 py-0"
                      >
                        {c.syncedDocs} docs
                      </Badge>
                    </div>
                    {c.lastSyncAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(c.lastSyncAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Stats footer */}
        <div
          className="border-t border-border px-4 py-2.5 flex justify-between text-[10px] text-muted-foreground"
        >
          <span>{connectors.filter((c) => c.status === "active").length} active</span>
          <span>{connectors.filter((c) => c.status === "error").length} errors</span>
          <span>{connectors.length} total</span>
        </div>
      </aside>

      {/* Right — sync panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border px-6 py-4 shrink-0 flex items-center gap-3">
          {selectedConnector ? (
            <>
              {STATUS_ICONS[selectedConnector.status]}
              <div>
                <h1 className="text-sm font-semibold">{selectedConnector.name}</h1>
                <p className="text-xs text-muted-foreground capitalize">
                  {selectedConnector.source} · {STATUS_LABEL[selectedConnector.status]}
                  {selectedConnector.syncedDocs > 0 && ` · ${selectedConnector.syncedDocs} docs`}
                </p>
              </div>
              {selectedConnector.errorMsg && (
                <div className="ml-4 text-xs text-destructive">{selectedConnector.errorMsg}</div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a connector to manage sync</p>
          )}
        </div>

        <div className="flex-1 overflow-auto p-6">
          {selected ? (
            <ConnectorSyncPanel connectorId={selected} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Plug className="size-12 text-muted-foreground/20" />
              <div>
                <p className="text-sm font-medium">No connector selected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Choose a connector from the left panel to view sync status and trigger syncs.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
