import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { Plus, Trash2, Play, Power, PowerOff, Save } from "lucide-react";

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
    try {
      params = JSON.parse(parameters);
    } catch {
      params = {};
    }

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
      setName("");
      setDescription("");
      setCode("");
      setParameters("{}");
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
    try {
      inputs = JSON.parse(testInput);
    } catch {
      inputs = {};
    }

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
    <div className="h-full flex bg-[#030303] overflow-hidden">
      {/* Left panel: skill list */}
      <div className="w-72 shrink-0 border-r border-white/[0.04] flex flex-col">
        <div className="px-4 pt-6 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-text">Skills</h2>
            <button
              onClick={handleNew}
              className="p-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
              title="New Skill"
            >
              <Plus size={14} />
            </button>
          </div>
          <p className="text-[10px] text-text-dim">Custom Python functions for AI</p>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {loading ? (
            <div className="text-xs text-text-dim text-center py-8">Loading...</div>
          ) : skills.length === 0 && !isNew ? (
            <div className="text-center py-8">
              <span className="material-symbols-outlined text-[32px] text-text-dim/30 block mb-2">code</span>
              <p className="text-xs text-text-dim">No skills yet</p>
              <button onClick={handleNew} className="text-xs text-accent mt-2 hover:underline">
                Create your first skill
              </button>
            </div>
          ) : (
            skills.map((skill) => (
              <div
                key={skill.id}
                onClick={() => selectSkill(skill)}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-sm ${
                  selectedId === skill.id
                    ? "bg-accent/5 text-text border border-accent/10"
                    : "text-text-muted hover:bg-white/[0.04] hover:text-text border border-transparent"
                }`}
              >
                <span className={`material-symbols-outlined text-[16px] ${skill.active ? "text-success" : "text-text-dim/30"}`}>
                  {skill.active ? "radio_button_checked" : "radio_button_unchecked"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{skill.name}</p>
                  <p className="text-[10px] text-text-dim truncate">{skill.description}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(skill);
                  }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all p-0.5 shrink-0"
                  title={skill.active ? "Disable" : "Enable"}
                >
                  {skill.active ? <Power size={12} className="text-success" /> : <PowerOff size={12} className="text-text-dim" />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(skill.id);
                  }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-danger transition-all p-0.5 shrink-0"
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
            <div className="px-6 pt-6 pb-4 border-b border-white/[0.04] shrink-0">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold text-text">
                  {isNew ? "New Skill" : "Edit Skill"}
                </h1>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTest}
                    disabled={testing || isNew}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                  >
                    <Play size={12} />
                    {testing ? "Running..." : "Test"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !name.trim() || !description.trim() || !code.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-black hover:bg-accent/90 transition-colors disabled:opacity-40"
                  >
                    <Save size={12} />
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>

            {/* Editor body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my_skill"
                    className="w-full px-3 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg text-text placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Description</label>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this skill do?"
                    className="w-full px-3 py-2 text-sm bg-white/[0.03] border border-white/[0.06] rounded-lg text-text placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30"
                  />
                </div>
              </div>

              {/* Code editor */}
              <div>
                <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Python Code</label>
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  rows={16}
                  spellCheck={false}
                  className="w-full px-4 py-3 text-sm bg-[#0a0a0a] border border-white/[0.06] rounded-xl text-emerald-300 placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 font-mono leading-relaxed resize-none"
                  placeholder="# Your Python code here..."
                />
              </div>

              {/* Parameters schema */}
              <div>
                <label className="block text-[11px] font-medium text-text-dim mb-1.5 uppercase tracking-wider">Parameters Schema (JSON)</label>
                <textarea
                  value={parameters}
                  onChange={(e) => setParameters(e.target.value)}
                  rows={4}
                  spellCheck={false}
                  className="w-full px-4 py-3 text-sm bg-[#0a0a0a] border border-white/[0.06] rounded-xl text-text-muted placeholder:text-text-dim/50 focus:outline-none focus:border-accent/30 font-mono resize-none"
                  placeholder='{"input_text": {"type": "string", "description": "Text to process"}}'
                />
              </div>

              {/* Test panel */}
              <div className="border border-white/[0.06] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-white/[0.02] border-b border-white/[0.04]">
                  <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider">Test Panel</h3>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-[10px] font-medium text-text-dim mb-1 uppercase tracking-wider">Test Inputs (JSON)</label>
                    <textarea
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      rows={3}
                      spellCheck={false}
                      className="w-full px-3 py-2 text-xs bg-[#0a0a0a] border border-white/[0.06] rounded-lg text-text-muted font-mono resize-none focus:outline-none focus:border-accent/30"
                      placeholder='{"input_text": "hello"}'
                    />
                  </div>
                  {testOutput !== null && (
                    <div>
                      <label className="block text-[10px] font-medium text-text-dim mb-1 uppercase tracking-wider">Output</label>
                      <pre className="px-3 py-2 text-xs bg-[#0a0a0a] border border-white/[0.06] rounded-lg text-emerald-300 font-mono overflow-x-auto max-h-48 whitespace-pre-wrap">
                        {testOutput}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <span className="material-symbols-outlined text-[48px] text-text-dim/20 block mb-3">code</span>
              <p className="text-sm text-text-muted">Select a skill or create a new one</p>
              <p className="text-xs text-text-dim mt-1">Skills are custom Python functions your AI agents can call</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
