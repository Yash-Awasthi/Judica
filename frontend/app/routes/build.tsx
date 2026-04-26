/**
 * Build Tab — Phase 4.4
 *
 * Kanban board for the council task graph.
 * Supports drag-and-drop column lanes (HTML5 native DnD),
 * task creation, claim/release, work stealing, and review submission.
 *
 * Inspired by:
 * - dnd-kit (thefrontendguy/dnd-kit) — drag-and-drop for React
 * - React Flow (@xyflow/react) — used in the Graph View tab
 * - Taskade — agent task graph UI
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  Plus,
  RefreshCw,
  Lock,
  Unlock,
  CheckCircle,
  Clock,
  AlertCircle,
  PlayCircle,
  Eye,
  Shuffle,
  Trash2,
  ChevronRight,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type TaskStatus = "planned" | "claimed" | "in_progress" | "review" | "done" | "blocked";

interface BuildTask {
  id: number;
  userId: number;
  parentId: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  claimedBy: string | null;
  claimedAt: string | null;
  output: string | null;
  submittedAt: string | null;
  isLocked: boolean;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: "planned",     label: "Planned",     color: "bg-slate-100 dark:bg-slate-800" },
  { id: "claimed",     label: "Claimed",     color: "bg-blue-50 dark:bg-blue-950" },
  { id: "in_progress", label: "In Progress", color: "bg-yellow-50 dark:bg-yellow-950" },
  { id: "review",      label: "Review",      color: "bg-purple-50 dark:bg-purple-950" },
  { id: "done",        label: "Done",        color: "bg-green-50 dark:bg-green-950" },
  { id: "blocked",     label: "Blocked",     color: "bg-red-50 dark:bg-red-950" },
];

const STATUS_ICONS: Record<TaskStatus, React.ReactNode> = {
  planned:     <Clock className="w-3 h-3" />,
  claimed:     <Lock className="w-3 h-3" />,
  in_progress: <PlayCircle className="w-3 h-3" />,
  review:      <Eye className="w-3 h-3" />,
  done:        <CheckCircle className="w-3 h-3" />,
  blocked:     <AlertCircle className="w-3 h-3" />,
};

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onRefresh,
  onSelect,
  draggable,
  onDragStart,
}: {
  task: BuildTask;
  onRefresh: () => void;
  onSelect: (t: BuildTask) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, task: BuildTask) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleClaim = async () => {
    setLoading(true);
    try {
      await apiFetch(`/build/tasks/${task.id}/claim`, {
        method: "POST",
        body: JSON.stringify({ agentId: "user" }),
      });
      onRefresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRelease = async () => {
    setLoading(true);
    try {
      await apiFetch(`/build/tasks/${task.id}/release`, { method: "POST" });
      onRefresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    setLoading(true);
    try {
      await apiFetch(`/build/tasks/${task.id}`, { method: "DELETE" });
      onRefresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart ? (e) => onDragStart(e, task) : undefined}
      className="bg-white dark:bg-gray-900 border rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow select-none"
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={() => onSelect(task)}
          className="font-medium text-sm text-left hover:underline flex-1 min-w-0 truncate"
        >
          {task.title}
        </button>
        <button
          onClick={handleDelete}
          className="text-gray-400 hover:text-red-500 shrink-0"
          disabled={loading}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {task.claimedBy && (
        <p className="text-xs text-gray-500 mt-1 truncate">
          Claimed by <span className="font-mono">{task.claimedBy}</span>
        </p>
      )}

      <div className="flex items-center gap-1 mt-2">
        {task.parentId && (
          <Badge variant="outline" className="text-xs px-1 py-0">
            sub
          </Badge>
        )}
        {task.isLocked && (
          <Lock className="w-3 h-3 text-orange-500" />
        )}
      </div>

      <div className="flex gap-1 mt-2">
        {task.status === "planned" && (
          <Button size="sm" variant="outline" className="text-xs h-6 px-2" onClick={handleClaim} disabled={loading}>
            Claim
          </Button>
        )}
        {(task.status === "claimed" || task.status === "in_progress") && (
          <Button size="sm" variant="outline" className="text-xs h-6 px-2" onClick={handleRelease} disabled={loading}>
            Release
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

function KanbanColumn({
  column,
  tasks,
  onRefresh,
  onSelect,
  onDragStart,
  onDrop,
}: {
  column: typeof COLUMNS[0];
  tasks: BuildTask[];
  onRefresh: () => void;
  onSelect: (t: BuildTask) => void;
  onDragStart: (e: React.DragEvent, task: BuildTask) => void;
  onDrop: (e: React.DragEvent, status: TaskStatus) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`flex-1 min-w-[180px] max-w-[260px] rounded-xl ${column.color} p-3 flex flex-col gap-2 transition-colors ${dragOver ? "ring-2 ring-blue-400" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { setDragOver(false); onDrop(e, column.id); }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {STATUS_ICONS[column.id]}
          {column.label}
        </div>
        <Badge variant="secondary" className="text-xs">{tasks.length}</Badge>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto max-h-[600px]">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onRefresh={onRefresh}
            onSelect={onSelect}
            draggable
            onDragStart={onDragStart}
          />
        ))}
        {tasks.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-4 border-2 border-dashed rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TaskDetailPanel ──────────────────────────────────────────────────────────

function TaskDetailPanel({
  task,
  onClose,
  onRefresh,
}: {
  task: BuildTask;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [output, setOutput] = useState(task.output ?? "");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");

  const handleSubmit = async () => {
    if (!output.trim()) return;
    setLoading(true);
    try {
      await apiFetch(`/build/tasks/${task.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ output }),
      });
      onRefresh();
      onClose();
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubtask = async () => {
    if (!subtaskTitle.trim()) return;
    setLoading(true);
    try {
      await apiFetch(`/build/tasks/${task.id}/subtasks`, {
        method: "POST",
        body: JSON.stringify({ subtasks: [{ title: subtaskTitle }] }),
      });
      setSubtaskTitle("");
      onRefresh();
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (verdict: "approved" | "rejected") => {
    setLoading(true);
    try {
      await apiFetch(`/build/tasks/${task.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId: "user",
          verdict,
          feedback: reviewFeedback || undefined,
        }),
      });
      onRefresh();
      onClose();
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async () => {
    setLoading(true);
    try {
      await apiFetch(`/build/tasks/${task.id}/merge`, {
        method: "POST",
        body: JSON.stringify({ mergedBy: "user" }),
      });
      onRefresh();
      onClose();
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-80 border-l bg-white dark:bg-gray-950 flex flex-col h-full overflow-y-auto p-4 gap-4 shrink-0">
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-sm leading-tight">{task.title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">
          ×
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline">{task.status}</Badge>
        {task.isLocked && <Badge variant="destructive" className="text-xs">Locked</Badge>}
        {task.parentId && <Badge variant="secondary" className="text-xs">subtask of #{task.parentId}</Badge>}
      </div>

      {task.description && (
        <p className="text-xs text-gray-600 dark:text-gray-400">{task.description}</p>
      )}

      {/* Submit output */}
      {(task.status === "claimed" || task.status === "in_progress") && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium">Submit output</label>
          <Textarea
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="Paste your completed work here..."
            rows={4}
            className="text-xs"
          />
          <Button size="sm" onClick={handleSubmit} disabled={loading || !output.trim()}>
            Submit for Review
          </Button>
        </div>
      )}

      {/* Review panel */}
      {task.status === "review" && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium">Review decision</label>
          {task.output && (
            <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded border overflow-auto max-h-32">
              {task.output}
            </pre>
          )}
          <Textarea
            value={reviewFeedback}
            onChange={(e) => setReviewFeedback(e.target.value)}
            placeholder="Feedback (optional)..."
            rows={2}
            className="text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleReview("approved")} disabled={loading} className="flex-1">
              Approve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleReview("rejected")} disabled={loading} className="flex-1">
              Reject
            </Button>
          </div>
        </div>
      )}

      {/* Merge */}
      {task.status === "done" && task.parentId && (
        <Button size="sm" variant="outline" onClick={handleMerge} disabled={loading}>
          Merge into Parent
        </Button>
      )}

      {/* Add subtask */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <label className="text-xs font-medium">Add subtask</label>
        <div className="flex gap-1">
          <Input
            value={subtaskTitle}
            onChange={(e) => setSubtaskTitle(e.target.value)}
            placeholder="Subtask title..."
            className="text-xs h-7"
            onKeyDown={(e) => e.key === "Enter" && handleAddSubtask()}
          />
          <Button size="sm" className="h-7 px-2" onClick={handleAddSubtask} disabled={loading || !subtaskTitle.trim()}>
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Metadata */}
      {task.claimedBy && (
        <p className="text-xs text-gray-500">
          Claimed by <span className="font-mono">{task.claimedBy}</span>
        </p>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function BuildPage() {
  const [tasks, setTasks] = useState<BuildTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState<BuildTask | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [stealAgentId, setStealAgentId] = useState("agent-1");
  const dragTask = useRef<BuildTask | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/build/tasks");
      setTasks(data.tasks ?? []);
    } catch {
      /* ignore auth errors */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const tasksByStatus = useCallback((status: TaskStatus) =>
    tasks.filter((t) => t.status === status && t.parentId === null),
    [tasks],
  );

  const handleCreateTask = async () => {
    if (!newTitle.trim()) return;
    try {
      await apiFetch("/build/tasks", {
        method: "POST",
        body: JSON.stringify({ title: newTitle, description: newDesc || undefined }),
      });
      setNewTitle("");
      setNewDesc("");
      setShowCreateDialog(false);
      loadTasks();
    } catch (e) {
      alert(String(e));
    }
  };

  const handleDragStart = (e: React.DragEvent, task: BuildTask) => {
    dragTask.current = task;
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = async (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    const t = dragTask.current;
    if (!t || t.status === status) return;
    try {
      await apiFetch(`/build/tasks/${t.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      loadTasks();
    } catch (err) {
      alert(String(err));
    }
    dragTask.current = null;
  };

  const handleSteal = async () => {
    try {
      const data = await apiFetch("/build/steal", {
        method: "POST",
        body: JSON.stringify({ agentId: stealAgentId }),
      });
      if (data.task) {
        alert(`Stolen: "${data.task.title}" → claimed by ${stealAgentId}`);
        loadTasks();
      } else {
        alert("No available tasks to steal.");
      }
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white dark:bg-gray-900 shrink-0">
        <div>
          <h1 className="text-lg font-bold">Build</h1>
          <p className="text-xs text-gray-500">Council task graph — {tasks.length} total tasks</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Work stealing */}
          <div className="flex items-center gap-1 border rounded px-2 py-1">
            <Input
              value={stealAgentId}
              onChange={(e) => setStealAgentId(e.target.value)}
              className="h-6 w-24 text-xs border-0 p-0"
              placeholder="agent id"
            />
            <Button size="sm" variant="outline" className="h-6 text-xs px-2 gap-1" onClick={handleSteal}>
              <Shuffle className="w-3 h-3" />
              Steal
            </Button>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={loadTasks}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            className="gap-1"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus className="w-3 h-3" />
            New Task
          </Button>
        </div>
      </div>

      {/* Board + Detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* Kanban */}
        <div className="flex gap-3 p-4 overflow-x-auto flex-1">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              tasks={tasksByStatus(col.id)}
              onRefresh={loadTasks}
              onSelect={(t) => setSelectedTask(t)}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
            />
          ))}
        </div>

        {/* Detail panel */}
        {selectedTask && (
          <TaskDetailPanel
            key={selectedTask.id}
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onRefresh={() => { loadTasks(); setSelectedTask(null); }}
          />
        )}
      </div>

      {/* Create task dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input
              placeholder="Task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateTask()}
            />
            <Textarea
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateTask} disabled={!newTitle.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
