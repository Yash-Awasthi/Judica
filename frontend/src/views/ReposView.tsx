import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { Search, Trash2, Plus, Database, ArrowRight, Layers } from "lucide-react";
import { SkeletonLoader } from "../components/SkeletonLoader";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import { StatsHUD } from "../components/StatsHUD";

interface Repo {
  id: string;
  source: string;
  repoUrl: string | null;
  name: string;
  indexed: boolean;
  fileCount: number;
  createdAt: string;
}

interface SearchResult {
  path: string;
  language: string;
  content: string;
  score: number;
}

export function ReposView() {
  const { fetchWithAuth } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, SearchResult[]>>({});

  const loadRepos = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/repos");
      if (res.ok) {
        const data = await res.json();
        setRepos(data.data || []);
      }
    } catch (err) {
      console.error("Failed to load repos", err);
    } finally {
      setInitialLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!owner.trim() || !repo.trim()) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/repos/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: owner.trim(), repo: repo.trim() }),
      });
      if (res.ok) {
        setOwner(""); setRepo("");
        setTimeout(loadRepos, 1000);
      }
    } catch (err) {
      console.error("Failed to add repo", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/repos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRepos((prev) => prev.filter((r) => r.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete repo", err);
    }
  };

  const handleSearch = async (repoId: string) => {
    const query = searchQueries[repoId];
    if (!query?.trim()) return;
    try {
      const res = await fetchWithAuth(`/api/repos/${repoId}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults((prev) => ({ ...prev, [repoId]: data.data || [] }));
      }
    } catch (err) {
      console.error("Failed to search repo", err);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#000000] overflow-hidden">
      <TechnicalGrid />
      
      <div className="relative z-10 h-full overflow-y-auto scrollbar-custom p-4 lg:p-8">
        <div className="max-w-7xl mx-auto space-y-12">
          
          <SectorHUD 
            sectorId="INTEL-12"
            title="Knowledge_Index"
            subtitle="Distributed Intelligence Vault // Neural Vector Repository"
            accentColor="var(--accent-mint)"
            telemetry={[
              { label: "NODE_LOAD", value: "88%", status: "optimal" },
              { label: "VAULT_SYNC", value: "STABLE", status: "online" },
              { label: "LATENCY", value: "1.2ms", status: "optimal" }
            ]}
          />
        

        {/* ━━━ Integration Hub ━━━ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative p-12 rounded-[3.5rem] bg-white/[0.01] border border-white/5 backdrop-blur-3xl overflow-hidden group shadow-2xl"
        >
          <div className="absolute top-0 right-0 w-[40%] h-[40%] bg-[var(--accent-mint)]/5 blur-[120px] pointer-events-none" />
          
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-5">
              <div className="w-10 h-10 rounded-xl bg-[var(--accent-mint)]/10 border border-[var(--accent-mint)]/20 flex items-center justify-center text-[var(--accent-mint)] shadow-[0_0_20px_rgba(110,231,183,0.1)]">
                <Plus size={18} />
              </div>
              <div>
                <h2 className="text-[11px] font-black text-white uppercase tracking-[0.4em] font-diag">Synchronize_Remote_Lattice</h2>
                <div className="h-[1px] w-24 bg-gradient-to-r from-[var(--accent-mint)]/40 to-transparent mt-2" />
              </div>
            </div>
            
            <div className="flex items-center gap-6">
                {/* Header-level mini stats can remain as they are or we can use a small StatsHUD if it fits */}
                <StatsMini label="ACTIVE_VAULTS" value={repos.length} color="var(--accent-mint)" />
                <StatsMini label="TOTAL_NODES" value={repos.reduce((acc, r) => acc + r.fileCount, 0)} color="var(--accent-blue)" />
            </div>
          </div>

          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-7 gap-6 items-end relative z-10">
            <div className="md:col-span-2 space-y-3">
              <label className="block text-[10px] font-diag text-white/30 uppercase tracking-[0.4em] ml-2">Lattice_Owner</label>
              <div className="relative group/input">
                <input 
                  type="text" 
                  value={owner} 
                  onChange={(e) => setOwner(e.target.value)} 
                  placeholder="e.g. facebook" 
                  className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-5 text-sm text-white focus:outline-none focus:border-[var(--accent-mint)]/40 transition-all placeholder:text-white/10 font-bold" 
                />
              </div>
            </div>
            <div className="md:col-span-3 space-y-3">
              <label className="block text-[10px] font-diag text-white/30 uppercase tracking-[0.4em] ml-2">Resource_Signature</label>
              <div className="relative group/input">
                <input 
                  type="text" 
                  value={repo} 
                  onChange={(e) => setRepo(e.target.value)} 
                  placeholder="e.g. react" 
                  className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-5 text-sm text-white focus:outline-none focus:border-[var(--accent-mint)]/40 transition-all placeholder:text-white/10 font-bold" 
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <button 
                type="submit" 
                disabled={loading} 
                className="group w-full h-[62px] px-8 rounded-2xl bg-[var(--accent-mint)] text-black font-black uppercase tracking-[0.2em] text-[11px] shadow-[0_0_40px_rgba(110,231,183,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-30 flex items-center justify-center gap-3"
              >
                {loading ? (
                  <>
                    <div className="w-5 h-5 border-3 border-black border-t-transparent rounded-full animate-spin" />
                    INDEXING...
                  </>
                ) : (
                  <>
                    INDEX_RESOURCES
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>

        {/* ━━━ Vault Grid ━━━ */}
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2">
            <div className="w-2 h-2 rounded-full bg-[var(--accent-mint)] shadow-[0_0_8px_var(--accent-mint)]" />
            <h2 className="text-[10px] font-black text-white/40 uppercase tracking-[0.5em] font-diag">Active_Intelligence_Vaults</h2>
          </div>

          {initialLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonLoader key={i} variant="card" />)}
            </div>
          ) : repos.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-24 border border-dashed border-white/5 rounded-[3rem] bg-white/[0.01]">
              <Database size={64} className="mx-auto mb-6 text-[var(--accent-mint)] opacity-10" />
              <p className="text-white/40 text-sm font-diag uppercase tracking-widest italic">No neural patterns indexed within current sector. Establish link to proceed.</p>
            </motion.div>
          ) : (
            <motion.div
              layout
              className="grid grid-cols-1 lg:grid-cols-2 gap-6"
            >
              <AnimatePresence mode="popLayout">
                {repos.map((r) => (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="relative p-10 rounded-[3rem] bg-white/[0.01] border border-white/5 backdrop-blur-3xl group/repo overflow-hidden hover:border-[var(--accent-mint)]/30 transition-all duration-500 shadow-2xl"
                  >
                    <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--accent-mint)]/5 blur-[100px] pointer-events-none group-hover/repo:bg-[var(--accent-mint)]/10 transition-colors duration-700" />
                    
                    <div className="flex items-start justify-between relative z-10">
                      <div className="flex items-center gap-6">
                        <div className="w-20 h-20 rounded-[2rem] bg-black/40 border border-white/10 flex items-center justify-center text-white/20 group-hover/repo:text-[var(--accent-mint)] group-hover/repo:border-[var(--accent-mint)]/30 transition-all duration-700 shadow-inner">
                          <Layers size={32} />
                        </div>
                        <div>
                          <div className="flex items-center gap-4 mb-2">
                             <h3 className="text-2xl font-black text-white uppercase tracking-tighter group-hover/repo:text-[var(--accent-mint)] transition-colors italic leading-none">{r.name}</h3>
                             <div className={`text-[9px] font-diag font-black uppercase tracking-[0.3em] px-3 py-1 rounded-lg border flex items-center gap-2 ${
                               r.indexed
                                 ? "bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] border-[var(--accent-mint)]/20 shadow-[0_0_20px_rgba(110,231,183,0.1)]"
                                 : "bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] border-[var(--accent-gold)]/20"
                             }`}>
                               <div className={`w-1.5 h-1.5 rounded-full ${r.indexed ? "bg-[var(--accent-mint)] animate-pulse shadow-[0_0_8px_currentColor]" : "bg-[var(--accent-gold)]"}`} />
                               {r.indexed ? "STABLE" : "SYNCING"}
                             </div>
                          </div>
                          <p className="text-[10px] text-white/30 font-diag uppercase tracking-[0.3em]">Vault_Signature: 0x{r.id.slice(0, 16).toUpperCase()}</p>
                          <div className="flex items-center gap-6 mt-6">
                            <div className="flex flex-col">
                                <span className="text-[8px] font-diag text-white/20 uppercase tracking-widest mb-1">DATA_NODES</span>
                                <span className="text-lg font-black text-white italic">{r.fileCount} <span className="text-[10px] text-white/40 not-italic">u</span></span>
                            </div>
                            <div className="h-8 w-px bg-white/5" />
                            <div className="flex flex-col">
                                <span className="text-[8px] font-diag text-white/20 uppercase tracking-widest mb-1">SYNC_FREQ</span>
                                <span className="text-lg font-black text-white italic">REALTIME</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="w-14 h-14 flex items-center justify-center text-white/10 hover:text-red-400 hover:bg-red-400/10 rounded-2xl transition-all border border-transparent hover:border-red-400/20 active:scale-95 group/del"
                      >
                        <Trash2 size={24} className="group-hover/del:scale-110 transition-transform" />
                      </button>
                    </div>

                    {/* ━━━ Search Trace ━━━ */}
                    {r.indexed && (
                      <div className="mt-8 pt-8 border-t border-white/5 relative z-10">
                        <div className="flex gap-4">
                          <div className="relative flex-1 group/search">
                            <Search size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[var(--accent-mint)] opacity-30 group-focus-within/search:opacity-100 transition-opacity" />
                            <input
                              type="text"
                              value={searchQueries[r.id] || ""}
                              onChange={(e) => setSearchQueries((prev) => ({ ...prev, [r.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === "Enter" && handleSearch(r.id)}
                              placeholder="TRACE_LOGIC_PATTERN..."
                              className="w-full bg-black/40 border border-white/5 rounded-2xl pl-16 pr-6 py-4 text-xs text-white font-diag uppercase tracking-wider focus:outline-none focus:border-[var(--accent-mint)]/30 transition-all placeholder:text-white/10"
                            />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                               <div className="h-4 w-px bg-white/5 mx-2" />
                               <span className="text-[8px] font-diag text-white/20 uppercase tracking-widest hidden sm:block">F1_SEARCH</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleSearch(r.id)}
                            className="px-8 rounded-2xl bg-white/[0.04] border border-white/10 text-white font-black uppercase tracking-[0.3em] text-[10px] hover:bg-white/[0.08] transition-all hover:border-[var(--accent-mint)]/20"
                          >
                            TRACE
                          </button>
                        </div>

                        {/* Search Results */}
                        <AnimatePresence>
                          {searchResults[r.id] && searchResults[r.id].length > 0 && (
                            <motion.div 
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-8 space-y-4 overflow-hidden"
                            >
                              <div className="flex items-center justify-between mb-4">
                                <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.4em] font-diag">Analysis_Report: {searchResults[r.id].length} Patterns_Found</span>
                                <button onClick={() => setSearchResults(prev => ({ ...prev, [r.id]: [] }))} className="text-[8px] font-black text-[var(--accent-mint)] uppercase tracking-widest hover:underline transition-all">Dismiss_Report</button>
                              </div>
                              {searchResults[r.id].map((result, i) => (
                                <motion.div 
                                  key={i} 
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: i * 0.1 }}
                                  className="relative p-6 rounded-[1.5rem] bg-black/60 border border-white/5 overflow-hidden group/result hover:border-[var(--accent-mint)]/20 transition-all"
                                >
                                  <div className="absolute top-0 left-0 w-[2px] h-full bg-gradient-to-b from-[var(--accent-mint)]/40 to-transparent" />
                                  <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-mint)] animate-pulse" />
                                      <span className="text-[11px] font-black text-[var(--accent-mint)] uppercase italic tracking-tight truncate max-w-xs">{result.path}</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[8px] font-diag text-white/40 uppercase tracking-widest">{result.language}</span>
                                        <span className="text-[10px] font-black text-white font-diag tracking-widest">0x{result.score.toFixed(4).replace("0.", "")}</span>
                                    </div>
                                  </div>
                                  <div className="relative">
                                    <pre className="text-[12px] text-white/60 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto scrollbar-custom font-mono leading-relaxed bg-white/[0.01] p-6 rounded-2xl border border-white/[0.03]">
                                        {result.content.slice(0, 1000)}
                                        {result.content.length > 1000 ? "..." : ""}
                                    </pre>
                                  </div>
                                </motion.div>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>

      <StatsHUD 
        stats={[
          { label: "LATTICE_NODES", value: repos.length, color: "var(--accent-mint)" },
          { label: "SYNCED_FILES", value: repos.reduce((acc, r) => acc + r.fileCount, 0), color: "var(--accent-blue)" },
          { label: "INDEX_STATE", value: `${Math.round((repos.filter(r => r.indexed).length / (repos.length || 1)) * 100)}%`, color: "var(--accent-mint)" }
        ]}
      />
      </div>
    </div>
  );
}

function StatsMini({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[9px] font-diag text-white/20 uppercase tracking-[0.3em] mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: color }} />
        <span className="text-xl font-black text-white italic tracking-tighter">{value}</span>
      </div>
    </div>
  );
}

