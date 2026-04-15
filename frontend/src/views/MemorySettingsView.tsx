import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Cpu, Activity, ShieldAlert, Terminal, Layers } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter } from "../components/AnimatedCounter";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import { StatsHUD } from "../components/StatsHUD";

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
  const [stats, setStats] = useState<MemoryStats>({ chunkCount: 0, estimatedStorageMB: 0 });
  const [backend, setBackend] = useState<BackendInfo>({ type: "local", active: true });
  const [selectedType, setSelectedType] = useState("local");
  const [configUrl, setConfigUrl] = useState("");
  const [configApiKey, setConfigApiKey] = useState("");
  const [configCollection, setConfigCollection] = useState("");
  const [saving, setSaving] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<{ originalCount: number; compactedCount: number } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [sRes, bRes] = await Promise.all([
        fetchWithAuth("/api/memory/stats"),
        fetchWithAuth("/api/memory/backend")
      ]);
      if (sRes.ok) setStats((await sRes.json()).data);
      if (bRes.ok) {
        const b = (await bRes.json()).data;
        setBackend(b);
        setSelectedType(b.type);
        setConfigUrl(b.url || "");
        setConfigCollection(b.collectionName || "");
      }
    } catch (err) {
      console.error("Failed to load memory settings", err);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveBackend = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/memory/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selectedType,
          url: configUrl,
          apiKey: configApiKey,
          collectionName: configCollection
        })
      });
      if (res.ok) {
        setConfigApiKey("");
        loadData();
      }
    } catch (err) {
      console.error("Failed to save backend", err);
    } finally {
      setSaving(false);
    }
  };

  const handleCompact = async () => {
    setCompacting(true);
    try {
      const res = await fetchWithAuth("/api/memory/compact", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()).data;
        setCompactResult(data);
        loadData();
      }
    } catch (err) {
      console.error("Failed to compact memory", err);
    } finally {
      setCompacting(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Are you ABSOLUTELY sure? This will delete all memory records.")) return;
    try {
      const res = await fetchWithAuth("/api/memory", { method: "DELETE" });
      if (res.ok) loadData();
    } catch (err) {
      console.error("Failed to clear memory", err);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#000000] overflow-hidden">
      <TechnicalGrid />

      <div className="relative z-10 h-full overflow-y-auto scrollbar-custom p-4 lg:p-8">

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-7xl mx-auto space-y-12 pb-24"
        >
          {/* Sector Header */}
          <SectorHUD
            sectorId="MEM-09"
            title="Neural_Deep_Storage"
            subtitle="Synaptic Persistence // Vector Database Orchestration"
            accentColor="var(--accent-blue)"
            telemetry={[
              { label: "MEMORY_NODES", value: stats.chunkCount.toString(), status: "online" },
              { label: "STORAGE_IMPRINT", value: `${stats.estimatedStorageMB} MB`, status: "optimal" },
              { label: "UPLINK", value: "SECURE", status: "optimal" }
            ]}
          />

          {/* Top Grid: Stats & Quick Status */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <motion.div variants={stagger.item} className="lg:col-span-2 glass-panel p-8 border border-white/5 bg-white/[0.01] rounded-3xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Activity size={40} className="text-[var(--accent-blue)]" />
              </div>
              <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-8 flex items-center gap-2">
                <div className="w-1 h-1 bg-[var(--accent-blue)] rounded-full" />
                Sustained Synaptic Volume
              </h3>
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Chunk_Count</p>
                  <div className="text-4xl font-black text-white font-mono tracking-tighter">
                    <AnimatedCounter value={stats.chunkCount} />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Storage_Imprint</p>
                  <div className="text-4xl font-black text-[var(--accent-blue)] font-mono tracking-tighter">
                    {stats.estimatedStorageMB} <span className="text-sm">MB</span>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div variants={stagger.item} className="glass-panel p-8 border border-white/5 bg-white/[0.01] rounded-3xl flex flex-col justify-center">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] mb-2">Primary_Protocol</p>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]">
                  <Cpu size={20} />
                </div>
                <div>
                  <p className="text-sm font-black uppercase tracking-widest text-white">{backend.type}</p>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--accent-mint)]">Operational</p>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            {/* Main Config */}
            <motion.div variants={stagger.item} className="lg:col-span-8 space-y-10">
              <div className="glass-panel p-8 border border-white/5 bg-white/[0.01] rounded-3xl space-y-8">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em]">Protocol Configuration</h3>
                  <div className="h-px flex-1 mx-6 bg-white/5" />
                </div>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] ml-1">Logic_Engine Class</label>
                      <select className="w-full bg-black border border-white/10 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-widest text-[var(--accent-blue)] focus:border-[var(--accent-blue)]/50 focus:ring-1 focus:ring-[var(--accent-blue)]/20 appearance-none transition-all cursor-pointer" value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                        <option value="local">Local Synapse (pgvector)</option>
                        <option value="qdrant">Qdrant Vector Cluster</option>
                        <option value="getzep">Zep Neural Cache</option>
                        <option value="google_drive">Google Synaptic Uplink</option>
                      </select>
                    </div>

                    {selectedType !== "local" && (
                      <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] ml-1">Endpoint_URL</label>
                        <input
                          className="input-base bg-black/40 border-white/10 text-xs font-mono"
                          value={configUrl}
                          onChange={(e) => setConfigUrl(e.target.value)}
                          placeholder={selectedType === "qdrant" ? "http://localhost:6333" : "https://..."}
                        />
                      </div>
                    )}
                  </div>

                  {selectedType !== "local" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] ml-1">Access_Credential</label>
                        <input
                          type="password"
                          className="input-base bg-black/40 border-white/10 text-xs font-mono"
                          value={configApiKey}
                          onChange={(e) => setConfigApiKey(e.target.value)}
                          placeholder={backend.hasApiKey ? "•••••••••••• (Stored)" : "Enter API key"}
                        />
                      </div>
                      {selectedType === "qdrant" && (
                        <div className="space-y-2">
                          <label className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] ml-1">Namespace / Collection</label>
                          <input className="input-base bg-black/40 border-white/10 text-xs font-mono" value={configCollection} onChange={(e) => setConfigCollection(e.target.value)} placeholder="default_synapse" />
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-4 flex justify-end">
                    <button
                      onClick={handleSaveBackend}
                      disabled={saving}
                      className="flex items-center gap-3 px-8 py-3 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl bg-[var(--accent-blue)] text-white hover:shadow-glow-blue disabled:opacity-40 transition-all font-diag"
                    >
                      <RefreshCw size={14} className={saving ? "animate-spin" : ""} />
                      {saving ? "Reconfiguring..." : "Commit Protocol"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Maintenance Logic */}
              <div className="glass-panel p-8 border border-white/5 bg-white/[0.01] rounded-3xl">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em]">Synaptic Maintenance</h3>
                  <div className="h-px flex-1 mx-6 bg-white/5" />
                </div>

                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-6 p-6 rounded-2xl bg-white/[0.02] border border-white/5 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent-mint)]/5 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="space-y-1 relative z-10">
                      <p className="text-[11px] font-black uppercase tracking-widest text-white">Neural Compaction</p>
                      <p className="text-[9px] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">Cull redundant memory nodes and consolidate logical chains.</p>
                    </div>
                    <button
                      onClick={handleCompact}
                      disabled={compacting}
                      className="flex items-center gap-3 px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl border border-[var(--accent-mint)]/30 text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/10 transition-all relative z-10"
                    >
                      <RefreshCw size={14} className={compacting ? "animate-spin" : ""} />
                      {compacting ? "Compacting..." : "Execute"}
                    </button>
                  </div>

                  {compactResult && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-4 rounded-xl bg-[var(--accent-mint)]/5 border border-[var(--accent-mint)]/10 flex items-center gap-3"
                    >
                      <div className="p-1.5 rounded bg-[var(--accent-mint)]/20 text-[var(--accent-mint)]">
                        <Terminal size={12} />
                      </div>
                      <p className="text-[10px] font-mono text-[var(--accent-mint)] uppercase tracking-wider">
                        Successfully consolidated {compactResult.originalCount} nodes down to {compactResult.compactedCount} clusters.
                      </p>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Sidebar: Risks & Logs */}
            <motion.div variants={stagger.item} className="lg:col-span-4 space-y-8">
              <div className="glass-panel p-8 border border-red-500/10 bg-red-500/[0.01] rounded-3xl space-y-6">
                <h3 className="text-[10px] font-black text-red-400 uppercase tracking-[0.4em] flex items-center gap-2">
                  <ShieldAlert size={14} />
                  Terminal Wipe
                </h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-red-400/60 leading-relaxed">
                  Permanently purge all synaptic records. This operation is non-reversible and will lead to total logical amnesia.
                </p>
                <button
                  onClick={handleClearAll}
                  className="w-full py-3.5 text-[10px] font-black uppercase tracking-[0.3em] bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-[0_4px_12px_rgba(239,68,68,0.1)] active:scale-[0.98]"
                >
                  Purge Storage
                </button>
              </div>

              <div className="glass-panel p-8 border border-white/5 bg-white/[0.01] rounded-3xl">
                <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] mb-6">Archive Density</h3>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[8px] font-black uppercase tracking-widest text-white/20">
                      <span>Index Usage</span>
                      <span>{Math.min(100, Math.round((stats.chunkCount / 10000) * 100))}%</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (stats.chunkCount / 10000) * 100)}%` }}
                        className="h-full bg-[var(--accent-blue)]"
                      />
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="flex items-center gap-3">
                      <Layers size={14} className="text-white/20" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Vector Clusters: 12 Active</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
      
      <StatsHUD 
        stats={[
          { label: "MEMORY_NODES", value: stats.chunkCount, color: "var(--accent-blue)" },
          { label: "STORAGE_SIZE", value: `${stats.estimatedStorageMB} MB`, color: "var(--accent-mint)" },
          { label: "CLUSTER_ST", value: "STABLE", color: "var(--accent-blue)" }
        ]}
      />
    </div>
  );
}
