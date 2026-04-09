import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { Plus, Trash2, Play, Power, PowerOff, Save, Code2 } from "lucide-react";

interface Skill {
  id: string;
  userId: string;
  name: string;
  description: string;
  code: string;
  parameters: Record<string, any>;
  active: boolean;
  createdAt: string;
}

export function SkillsView() {
  const { fetchWithAuth } = useAuth();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [parameters, setParameters] = useState("{}");
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(false);

  // Test state
  const [testInput, setTestInput] = useState("{}");
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const loadSkills = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/skills");
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const selectSkill = useCallback((skill: Skill) => {
    setSelectedId(skill.id);
    setName(skill.name);
    setDescription(skill.description);
    setCode(skill.code);
    setParameters(JSON.stringify(skill.parameters, null, 2));
    setIsNew(false);
    setTestOutput(null);
  }, []);

  const handleNew = useCallback(() => {
    setSelectedId(null);
    setName("");
    setDescription("");
    setCode('# Your Python skill code here\nimport json\n\nresult = {"message": "Hello from skill!"}\nprint(json.dumps(result))');
    setParameters("{}");
    setIsNew(true);
    setTestOutput(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !description.trim() || !code.trim()) return;
    setSaving(true);

    let params: any;
    try { params = JSON.parse(parameters); }
    catch { params = {}; }

    try {
      if (isNew) {
        const res = await fetchWithAuth("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), description: description.trim(), code, parameters: params }),
        });
        if (res.ok) {
          const skill = await res.json();
          setSkills((prev) => [skill, ...prev]);
          setSelectedId(skill.id);
          setIsNew(false);
        }
      } else if (selectedId) {
        const res = await fetchWithAuth(`/api/skills/${selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), description: description.trim(), code, parameters: params }),
        });
        if (res.ok) {
          const updated = await res.json();
          setSkills((prev) => prev.map((s) => s.id === updated.id ? updated : s));
        }
      }
    } finally {
      setSaving(false);
    }
  }, [fetchWithAuth, isNew, selectedId, name, description, code, parameters]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this skill?")) return;
    await fetchWithAuth(`/api/skills/${id}`, { method: "DELETE" });
    setSkills((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setName(""); setDescription(""); setCode(""); setParameters("{}");
      setIsNew(false);
    }
  }, [fetchWithAuth, selectedId]);

  const handleToggle = useCallback(async (skill: Skill) => {
    const res = await fetchWithAuth(`/api/skills/${skill.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !skill.active }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSkills((prev) => prev.map((s) => s.id === updated.id ? updated : s));
    }
  }, [fetchWithAuth]);

  const handleTest = useCallback(async () => {
    if (!selectedId && !isNew) return;
    const id = selectedId;
    if (!id) {
      setTestOutput("Save the skill first before testing.");
      return;
    }

    setTesting(true);
    setTestOutput(null);

    let inputs: any;
    try { inputs = JSON.parse(testInput); }
    catch { inputs = {}; }

    try {
      const res = await fetchWithAuth(`/api/skills/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
      });
      const data = await res.json();
      if (data.success) {
        setTestOutput(typeof data.result === "string" ? data.result : JSON.stringify(data.result, null, 2));
      } else {
        setTestOutput(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setTestOutput(`Error: ${err.message}`);
    } finally {
      setTesting(false);
    }
  }, [fetchWithAuth, selectedId, isNew, testInput]);

  return (
    <div className="h-full flex bg-[var(--bg)] overflow-hidden">
      {/* Left panel: skill list */}
      <div className="w-72 shrink-0 border-r border-[var(--border-subtle)] flex flex-col bg-[var(--bg-surface-1)]">
        <div className="px-4 pt-6 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">Skills</h2>
            <button
              onClick={handleNew}
              className="p-1.5 rounded-lg bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] hover:bg-[rgba(110,231,183,0.15)] transition-colors border border-[rgba(110,231,183,0.12)]"
              title="New Skill"
            >
              <Plus size={14} />
            </button>
          </div>
          <p className="text-[10px] text-[var(--text-muted)]">Custom Python functions for AI</p>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-custom px-2 space-y-0.5">
          {loading ? (
            <div className="text-xs text-[var(--text-muted)] text-center py-8">
              <span className="w-5 h-5 border-2 border-[var(--accent-mint)] border-t-transparent rounded-full animate-spin inline-block" />
            </div>
          ) : skills.length === 0 && !isNew ? (
            <div className="text-center py-8">
              <Code2 size={32} className="mx-auto mb-2 text-[var(--text-muted)] opacity-30" />
              <p className="text-xs text-[var(--text-muted)]">No skills yet</p>
              <button onClick={handleNew} className="text-xs text-[var(--accent-mint)] mt-2 hover:underline">
                Create your first skill
              </button>
            </div>
          ) : (
            skills.map((skill) => (
              <div
                key={skill.id}
                onClick={() => selectSkill(skill)}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-card cursor-pointer transition-all text-sm ${
                  selectedId === skill.id
                    ? "bg-[rgba(110,231,183,0.06)] text-[var(--text-primary)] border border-[rgba(110,231,183,0.12)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)] border border-transparent"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${skill.active ? "bg-[var(--accent-mint)]" : "bg-[var(--text-muted)] opacity-30"}`}
                  style={skill.active ? { boxShadow: '0 0 6px var(--accent-mint)' } : {}}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{skill.name}</p>
                  <p className="text-[10px] text-[var(--text-muted)] truncate">{skill.description}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggle(skill); }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all p-0.5 shrink-0"
                  title={skill.active ? "Disable" : "Enable"}
                >
                  {skill.active ? <Power size={12} className="text-[var(--accent-mint)]" /> : <PowerOff size={12} className="text-[var(--text-muted)]" />}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(skill.id); }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-red-400 transition-all p-0.5 shrink-0"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right panel: editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {(selectedId || isNew) ? (
          <>
            {/* Editor header */}
            <div className="px-6 pt-6 pb-4 border-b border-[var(--border-subtle)] shrink-0 bg-[var(--bg-surface-1)]">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold text-[var(--text-primary)]">
                  {isNew ? "New Skill" : "Edit Skill"}
                </h1>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTest}
                    disabled={testing || isNew}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-button bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)] hover:bg-[rgba(110,231,183,0.15)] transition-colors disabled:opacity-40"
                  >
                    <Play size={12} />
                    {testing ? "Running..." : "Test"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !name.trim() || !description.trim() || !code.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold btn-pill-primary disabled:opacity-40"
                  >
                    <Save size={12} />
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>

            {/* Editor body */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex-1 overflow-y-auto scrollbar-custom p-6 space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my_skill" className="input-base" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Description</label>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this skill do?" className="input-base" />
                </div>
              </div>

              {/* Code editor */}
              <div>
                <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Python Code</label>
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  rows={16}
                  spellCheck={false}
                  className="w-full px-4 py-3 text-sm bg-[var(--code-bg)] border border-[var(--code-border)] rounded-card text-[var(--accent-mint)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[rgba(110,231,183,0.3)] font-mono leading-relaxed resize-none scrollbar-custom"
                  placeholder="# Your Python code here..."
                />
              </div>

              {/* Parameters schema */}
              <div>
                <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1.5 uppercase tracking-widest">Parameters Schema (JSON)</label>
                <textarea
                  value={parameters}
                  onChange={(e) => setParameters(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  className="w-full px-4 py-3 text-sm bg-[var(--code-bg)] border border-[var(--code-border)] rounded-card text-[var(--text-secondary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[rgba(110,231,183,0.3)] font-mono resize-none scrollbar-custom"
                  placeholder='{"input_text": {"type": "string", "description": "Text to process"}}'
                />
              </div>

              {/* Test panel */}
              <div className="surface-card overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--glass-bg)]">
                  <h3 className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Test Panel</h3>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1 uppercase tracking-widest">Test Inputs (JSON)</label>
                    <textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      rows={3}
                      spellCheck={false}
                      className="w-full px-3 py-2 text-xs bg-[var(--code-bg)] border border-[var(--code-border)] rounded-card text-[var(--text-secondary)] font-mono resize-none focus:outline-none focus:border-[rgba(110,231,183,0.3)] scrollbar-custom"
                      placeholder='{"input_text": "hello"}'
                    />
                  </div>
                  {testOutput !== null && (
                    <div>
                      <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1 uppercase tracking-widest">Output</label>
                      <pre className="px-3 py-2 text-xs bg-[var(--code-bg)] border border-[var(--code-border)] rounded-card text-[var(--accent-mint)] font-mono overflow-x-auto max-h-48 whitespace-pre-wrap scrollbar-custom">
                        {testOutput}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Code2 size={48} className="mx-auto mb-3 text-[var(--text-muted)] opacity-20" />
              <p className="text-sm text-[var(--text-secondary)]">Select a skill or create a new one</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Skills are custom Python functions your AI agents can call</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
