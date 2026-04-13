import { useState, useEffect, useCallback } from "react";
import { Plus, Save, Trash2, User, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface Persona {
  id: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  critiqueStyle: string;
  domain: string;
  aggressiveness?: number;
  isBuiltIn: boolean;
}

interface PersonaBuilderProps {
  onSelect?: (persona: Persona) => void;
}

export function PersonaBuilder({ onSelect }: PersonaBuilderProps) {
  const { fetchWithAuth } = useAuth();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [aggressiveness, setAggressiveness] = useState(5);
  const [domain, setDomain] = useState("");
  const [critiqueStyle, setCritiqueStyle] = useState("evidence_based");
  const [saving, setSaving] = useState(false);

  const loadPersonas = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/personas");
      if (res.ok) {
        const data = await res.json();
        setPersonas(data.personas);
      }
    } catch (err) {
      console.error("Failed to load personas", err);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadPersonas(); }, [loadPersonas]);

  const resetForm = () => {
    setName("");
    setSystemPrompt("");
    setTemperature(0.7);
    setAggressiveness(5);
    setDomain("");
    setCritiqueStyle("evidence_based");
    setEditing(null);
    setShowForm(false);
  };

  const editPersona = (p: Persona) => {
    if (p.isBuiltIn) return;
    setName(p.name);
    setSystemPrompt(p.systemPrompt);
    setTemperature(p.temperature);
    setAggressiveness(p.aggressiveness || 5);
    setDomain(p.domain || "");
    setCritiqueStyle(p.critiqueStyle || "evidence_based");
    setEditing(p);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = { name, systemPrompt, temperature, aggressiveness, domain, critiqueStyle };
      const url = editing ? `/api/personas/${editing.id}` : "/api/personas";
      const method = editing ? "PUT" : "POST";

      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        resetForm();
        loadPersonas();
      }
    } catch (err) {
      console.error("Save failed", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this persona?")) return;
    await fetchWithAuth(`/api/personas/${id}`, { method: "DELETE" });
    loadPersonas();
  };

  const builtIn = personas.filter((p) => p.isBuiltIn);
  const custom = personas.filter((p) => !p.isBuiltIn);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--text-primary)]">Personas</h3>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          <Plus size={14} /> New
        </button>
      </div>

      {/* Built-in */}
      <div>
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Built-in</div>
        <div className="grid grid-cols-2 gap-2">
          {builtIn.map((p) => (
            <div
              key={p.id}
              className="p-3 bg-gray-50 rounded-lg border cursor-pointer hover:border-blue-300 transition-colors"
              onClick={() => onSelect?.(p)}
            >
              <div className="flex items-center gap-2 mb-1">
                <User size={14} className="text-gray-500" />
                <span className="text-sm font-medium">{p.name}</span>
              </div>
              <div className="text-xs text-gray-500">{p.domain} &middot; {p.critiqueStyle}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom */}
      {custom.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">My Personas</div>
          <div className="space-y-2">
            {custom.map((p) => (
              <div
                key={p.id}
                className="p-3 bg-white rounded-lg border flex items-center justify-between group hover:border-blue-300 cursor-pointer"
                onClick={() => onSelect?.(p)}
              >
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-gray-500">{p.domain || "general"} &middot; T:{p.temperature}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); editPersona(p); }} className="p-1 text-gray-400 hover:text-blue-600">
                    <Save size={12} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} className="p-1 text-gray-400 hover:text-red-600">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{editing ? "Edit Persona" : "New Persona"}</h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Name</span>
                <input className="mt-1 w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Data Analyst" />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">System Prompt</span>
                <textarea className="mt-1 w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400 h-32 resize-y" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="You are a..." />
                <span className="text-xs text-gray-400">{systemPrompt.length} chars</span>
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Temperature: {temperature}</span>
                  <input type="range" min="0" max="2" step="0.1" className="w-full mt-1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Aggressiveness: {aggressiveness}</span>
                  <input type="range" min="1" max="10" step="1" className="w-full mt-1" value={aggressiveness} onChange={(e) => setAggressiveness(parseInt(e.target.value))} />
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">Domain</span>
                <input className="mt-1 w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g., science, legal, finance" />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-700">Critique Style</span>
                <select className="mt-1 w-full px-3 py-2 border rounded" value={critiqueStyle} onChange={(e) => setCritiqueStyle(e.target.value)}>
                  <option value="evidence_based">Evidence Based</option>
                  <option value="adversarial">Adversarial</option>
                  <option value="risk_focused">Risk Focused</option>
                  <option value="structural">Structural</option>
                  <option value="methodological">Methodological</option>
                  <option value="clinical">Clinical</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
              <button onClick={handleSave} disabled={saving || !name || !systemPrompt} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                {saving ? "Saving..." : editing ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
