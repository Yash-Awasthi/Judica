import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardFooter,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import {
  FolderOpen,
  Plus,
  MessageSquare,
  Pencil,
  Trash2,
  Clock,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import gsap from "gsap";
import { cn } from "~/lib/utils";
import { api } from "~/lib/api";
import { formatDistanceToNow } from "date-fns";

// --- Types ---

interface Project {
  id: string;
  name: string;
  description: string;
  conversationCount: number;
  lastActive?: string;
  createdAt?: string;
}

// --- Projects Page ---

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);

  // Fetch projects
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get<Project[]>("/projects");
        if (!cancelled) setProjects(data);
      } catch {
        // API not available — empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // GSAP stagger animation on grid load
  useEffect(() => {
    if (!gridRef.current || loading || projects.length === 0) return;
    const cards = gridRef.current.children;
    gsap.fromTo(
      cards,
      { opacity: 0, y: 20, scale: 0.98 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        stagger: 0.05,
        duration: 0.4,
        ease: "power2.out",
      }
    );
  }, [loading, projects.length]);

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) return;
    setFormSubmitting(true);
    try {
      const newProject = await api.post<Project>("/projects", {
        name: formName.trim(),
        description: formDescription.trim(),
      });
      setProjects((prev) => [newProject, ...prev]);
      setCreateOpen(false);
      setFormName("");
      setFormDescription("");
    } catch {
      // handle error
    } finally {
      setFormSubmitting(false);
    }
  }, [formName, formDescription]);

  const handleUpdate = useCallback(async () => {
    if (!editProject || !formName.trim()) return;
    setFormSubmitting(true);
    try {
      const updated = await api.put<Project>(`/projects/${editProject.id}`, {
        name: formName.trim(),
        description: formDescription.trim(),
      });
      setProjects((prev) =>
        prev.map((p) => (p.id === editProject.id ? updated : p))
      );
      setEditProject(null);
      setFormName("");
      setFormDescription("");
    } catch {
      // handle error
    } finally {
      setFormSubmitting(false);
    }
  }, [editProject, formName, formDescription]);

  const handleDelete = useCallback(async () => {
    if (!deleteProject) return;
    try {
      await api.del(`/projects/${deleteProject.id}`);
      setProjects((prev) => prev.filter((p) => p.id !== deleteProject.id));
      setDeleteProject(null);
    } catch {
      // handle error
    }
  }, [deleteProject]);

  const openEdit = useCallback((project: Project) => {
    setFormName(project.name);
    setFormDescription(project.description);
    setEditProject(project);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">Projects</h1>
            <Badge variant="secondary" className="text-xs">
              {projects.length}
            </Badge>
          </div>
          <Button size="sm" onClick={() => { setFormName(""); setFormDescription(""); setCreateOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" />
            New Project
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-4 bg-muted rounded w-3/4 mb-3" />
                  <div className="h-3 bg-muted rounded w-full mb-2" />
                  <div className="h-3 bg-muted rounded w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyProjectsState onCreateClick={() => { setFormName(""); setFormDescription(""); setCreateOpen(true); }} />
        ) : (
          <div ref={gridRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onEdit={() => openEdit(project)}
                onDelete={() => setDeleteProject(project)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
            <DialogDescription>
              Organize your deliberations into a project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                placeholder="My Research Project"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-desc">Description</Label>
              <Input
                id="project-desc"
                placeholder="A brief description..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleCreate} disabled={!formName.trim() || formSubmitting}>
              {formSubmitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editProject} onOpenChange={(open) => !open && setEditProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update project details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc">Description</Label>
              <Input
                id="edit-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProject(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={!formName.trim() || formSubmitting}>
              {formSubmitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteProject} onOpenChange={(open) => !open && setDeleteProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteProject?.name}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProject(null)}>
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

// --- Sub-components ---

function ProjectCard({
  project,
  onEdit,
  onDelete,
}: {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const timeAgo = (() => {
    const date = project.lastActive ?? project.createdAt;
    if (!date) return null;
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true });
    } catch {
      return null;
    }
  })();

  return (
    <Card className="group hover:ring-2 hover:ring-primary/20 transition-all cursor-pointer">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="w-4 h-4 text-primary shrink-0" />
            <CardTitle className="truncate">{project.name}</CardTitle>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="w-3.5 h-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {project.description && (
          <CardDescription className="line-clamp-2">
            {project.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardFooter>
        <div className="flex items-center gap-4 text-xs text-muted-foreground w-full">
          <div className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            <span>
              {project.conversationCount} conversation{project.conversationCount !== 1 ? "s" : ""}
            </span>
          </div>
          {timeAgo && (
            <div className="flex items-center gap-1 ml-auto">
              <Clock className="w-3 h-3" />
              <span>{timeAgo}</span>
            </div>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

function EmptyProjectsState({ onCreateClick }: { onCreateClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(
      ref.current,
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }
    );
  }, []);

  return (
    <div ref={ref} className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
        <FolderOpen className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">No projects yet</h2>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Create a project to organize your deliberations and keep related conversations together.
      </p>
      <Button onClick={onCreateClick}>
        <Plus className="w-4 h-4 mr-1" />
        Create your first project
      </Button>
    </div>
  );
}
