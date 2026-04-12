import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Workflow, FileText } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { SkeletonLoader } from "../components/SkeletonLoader";

interface WorkflowItem {
  id: string;
  name: string;
  description: string | null;
  published: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export function WorkflowsView() {
  const { fetchWithAuth } = useAuth();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/workflows");
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this workflow?")) return;
    await fetchWithAuth(`/api/workflows/${id}`, { method: "DELETE" });
    setWorkflows((wfs) => wfs.filter((w) => w.id !== id));
  }, [fetchWithAuth]);

  return (
    <div className="h-full overflow-y-auto scrollbar-custom p-6">
      <div className="max-w-4xl mx-auto">
        <motion.div {...fadeUp} transition={{ duration: 0.3 }} className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Workflows</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Automate multi-step agent pipelines</p>
          </div>
          <button
            onClick={() => navigate("/workflows/new")}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-button btn-pill-primary"
          >
            <Plus size={16} /> New Workflow
          </button>
        </motion.div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonLoader key={i} variant="card" />)}
          </div>
        ) : workflows.length === 0 ? (
          <motion.div {...fadeUp} className="text-center py-16">
            <Workflow size={48} className="mx-auto mb-3 text-[var(--text-muted)] opacity-30" />
            <p className="text-[var(--text-secondary)] text-sm mb-1">No workflows yet</p>
            <p className="text-[var(--text-muted)] text-xs">Create your first workflow to get started</p>
          </motion.div>
        ) : (
          <motion.div
            initial="initial"
            animate="animate"
            variants={{ animate: { transition: { staggerChildren: 0.06 } } }}
            className="space-y-3"
          >
            <AnimatePresence>
              {workflows.map((wf) => (
                <motion.div
                  key={wf.id}
                  variants={fadeUp}
                  exit={{ opacity: 0, x: -20 }}
                  layout
                  className="surface-card p-4 flex items-center justify-between group"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[rgba(110,231,183,0.08)] border border-[rgba(110,231,183,0.12)] flex items-center justify-center text-[var(--accent-mint)] shrink-0 mt-0.5">
                      <FileText size={16} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{wf.name}</h3>
                      {wf.description && <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-1">{wf.description}</p>}
                      <div className="flex gap-3 mt-1.5 text-[10px] text-[var(--text-muted)]">
                        <span className="font-mono">v{wf.version}</span>
                        <span className={`px-1.5 py-0.5 rounded-pill font-bold uppercase tracking-wider ${
                          wf.published
                            ? "bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)]"
                            : "bg-[var(--glass-bg)] text-[var(--text-muted)] border border-[var(--glass-border)]"
                        }`}>
                          {wf.published ? "Published" : "Draft"}
                        </span>
                        <span>{new Date(wf.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => navigate(`/workflows/${wf.id}`)}
                      className="p-2 text-[var(--text-muted)] hover:text-[var(--accent-blue)] hover:bg-[rgba(96,165,250,0.08)] rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(wf.id)}
                      className="p-2 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-400/8 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </div>
  );
}
