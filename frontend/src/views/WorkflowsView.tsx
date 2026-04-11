import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  published: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function WorkflowsView() {
  const { fetchWithAuth } = useAuth();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
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
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Workflows</h1>
        <button
          onClick={() => navigate("/workflows/new")}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={16} /> New Workflow
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading...</div>
      ) : workflows.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="mb-2">No workflows yet</p>
          <p className="text-sm">Create your first workflow to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
            <div key={wf.id} className="bg-white rounded-lg border p-4 flex items-center justify-between hover:shadow-sm transition-shadow">
              <div>
                <h3 className="font-medium text-gray-800">{wf.name}</h3>
                {wf.description && <p className="text-sm text-gray-500 mt-0.5">{wf.description}</p>}
                <div className="flex gap-3 mt-1 text-xs text-gray-400">
                  <span>v{wf.version}</span>
                  <span>{wf.published ? "Published" : "Draft"}</span>
                  <span>{new Date(wf.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => navigate(`/workflows/${wf.id}`)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                  <Pencil size={16} />
                </button>
                <button onClick={() => handleDelete(wf.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
