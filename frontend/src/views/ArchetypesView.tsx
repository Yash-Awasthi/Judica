import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Pencil, Trash2, Download, Upload, Star, Copy,
  ChevronDown, ChevronUp, Save, X
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomArchetype {
  id?: string;
  name: string;
  thinkingStyle: string;
  asks: string;
  blindSpot: string;
  systemPrompt: string;
  icon?: string;
  colorBg?: string;
  tools?: string[];
  isCustom?: boolean;
  stars?: number;
  usageCount?: number;
}

const EMPTY: CustomArchetype = {
  name: "",
  thinkingStyle: "",
  asks: "",
  blindSpot: "",
  systemPrompt: "",
  icon: "psychology",
  colorBg: "#6EE7B7",
  tools: [],
};

const PRESET_COLORS = [
  "#6EE7B7", "#93C5FD", "#FCA5A5", "#FCD34D",
  "#A78BFA", "#F472B6", "#34D399", "#FB923C",
];

const AVAILABLE_TOOLS = ["web_search", "read_webpage", "execute_code"];

// ─── Builder Form ─────────────────────────────────────────────────────────────

function ArchetypeForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: CustomArchetype;
  onSave: (a: CustomArchetype) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<CustomArchetype>(initial);
  const set = (k: keyof CustomArchetype, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const toggleTool = (tool: string) => {
    const current = form.tools || [];
    set("tools", current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool]);
  };

  const isValid = form.name.trim() && form.systemPrompt.trim() && form.thinkingStyle.trim();

  return (
    <div className="glass-panel p-6 space-y-5">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">
        {initial.id ? "Edit Archetype" : "New Archetype"}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)]">Name *</label>
          <input
            className="input-base"
            placeholder="e.g. The Skeptic"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)]">Thinking Style *</label>
          <input
            className="input-base"
            placeholder="e.g. Evidence-first, methodical"
            value={form.thinkingStyle}
            onChange={(e) => set("thinkingStyle", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)]">Signature Question</label>
          <input
            className="input-base"
            placeholder="e.g. Where's the proof?"
            value={form.asks}
            onChange={(e) => set("asks", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--text-muted)]">Blind Spot</label>
          <input
            className="input-base"
            placeholder="e.g. Can dismiss intuition"
            value={form.blindSpot}
            onChange={(e) => set("blindSpot", e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-[var(--text-muted)]">System Prompt *</label>
        <textarea
          className="input-base resize-none"
          rows={5}
          placeholder="You are... Your role is... Always ask..."
          value={form.systemPrompt}
          onChange={(e) => set("systemPrompt", e.target.value)}
        />
      </div>

      {/* Color picker */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--text-muted)]">Accent Color</label>
        <div className="flex items-center gap-2 flex-wrap">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Select color ${c}`}
              onClick={() => set("colorBg", c)}
              style={{ background: c }}
              className={`w-7 h-7 rounded-full transition-transform ${
                form.colorBg === c ? "scale-125 ring-2 ring-white/40" : "hover:scale-110"
              }`}
            />
          ))}
          <input
            type="color"
            value={form.colorBg || "#6EE7B7"}
            onChange={(e) => set("colorBg", e.target.value)}
            className="w-7 h-7 rounded-full border border-[var(--border-medium)] cursor-pointer bg-transparent"
            aria-label="Custom color"
          />
        </div>
      </div>

      {/* Tools */}
      <div className="space-y-2">
        <label className="text-xs text-[var(--text-muted)]">Tools</label>
        <div className="flex gap-2 flex-wrap">
          {AVAILABLE_TOOLS.map((tool) => {
            const active = (form.tools || []).includes(tool);
            return (
              <button
                key={tool}
                onClick={() => toggleTool(tool)}
                className={`px-3 py-1 rounded-full text-xs border transition-all ${
                  active
                    ? "bg-[var(--accent-mint)]/10 border-[var(--accent-mint)] text-[var(--accent-mint)]"
                    : "border-[var(--border-medium)] text-[var(--text-muted)] hover:border-[var(--border-medium)]"
                }`}
              >
                {tool}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => isValid && onSave(form)}
          disabled={!isValid || saving}
          className="btn-pill-primary disabled:opacity-40"
        >
          {saving ? (
            <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {initial.id ? "Update" : "Create"}
        </button>
      </div>
    </div>
  );
}

// ─── Archetype Card ───────────────────────────────────────────────────────────

function ArchetypeCard({
  archetype,
  onEdit,
  onDelete,
  onClone,
}: {
  archetype: CustomArchetype;
  onEdit: () => void;
  onDelete: () => void;
  onClone: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="surface-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-black text-xs font-bold"
            style={{ background: archetype.colorBg || "#6EE7B7" }}
          >
            {archetype.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{archetype.name}</p>
            <p className="text-xs text-[var(--text-muted)]">{archetype.thinkingStyle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {archetype.stars !== undefined && (
            <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] mr-2">
              <Star size={11} className="text-[var(--accent-gold)]" />
              {archetype.stars}
            </span>
          )}
          <button onClick={onEdit} aria-label="Edit" className="p-1.5 rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <Pencil size={13} />
          </button>
          <button onClick={onClone} aria-label="Clone" className="p-1.5 rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-blue)] transition-colors">
            <Copy size={13} />
          </button>
          <button onClick={onDelete} aria-label="Delete" className="p-1.5 rounded-lg hover:bg-[var(--glass-bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent-coral)] transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {archetype.asks && (
        <p className="text-xs text-[var(--text-secondary)] italic">"{archetype.asks}"</p>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        {expanded ? "Hide prompt" : "Show prompt"}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <pre className="text-xs text-[var(--text-secondary)] bg-[var(--code-bg)] border border-[var(--code-border)] rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-mono">
              {archetype.systemPrompt}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function ArchetypesView() {
  const { fetchWithAuth } = useAuth();
  const [archetypes, setArchetypes] = useState<CustomArchetype[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<CustomArchetype | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/archetypes");
      if (res.ok) {
        const data = await res.json();
        const list = data.isCustom
          ? Object.values(data.archetypes as Record<string, CustomArchetype>)
          : [];
        setArchetypes(list as CustomArchetype[]);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const handleSave = async (form: CustomArchetype) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/archetypes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        setEditTarget(null);
        load();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this archetype?")) return;
    await fetchWithAuth(`/api/archetypes/${id}`, { method: "DELETE" });
    load();
  };

  const handleClone = async (a: CustomArchetype) => {
    setEditTarget({ ...a, id: undefined, name: `${a.name} (copy)` });
    setShowForm(true);
  };

  const handleExport = async () => {
    const res = await fetchWithAuth("/api/archetypes/export");
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "archetypes.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      const res = await fetchWithAuth("/api/archetypes/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonData: text }),
      });
      if (res.ok) {
        load();
      } else {
        const data = await res.json();
        setImportError(data.message || "Import failed");
      }
    } catch {
      setImportError("Failed to parse import file");
    }
    e.target.value = "";
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-custom p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Custom Archetypes</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Build, manage, and share your own council members
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Import */}
          <label
            className="btn-pill border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-all cursor-pointer"
            title="Import archetypes from JSON"
          >
            <Upload size={14} aria-hidden="true" />
            Import
            <input type="file" accept=".json" className="hidden" onChange={handleImport} />
          </label>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={archetypes.length === 0}
            className="btn-pill border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all disabled:opacity-40"
            title="Export all archetypes as JSON"
          >
            <Download size={14} aria-hidden="true" />
            Export
          </button>

          {/* New */}
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="btn-pill-primary"
          >
            <Plus size={14} aria-hidden="true" />
            New Archetype
          </button>
        </div>
      </div>

      {importError && (
        <div className="text-sm text-[var(--accent-coral)] bg-[var(--accent-coral)]/10 border border-[var(--accent-coral)]/30 rounded-xl px-4 py-3">
          {importError}
        </div>
      )}

      {/* Builder form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <ArchetypeForm
              initial={editTarget || EMPTY}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditTarget(null); }}
              saving={saving}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Archetype list */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="surface-card p-4 h-28 animate-pulse" />
          ))}
        </div>
      ) : archetypes.length === 0 ? (
        <div className="text-center py-20 text-[var(--text-muted)]">
          <p className="text-lg mb-2">No custom archetypes yet</p>
          <p className="text-sm">Click "New Archetype" to build your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {archetypes.map((a, i) => (
            <ArchetypeCard
              key={a.id || i}
              archetype={a}
              onEdit={() => { setEditTarget(a); setShowForm(true); }}
              onDelete={() => a.id && handleDelete(a.id)}
              onClone={() => handleClone(a)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
