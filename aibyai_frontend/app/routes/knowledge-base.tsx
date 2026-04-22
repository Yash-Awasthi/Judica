import { useState, useEffect, useRef, useCallback } from "react";
import {
  Database,
  Plus,
  Trash2,
  Upload,
  FileText,
  File,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  X,
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
import { ScrollArea } from "~/components/ui/scroll-area";
import { api } from "~/lib/api";
import { useAuth } from "~/context/AuthContext";

interface KBItem {
  id: string;
  name: string;
  description?: string;
  documentCount: number;
  lastUpdated: string;
  vectorized: boolean;
}

interface KBDocument {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
}

const ACCEPT = ".pdf,.docx,.csv,.txt,.md";

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const [kbs, setKbs] = useState<KBItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<KBItem | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedKb, setExpandedKb] = useState<string | null>(null);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchKbs = useCallback(async () => {
    try {
      const data = await api.get<KBItem[]>("/kb");
      setKbs(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKbs();
  }, [fetchKbs]);

  useEffect(() => {
    if (!loading && gridRef.current) {
      const cards = gridRef.current.querySelectorAll("[data-card]");
      gsap.fromTo(
        cards,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, stagger: 0.06, duration: 0.4, ease: "power2.out" }
      );
    }
  }, [loading, kbs.length]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post("/kb", {
        name: newName.trim(),
        description: newDesc.trim(),
      });
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      await fetchKbs();
    } catch {
      // silent
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.del(`/kb/${deleteTarget.id}`);
      if (expandedKb === deleteTarget.id) setExpandedKb(null);
      setDeleteTarget(null);
      await fetchKbs();
    } catch {
      // silent
    }
  }

  async function toggleExpand(kb: KBItem) {
    if (expandedKb === kb.id) {
      setExpandedKb(null);
      return;
    }
    setExpandedKb(kb.id);
    try {
      const docs = await api.get<KBDocument[]>(`/kb/${kb.id}/documents`);
      setDocuments(docs);
    } catch {
      setDocuments([]);
    }
  }

  async function uploadFiles(files: FileList | File[], kbId: string) {
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(0);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kbId", kbId);

      try {
        const res = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!res.ok) throw new Error("Upload failed");
      } catch {
        // silent
      }
      setUploadProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setUploading(false);
    setUploadProgress(0);
    // Refresh documents
    try {
      const docs = await api.get<KBDocument[]>(`/kb/${kbId}/documents`);
      setDocuments(docs);
    } catch {
      // silent
    }
    await fetchKbs();
  }

  function handleDrop(e: React.DragEvent, kbId: string) {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length) uploadFiles(files, kbId);
  }

  async function deleteDocument(kbId: string, docId: string) {
    try {
      await api.del(`/kb/${kbId}/documents/${docId}`);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      await fetchKbs();
    } catch {
      // silent
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Knowledge Base
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage document collections for AI retrieval
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            New KB
          </Button>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 w-2/3 rounded bg-muted" />
                </CardHeader>
                <CardContent>
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : kbs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-2xl bg-muted/50 p-6 mb-4">
              <Database className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium">No knowledge bases</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Create a knowledge base and upload documents for AI-powered
              retrieval and search.
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 mr-1.5" />
              Create KB
            </Button>
          </div>
        ) : (
          <div ref={gridRef} className="space-y-4">
            {kbs.map((kb) => (
              <Card key={kb.id} data-card>
                <CardHeader
                  className="cursor-pointer"
                  onClick={() => toggleExpand(kb)}
                >
                  <div className="flex items-center gap-3">
                    {expandedKb === kb.id ? (
                      <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <CardTitle className="truncate">{kb.name}</CardTitle>
                        <Badge
                          variant="secondary"
                          className={
                            kb.vectorized
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          }
                        >
                          {kb.vectorized ? (
                            <>
                              <CheckCircle2 className="size-3 mr-0.5" />
                              Vectorized
                            </>
                          ) : (
                            "Pending"
                          )}
                        </Badge>
                      </div>
                      <CardDescription className="mt-0.5">
                        {kb.documentCount} documents
                        {kb.lastUpdated && (
                          <>
                            {" "}
                            &middot; Updated{" "}
                            {new Date(kb.lastUpdated).toLocaleDateString()}
                          </>
                        )}
                      </CardDescription>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(kb);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardHeader>

                {expandedKb === kb.id && (
                  <CardContent className="pt-0">
                    {/* Upload zone */}
                    <div
                      className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                        dragOver
                          ? "border-primary bg-primary/5"
                          : "border-border"
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => handleDrop(e, kb.id)}
                    >
                      <Upload className="size-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Drag and drop files here, or{" "}
                        <button
                          className="text-primary hover:underline"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          browse
                        </button>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        PDF, DOCX, CSV, TXT, MD
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPT}
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) uploadFiles(e.target.files, kb.id);
                          e.target.value = "";
                        }}
                      />
                    </div>

                    {uploading && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>Uploading...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Documents list */}
                    {documents.length > 0 && (
                      <div className="mt-4 space-y-1">
                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                          Documents
                        </h4>
                        {documents.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/50 group"
                          >
                            <FileText className="size-4 text-muted-foreground shrink-0" />
                            <span className="text-sm truncate flex-1">
                              {doc.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatSize(doc.size)}
                            </span>
                            <button
                              onClick={() => deleteDocument(kb.id, doc.id)}
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Knowledge Base</DialogTitle>
            <DialogDescription>
              Create a new collection for your documents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="kb-name">Name</Label>
              <Input
                id="kb-name"
                placeholder="Product Documentation"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-desc">Description</Label>
              <Input
                id="kb-desc"
                placeholder="Optional description..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Knowledge Base</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? All
              documents will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
