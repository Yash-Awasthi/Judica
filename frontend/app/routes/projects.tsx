import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { FolderOpen, Plus, MessageSquare, MoreVertical, Pencil, Trash2 } from "lucide-react";

interface Project {
  id: string;
  name: string;
  description: string;
  conversationCount: number;
  createdAt: string;
}

const initialProjects: Project[] = [
  {
    id: "proj_1",
    name: "API Redesign",
    description: "Complete API v2 redesign with GraphQL support",
    conversationCount: 12,
    createdAt: "2026-03-15",
  },
  {
    id: "proj_2",
    name: "ML Pipeline",
    description: "Production ML pipeline for recommendation engine",
    conversationCount: 8,
    createdAt: "2026-04-01",
  },
  {
    id: "proj_3",
    name: "Security Audit",
    description: "Q2 security audit and compliance review",
    conversationCount: 5,
    createdAt: "2026-04-10",
  },
  {
    id: "proj_4",
    name: "Mobile App",
    description: "React Native mobile companion app",
    conversationCount: 3,
    createdAt: "2026-04-18",
  },
];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const openNew = () => {
    setName("");
    setDescription("");
    setNewProjectOpen(true);
  };

  const openEdit = (project: Project) => {
    setName(project.name);
    setDescription(project.description);
    setEditProject(project);
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    const newProject: Project = {
      id: `proj_${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      conversationCount: 0,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    setProjects((prev) => [newProject, ...prev]);
    setNewProjectOpen(false);
  };

  const handleUpdate = () => {
    if (!editProject || !name.trim()) return;
    setProjects((prev) =>
      prev.map((p) =>
        p.id === editProject.id
          ? { ...p, name: name.trim(), description: description.trim() }
          : p
      )
    );
    setEditProject(null);
  };

  const handleDelete = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FolderOpen className="size-6 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold">Projects</h1>
              <p className="text-sm text-muted-foreground">
                Organize conversations into focused project workspaces
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-2" onClick={openNew}>
            <Plus className="size-3.5" />
            New Project
          </Button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm truncate">{project.name}</CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {project.description}
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(project)} className="gap-2 text-xs">
                        <Pencil className="size-3" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(project.id)}
                        className="gap-2 text-xs text-red-400 focus:text-red-400"
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="size-3" />
                    {project.conversationCount} conversation{project.conversationCount !== 1 ? "s" : ""}
                  </span>
                  <span>{project.createdAt}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {projects.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            No projects yet. Create your first project to get started.
          </div>
        )}
      </div>

      {/* New Project Dialog */}
      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="proj-name">Name</Label>
              <Input
                id="proj-name"
                placeholder="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proj-desc">Description</Label>
              <Textarea
                id="proj-desc"
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewProjectOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!name.trim()}>
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Project Dialog */}
      <Dialog open={!!editProject} onOpenChange={(open) => !open && setEditProject(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                placeholder="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea
                id="edit-desc"
                placeholder="What is this project about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProject(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={!name.trim()}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
