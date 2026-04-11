import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

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
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    loadRepos();
  }, [loadRepos]);

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
        setOwner("");
        setRepo("");
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
    <div className="flex-1 overflow-y-auto p-6 md:p-10 max-w-5xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-text mb-6">Code Repositories</h1>

      {/* Add form */}
      <form onSubmit={handleAdd} className="flex gap-3 mb-8 items-end flex-wrap">
        <div>
          <label className="block text-xs text-text-dim mb-1 font-semibold uppercase tracking-wider">Owner</label>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="e.g. facebook"
            className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-text focus:outline-none focus:border-accent/40 w-48"
          />
        </div>
        <div>
          <label className="block text-xs text-text-dim mb-1 font-semibold uppercase tracking-wider">Repo</label>
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="e.g. react"
            className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-text focus:outline-none focus:border-accent/40 w-48"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-accent/20 hover:bg-accent/30 text-accent border border-accent/20 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? "Adding..." : "Add GitHub Repo"}
        </button>
      </form>

      {/* Repos list */}
      {repos.length === 0 ? (
        <p className="text-text-dim text-sm">No repositories indexed yet.</p>
      ) : (
        <div className="space-y-4">
          {repos.map((r) => (
            <div key={r.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-text">{r.name}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      r.indexed
                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                        : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                    }`}>
                      {r.indexed ? "Indexed" : "Indexing..."}
                    </span>
                    <span className="text-xs text-text-dim">{r.fileCount} files</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="text-text-dim hover:text-red-400 transition-colors p-1"
                  title="Delete repository"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>

              {/* Search */}
              {r.indexed && (
                <div className="mt-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQueries[r.id] || ""}
                      onChange={(e) =>
                        setSearchQueries((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === "Enter" && handleSearch(r.id)}
                      placeholder="Search code..."
                      className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-text focus:outline-none focus:border-accent/40"
                    />
                    <button
                      onClick={() => handleSearch(r.id)}
                      className="px-3 py-1.5 bg-accent/10 hover:bg-accent/20 text-accent rounded-lg text-sm transition-colors"
                    >
                      Search
                    </button>
                  </div>

                  {searchResults[r.id] && searchResults[r.id].length > 0 && (
                    <div className="mt-3 space-y-2">
                      {searchResults[r.id].map((result, i) => (
                        <div
                          key={i}
                          className="bg-black/30 border border-white/[0.04] rounded-lg p-3"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-mono text-accent">{result.path}</span>
                            <span className="text-[10px] text-text-dim">
                              {result.language} | score: {result.score.toFixed(3)}
                            </span>
                          </div>
                          <pre className="text-xs text-text-muted overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {result.content.slice(0, 500)}
                            {result.content.length > 500 ? "..." : ""}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
