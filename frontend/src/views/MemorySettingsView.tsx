import { useState, useEffect, useCallback } from "react";
import { Database, HardDrive, Trash2, Zap, RefreshCw } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface BackendInfo {
  type: string;
  url?: string;
  collectionName?: string;
  hasApiKey?: boolean;
  active: boolean;
}

interface MemoryStats {
  chunkCount: number;
  estimatedStorageMB: number;
}

export function MemorySettingsView() {
  const { fetchWithAuth } = useAuth();

  const [backend, setBackend] = useState<BackendInfo>({ type: "local", active: true });
  const [stats, setStats] = useState<MemoryStats>({ chunkCount: 0, estimatedStorageMB: 0 });
  const [selectedType, setSelectedType] = useState("local");
  const [configUrl, setConfigUrl] = useState("");
  const [configApiKey, setConfigApiKey] = useState("");
  const [configCollection, setConfigCollection] = useState("");
  const [saving, setSaving] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<{ originalCount: number; compactedCount: number } | null>(null);

  const loadBackend = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/memory/backend");
      if (res.ok) {
        const data = await res.json();
        setBackend(data);
        setSelectedType(data.type);
        setConfigUrl(data.url || "");
        setConfigCollection(data.collectionName || "");
      }
    } catch (err) {
      console.error("Failed to load backend", err);
    }
  }, [fetchWithAuth]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/memory/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to load stats", err);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadBackend(); loadStats(); }, [loadBackend, loadStats]);

  const handleSaveBackend = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { type: selectedType };
      if (selectedType !== "local") {
        body.config = {
          url: configUrl || undefined,
          apiKey: configApiKey || undefined,
          collectionName: configCollection || undefined,
        };
      }
      const res = await fetchWithAuth("/api/memory/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        loadBackend();
      }
    } catch (err) {
      console.error("Save failed", err);
    } finally {
      setSaving(false);
    }
  };

  const handleCompact = async () => {
    setCompacting(true);
    setCompactResult(null);
    try {
      const res = await fetchWithAuth("/api/memory/compact", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setCompactResult(data);
        loadStats();
      }
    } catch (err) {
      console.error("Compact failed", err);
    } finally {
      setCompacting(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("This will permanently delete ALL your memory chunks. Are you sure?")) return;
    if (!confirm("This action cannot be undone. Type 'DELETE' in the next prompt to confirm.")) return;

    try {
      await fetchWithAuth("/api/memory/all", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE_ALL_MEMORY" }),
      });
      loadStats();
    } catch (err) {
      console.error("Clear failed", err);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Memory Settings</h1>

      {/* Stats */}
      <div className="bg-white rounded-lg border p-4 mb-6">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Database size={16} /> Memory Statistics
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded p-3">
            <div className="text-2xl font-bold text-blue-600">{stats.chunkCount}</div>
            <div className="text-sm text-gray-500">Memory Chunks</div>
          </div>
          <div className="bg-gray-50 rounded p-3">
            <div className="text-2xl font-bold text-green-600">{stats.estimatedStorageMB} MB</div>
            <div className="text-sm text-gray-500">Estimated Storage</div>
          </div>
        </div>
      </div>

      {/* Backend Selector */}
      <div className="bg-white rounded-lg border p-4 mb-6">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <HardDrive size={16} /> Memory Backend
        </h2>
        <div className="mb-3">
          <div className="text-sm text-gray-500 mb-2">
            Current: <span className="font-medium text-gray-700">{backend.type}</span>
            {backend.active && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Active</span>}
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Backend Type</span>
            <select
              className="mt-1 w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              <option value="local">Local (pgvector) - Default</option>
              <option value="qdrant">Qdrant</option>
              <option value="getzep">GetZep</option>
              <option value="google_drive">Google Drive</option>
            </select>
          </label>

          {selectedType !== "local" && (
            <>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">URL</span>
                <input
                  className="mt-1 w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={configUrl}
                  onChange={(e) => setConfigUrl(e.target.value)}
                  placeholder={selectedType === "qdrant" ? "http://localhost:6333" : "https://..."}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">API Key</span>
                <input
                  type="password"
                  className="mt-1 w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={configApiKey}
                  onChange={(e) => setConfigApiKey(e.target.value)}
                  placeholder={backend.hasApiKey ? "••••••• (already set)" : "Enter API key"}
                />
              </label>
              {selectedType === "qdrant" && (
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Collection Name</span>
                  <input
                    className="mt-1 w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                    value={configCollection}
                    onChange={(e) => setConfigCollection(e.target.value)}
                    placeholder="my_collection"
                  />
                </label>
              )}
            </>
          )}

          <button
            onClick={handleSaveBackend}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Backend"}
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-lg border p-4">
        <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Zap size={16} /> Actions
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
            <div>
              <div className="text-sm font-medium">Compact Memory</div>
              <div className="text-xs text-gray-500">Merge similar old memories to save space</div>
            </div>
            <button
              onClick={handleCompact}
              disabled={compacting}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              <RefreshCw size={14} className={compacting ? "animate-spin" : ""} />
              {compacting ? "Compacting..." : "Compact"}
            </button>
          </div>

          {compactResult && (
            <div className="p-3 bg-green-50 rounded text-sm text-green-700">
              Compacted {compactResult.originalCount} chunks into {compactResult.compactedCount} groups
            </div>
          )}

          <div className="flex items-center justify-between p-3 bg-red-50 rounded">
            <div>
              <div className="text-sm font-medium text-red-700">Clear All Memory</div>
              <div className="text-xs text-red-500">Permanently delete all memory chunks</div>
            </div>
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              <Trash2 size={14} /> Clear All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
