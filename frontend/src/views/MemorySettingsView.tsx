import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Database, HardDrive, Trash2, Zap, RefreshCw } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter } from "../components/AnimatedCounter";

interface BackendInfo {
  type: string;
  url?: string;
  collectionName?: string;
  hasApiKey?: boolean;
  active: boolean;
}

interface MemoryStats {
  chunkCount: number;
  estimatedStorageMB: number;
}

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.08 } } },
  item: { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } },
};

export function MemorySettingsView() {
  const { fetchWithAuth } = useAuth();

  const [backend, setBackend] = useState<BackendInfo>({ type: "local", active: true });
  const [stats, setStats] = useState<MemoryStats>({ chunkCount: 0, estimatedStorageMB: 0 });
  const [selectedType, setSelectedType] = useState("local");
  const [configUrl, setConfigUrl] = useState("");
  const [configApiKey, setConfigApiKey] = useState("");
  const [configCollection, setConfigCollection] = useState("");
  const [saving, setSaving] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<{ originalCount: number; compactedCount: number } | null>(null);

  const loadBackend = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/memory/backend");
      if (res.ok) {
        const data = await res.json();
        setBackend(data);
        setSelectedType(data.type);
        setConfigUrl(data.url || "");
        setConfigCollection(data.collectionName || "");
      }
    } catch (err) {
      console.error("Failed to load backend", err);
    }
  }, [fetchWithAuth]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/memory/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to load stats", err);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadBackend(); loadStats(); }, [loadBackend, loadStats]);

  const handleSaveBackend = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { type: selectedType };
      if (selectedType !== "local") {
        body.config = {
          url: configUrl || undefined,
          apiKey: configApiKey || undefined,
          collectionName: configCollection || undefined,
        };
      }
      const res = await fetchWithAuth("/api/memory/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        loadBackend();
      }
    } catch (err) {
      console.error("Save failed", err);
    } finally {
      setSaving(false);
    }
  };

  const handleCompact = async () => {
    setCompacting(true);
    setCompactResult(null);
    try {
      const res = await fetchWithAuth("/api/memory/compact", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setCompactResult(data);
        loadStats();
      }
    } catch (err) {
      console.error("Compact failed", err);
    } finally {
      setCompacting(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("This will permanently delete ALL your memory chunks. Are you sure?")) return;
    if (!confirm("This action cannot be undone. Type 'DELETE' in the next prompt to confirm.")) return;

    try {
      await fetchWithAuth("/api/memory/all", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE_ALL_MEMORY" }),
      });
      loadStats();
    } catch (err) {
      console.error("Clear failed", err);
    }
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-custom p-6">
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="max-w-3xl mx-auto space-y-6"
      >
        <motion.div variants={stagger.item}>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Memory Settings</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Configure how your AI agents store and retrieve long-term memory</p>
        </motion.div>

        {/* Stats */}
        <motion.div variants={stagger.item} className="surface-card p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Database size={16} className="text-[var(--accent-mint)]" /> Memory Statistics
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="glass-panel rounded-card p-4">
              <div className="text-2xl font-bold text-[var(--accent-blue)]">
                <AnimatedCounter value={stats.chunkCount} />
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Memory Chunks</div>
            </div>
            <div className="glass-panel rounded-card p-4">
              <div className="text-2xl font-bold text-[var(--accent-mint)]">{stats.estimatedStorageMB} MB</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Estimated Storage</div>
            </div>
          </div>
        </motion.div>

        {/* Backend Selector */}
        <motion.div variants={stagger.item} className="surface-card p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <HardDrive size={16} className="text-[var(--accent-blue)]" /> Memory Backend
          </h2>
          <div className="mb-4">
            <div className="text-xs text-[var(--text-secondary)] mb-2">
              Current: <span className="font-semibold text-[var(--text-primary)]">{backend.type}</span>
              {backend.active && (
                <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-pill bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)]">Active</span>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Backend Type</label>
              <select className="input-base" value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                <option value="local">Local (pgvector) - Default</option>
                <option value="qdrant">Qdrant</option>
                <option value="getzep">GetZep</option>
                <option value="google_drive">Google Drive</option>
              </select>
            </div>

            {selectedType !== "local" && (
              <>
                <div>
                  <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">URL</label>
                  <input
                    className="input-base"
                    value={configUrl}
                    onChange={(e) => setConfigUrl(e.target.value)}
                    placeholder={selectedType === "qdrant" ? "http://localhost:6333" : "https://..."}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">API Key</label>
                  <input
                    type="password"
                    className="input-base"
                    value={configApiKey}
                    onChange={(e) => setConfigApiKey(e.target.value)}
                    placeholder={backend.hasApiKey ? "••••••• (already set)" : "Enter API key"}
                  />
                </div>
                {selectedType === "qdrant" && (
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Collection Name</label>
                    <input className="input-base" value={configCollection} onChange={(e) => setConfigCollection(e.target.value)} placeholder="my_collection" />
                  </div>
                )}
              </>
            )}

            <button onClick={handleSaveBackend} disabled={saving} className="btn-pill-primary text-sm px-4 py-2 disabled:opacity-50">
              {saving ? "Saving..." : "Save Backend"}
            </button>
          </div>
        </motion.div>

        {/* Actions */}
        <motion.div variants={stagger.item} className="surface-card p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Zap size={16} className="text-[var(--accent-gold)]" /> Actions
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 glass-panel rounded-card">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Compact Memory</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">Merge similar old memories to save space</div>
              </div>
              <button
                onClick={handleCompact}
                disabled={compacting}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-button bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)] hover:bg-[rgba(110,231,183,0.15)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={compacting ? "animate-spin" : ""} />
                {compacting ? "Compacting..." : "Compact"}
              </button>
            </div>

            {compactResult && (
              <div className="p-3 rounded-card bg-[rgba(110,231,183,0.06)] border border-[rgba(110,231,183,0.12)] text-sm text-[var(--accent-mint)]">
                Compacted {compactResult.originalCount} chunks into {compactResult.compactedCount} groups
              </div>
            )}

            <div className="flex items-center justify-between p-4 rounded-card border border-red-400/15 bg-red-400/5">
              <div>
                <div className="text-sm font-semibold text-red-400">Clear All Memory</div>
                <div className="text-xs text-red-400/60 mt-0.5">Permanently delete all memory chunks</div>
              </div>
              <button
                onClick={handleClearAll}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-button bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                <Trash2 size={14} /> Clear All
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
