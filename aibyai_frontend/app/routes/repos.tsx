import { useState, useEffect, useRef, useCallback } from "react";
import {
  GitBranch as Github,
  Plus,
  Search,
  Trash2,
  Clock,
  FileCode,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import gsap from "gsap";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { api } from "~/lib/api";
import { useAuth } from "~/context/AuthContext";

interface Repo {
  id: string;
  name: string;
  url: string;
  branch: string;
  fileCount: number;
  lastIndexed: string;
  status: "indexed" | "indexing" | "error";
}

interface SearchResult {
  file: string;
  snippet: string;
  score: number;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  indexed: {
    label: "Indexed",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  indexing: {
    label: "Indexing...",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  error: {
    label: "Error",
    className: "bg-destructive/10 text-destructive",
  },
};

export default function ReposPage() {
  const { user } = useAuth();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexOpen, setIndexOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Repo | null>(null);
  const [newUrl, setNewUrl] = useState("");
  const [newBranch, setNewBranch] = useState("main");
  const [indexing, setIndexing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const fetchRepos = useCallback(async () => {
    try {
      const data = await api.get<Repo[]>("/repos");
      setRepos(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  useEffect(() => {
    if (!loading && gridRef.current) {
      const cards = gridRef.current.querySelectorAll("[data-card]");
      gsap.fromTo(
        cards,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, stagger: 0.06, duration: 0.4, ease: "power2.out" }
      );
    }
  }, [loading, repos.length]);

  async function handleIndex() {
    if (!newUrl.trim()) return;
    setIndexing(true);
    try {
      await api.post("/repos", {
        url: newUrl.trim(),
        branch: newBranch.trim() || "main",
      });
      setIndexOpen(false);
      setNewUrl("");
      setNewBranch("main");
      await fetchRepos();
    } catch {
      // silent
    } finally {
      setIndexing(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.del(`/repos/${deleteTarget.id}`);
      setDeleteTarget(null);
      await fetchRepos();
    } catch {
      // silent
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await api.get<SearchResult[]>(
        `/repos/search?q=${encodeURIComponent(searchQuery.trim())}`
      );
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function extractRepoName(url: string) {
    const parts = url.replace(/\.git$/, "").split("/");
    return parts.slice(-2).join("/");
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Repositories
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Index and search GitHub repositories
            </p>
          </div>
          <Button onClick={() => setIndexOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            Index New Repo
          </Button>
        </div>

        {/* Semantic search */}
        <div className="flex gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search codebase..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
          >
            {searching ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              "Search"
            )}
          </Button>
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Search Results ({searchResults.length})
            </h3>
            <div className="space-y-2">
              {searchResults.map((r, i) => (
                <Card key={i} size="sm">
                  <CardContent className="py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <FileCode className="size-3.5 text-muted-foreground" />
                      <span className="text-xs font-mono text-primary">
                        {r.file}
                      </span>
                      <Badge variant="secondary" className="text-[10px] ml-auto">
                        {(r.score * 100).toFixed(0)}% match
                      </Badge>
                    </div>
                    <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                      {r.snippet}
                    </pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Repos grid */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted mt-2" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : repos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-2xl bg-muted/50 p-6 mb-4">
              <Github className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium">No repositories indexed</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Index a GitHub repository to enable semantic code search.
            </p>
            <Button className="mt-4" onClick={() => setIndexOpen(true)}>
              <Plus className="size-4 mr-1.5" />
              Index Repository
            </Button>
          </div>
        ) : (
          <div
            ref={gridRef}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {repos.map((repo) => {
              const status = statusConfig[repo.status] ?? statusConfig.indexing;
              return (
                <Card key={repo.id} data-card>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Github className="size-4 shrink-0 text-muted-foreground" />
                        <CardTitle className="truncate">
                          {repo.name || extractRepoName(repo.url)}
                        </CardTitle>
                      </div>
                      <Badge variant="secondary" className={status.className}>
                        {status.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <GitBranch className="size-3" />
                        {repo.branch}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileCode className="size-3" />
                        {repo.fileCount} files
                      </span>
                      {repo.lastIndexed && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {new Date(repo.lastIndexed).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="justify-end">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(repo)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Index dialog */}
      <Dialog open={indexOpen} onOpenChange={setIndexOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Index New Repository</DialogTitle>
            <DialogDescription>
              Enter a GitHub repository URL and branch to index.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="repo-url">GitHub URL</Label>
              <Input
                id="repo-url"
                placeholder="https://github.com/owner/repo"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repo-branch">Branch</Label>
              <Input
                id="repo-branch"
                placeholder="main"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleIndex()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIndexOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleIndex}
              disabled={indexing || !newUrl.trim()}
            >
              {indexing ? "Indexing..." : "Index"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Repository</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove "{deleteTarget?.name}"? The index
              will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
