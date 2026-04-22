import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  GitBranch,
  Plus,
  Trash2,
  Play,
  Clock,
  Workflow,
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

interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  lastRun: string | null;
  status: "active" | "draft" | "error";
}

const statusConfig: Record<
  string,
  { label: string; className: string }
> = {
  active: {
    label: "Active",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground",
  },
  error: {
    label: "Error",
    className: "bg-destructive/10 text-destructive",
  },
};

export default function WorkflowsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowItem | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const fetchWorkflows = useCallback(async () => {
    try {
      const data = await api.get<WorkflowItem[]>("/workflows");
      setWorkflows(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  useEffect(() => {
    if (!loading && gridRef.current) {
      const cards = gridRef.current.querySelectorAll("[data-card]");
      gsap.fromTo(
        cards,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, stagger: 0.06, duration: 0.4, ease: "power2.out" }
      );
    }
  }, [loading, workflows.length]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api.post("/workflows", {
        name: newName.trim(),
        description: newDesc.trim(),
      });
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      await fetchWorkflows();
    } catch {
      // silent
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.del(`/workflows/${deleteTarget.id}`);
      setDeleteTarget(null);
      await fetchWorkflows();
    } catch {
      // silent
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Build and manage AI automation workflows
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1.5" />
            New Workflow
          </Button>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-2xl bg-muted/50 p-6 mb-4">
              <Workflow className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium">No workflows yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Create your first workflow to automate AI tasks with a visual
              node-based editor.
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 mr-1.5" />
              Create Workflow
            </Button>
          </div>
        ) : (
          <div
            ref={gridRef}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {workflows.map((wf) => {
              const status = statusConfig[wf.status] ?? statusConfig.draft;
              return (
                <Card
                  key={wf.id}
                  data-card
                  className="cursor-pointer transition-shadow hover:ring-2 hover:ring-primary/20"
                  onClick={() => navigate(`/workflows/${wf.id}`)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="line-clamp-1">{wf.name}</CardTitle>
                      <Badge variant="secondary" className={status.className}>
                        {status.label}
                      </Badge>
                    </div>
                    <CardDescription className="line-clamp-2">
                      {wf.description || "No description"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <GitBranch className="size-3" />
                        {wf.nodeCount} nodes
                      </span>
                      {wf.lastRun && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {new Date(wf.lastRun).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(wf);
                      }}
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Workflow</DialogTitle>
            <DialogDescription>
              Create a new workflow to automate AI tasks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                placeholder="My Workflow"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-desc">Description</Label>
              <Input
                id="wf-desc"
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
            <DialogTitle>Delete Workflow</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action
              cannot be undone.
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
