import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { GitBranch, Search, Trash2, Plus, FolderGit2 } from "lucide-react";
import { SkeletonLoader } from "../components/SkeletonLoader";

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
    <div className="h-full overflow-y-auto scrollbar-custom p-6">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight mb-1">Code Repositories</h1>
          <p className="text-sm text-[var(--text-muted)] mb-6">Index and search GitHub repositories for context-aware deliberations</p>
        </motion.div>

        {/* Add form */}
        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          onSubmit={handleAdd}
          className="surface-card p-5 mb-6"
        >
          <h2 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3">
            <Plus size={12} className="inline mr-1.5" />
            Add GitHub Repository
          </h2>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1 font-bold uppercase tracking-widest">Owner</label>
              <input type="text" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. facebook" className="input-base w-48" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1 font-bold uppercase tracking-widest">Repo</label>
              <input type="text" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="e.g. react" className="input-base w-48" />
            </div>
            <button type="submit" disabled={loading} className="btn-pill-primary text-sm px-4 py-2 disabled:opacity-50">
              {loading ? "Adding..." : "Add Repository"}
            </button>
          </div>
        </motion.form>

        {/* Repos list */}
        {initialLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => <SkeletonLoader key={i} variant="card" />)}
          </div>
        ) : repos.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
            <FolderGit2 size={48} className="mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
            <p className="text-[var(--text-secondary)] text-sm">No repositories indexed yet.</p>
            <p className="text-[var(--text-muted)] text-xs mt-1">Add a GitHub repository above to get started</p>
          </motion.div>
        ) : (
          <motion.div
            initial="initial"
            animate="animate"
            variants={{ animate: { transition: { staggerChildren: 0.06 } } }}
            className="space-y-4"
          >
            <AnimatePresence>
              {repos.map((r) => (
                <motion.div
                  key={r.id}
                  variants={{ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } }}
                  exit={{ opacity: 0, x: -20 }}
                  layout
                  className="surface-card p-5"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[rgba(96,165,250,0.08)] border border-[rgba(96,165,250,0.12)] flex items-center justify-center text-[var(--accent-blue)]">
                        <GitBranch size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{r.name}</h3>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-pill ${
                            r.indexed
                              ? "bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)]"
                              : "bg-[rgba(251,191,36,0.08)] text-[var(--accent-gold)] border border-[rgba(251,191,36,0.15)]"
                          }`}>
                            {r.indexed ? "Indexed" : "Indexing..."}
                          </span>
                          <span className="text-xs text-[var(--text-muted)] font-mono">{r.fileCount} files</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="p-2 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/8 rounded-lg transition-colors"
                      title="Delete repository"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Search */}
                  {r.indexed && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                          <input
                            type="text"
                            value={searchQueries[r.id] || ""}
                            onChange={(e) => setSearchQueries((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && handleSearch(r.id)}
                            placeholder="Search code..."
                            className="input-base pl-9"
                          />
                        </div>
                        <button
                          onClick={() => handleSearch(r.id)}
                          className="px-3 py-2 text-xs font-semibold rounded-button bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)] hover:bg-[rgba(110,231,183,0.15)] transition-colors"
                        >
                          Search
                        </button>
                      </div>

                      {searchResults[r.id] && searchResults[r.id].length > 0 && (
                        <div className="mt-3 space-y-2">
                          {searchResults[r.id].map((result, i) => (
                            <div key={i} className="bg-[var(--code-bg)] border border-[var(--code-border)] rounded-card p-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-mono text-[var(--accent-mint)]">{result.path}</span>
                                <span className="text-[10px] text-[var(--text-muted)]">
                                  {result.language} | score: {result.score.toFixed(3)}
                                </span>
                              </div>
                              <pre className="text-xs text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto scrollbar-custom font-mono">
                                {result.content.slice(0, 500)}
                                {result.content.length > 500 ? "..." : ""}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}
