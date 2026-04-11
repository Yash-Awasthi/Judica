import { useState, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { Plus, Play, Save, ChevronDown, ChevronRight, Clock, Trash2, Search } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface PromptItem {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  versions: { id: string; versionNum: number; createdAt: string }[];
}

interface PromptVersion {
  id: string;
  versionNum: number;
  content: string;
  model: string | null;
  temperature: number | null;
  notes: string | null;
  createdAt: string;
}

export function PromptIDEView() {
  const { fetchWithAuth } = useAuth();

  // State
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [promptName, setPromptName] = useState("");
  const [model, setModel] = useState("auto");
  const [temperature, setTemperature] = useState(0.7);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [showVersions, setShowVersions] = useState(true);
  const [saveNotes, setSaveNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Test state
  const [testInput, setTestInput] = useState("");
  const [testModel, setTestModel] = useState("");
  const [testTemp, setTestTemp] = useState<number | null>(null);
  const [testOutput, setTestOutput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testLatency, setTestLatency] = useState<number | null>(null);
  const [testUsage, setTestUsage] = useState<{ prompt_tokens?: number; completion_tokens?: number } | null>(null);

  // Load prompt list
  const loadPrompts = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/prompts");
      if (res.ok) {
        const data = await res.json();
        setPrompts(data.prompts);
      }
    } catch (err) {
      console.error("Failed to load prompts", err);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadPrompts(); }, [loadPrompts]);

  // Load versions when prompt selected
  const loadVersions = useCallback(async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/prompts/${id}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions);
      }
    } catch (err) {
      console.error("Failed to load versions", err);
    }
  }, [fetchWithAuth]);

  // Select prompt
  const selectPrompt = useCallback(async (id: string) => {
    setSelectedId(id);
    try {
      const res = await fetchWithAuth(`/api/prompts/${id}`);
      if (res.ok) {
        const data = await res.json();
        setPromptName(data.name);
        if (data.versions?.[0]) {
          setContent(data.versions[0].content);
          setModel(data.versions[0].model || "auto");
          setTemperature(data.versions[0].temperature ?? 0.7);
        }
      }
      loadVersions(id);
    } catch (err) {
      console.error("Failed to load prompt", err);
    }
  }, [fetchWithAuth, loadVersions]);

  // Create new prompt
  const createPrompt = useCallback(async () => {
    const name = `Untitled Prompt ${prompts.length + 1}`;
    try {
      const res = await fetchWithAuth("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content: "Enter your prompt here...", model: "auto" }),
      });
      if (res.ok) {
        const data = await res.json();
        await loadPrompts();
        selectPrompt(data.id);
      }
    } catch (err) {
      console.error("Failed to create prompt", err);
    }
  }, [fetchWithAuth, prompts.length, loadPrompts, selectPrompt]);

  // Save new version
  const saveVersion = useCallback(async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/prompts/${selectedId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          model: model || null,
          temperature,
          notes: saveNotes || null,
        }),
      });
      if (res.ok) {
        setSaveNotes("");
        loadVersions(selectedId);
        loadPrompts();
      }
    } catch (err) {
      console.error("Failed to save version", err);
    } finally {
      setSaving(false);
    }
  }, [selectedId, content, model, temperature, saveNotes, fetchWithAuth, loadVersions, loadPrompts]);

  // Load specific version
  const loadVersion = useCallback(async (versionNum: number) => {
    if (!selectedId) return;
    try {
      const res = await fetchWithAuth(`/api/prompts/${selectedId}/versions/${versionNum}`);
      if (res.ok) {
        const data = await res.json();
        setContent(data.content);
        if (data.model) setModel(data.model);
        if (data.temperature !== null) setTemperature(data.temperature);
      }
    } catch (err) {
      console.error("Failed to load version", err);
    }
  }, [selectedId, fetchWithAuth]);

  // Delete prompt
  const deletePrompt = useCallback(async (id: string) => {
    if (!confirm("Delete this prompt and all its versions?")) return;
    try {
      await fetchWithAuth(`/api/prompts/${id}`, { method: "DELETE" });
      if (selectedId === id) {
        setSelectedId(null);
        setContent("");
        setPromptName("");
        setVersions([]);
      }
      loadPrompts();
    } catch (err) {
      console.error("Failed to delete prompt", err);
    }
  }, [fetchWithAuth, selectedId, loadPrompts]);

  // Test prompt
  const runTest = useCallback(async () => {
    setTesting(true);
    setTestOutput("");
    setTestLatency(null);
    setTestUsage(null);
    try {
      const res = await fetchWithAuth("/api/prompts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          model: testModel || model,
          temperature: testTemp ?? temperature,
          test_input: testInput || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestOutput(data.response);
        setTestLatency(data.latency_ms);
        setTestUsage(data.usage || null);
      } else {
        const err = await res.json().catch(() => ({ error: "Test failed" }));
        setTestOutput(`Error: ${err.error || res.statusText}`);
      }
    } catch (err) {
      setTestOutput(`Error: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  }, [content, model, temperature, testInput, testModel, testTemp, fetchWithAuth]);

  const filteredPrompts = prompts.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full bg-gray-50">
      {/* Left: Prompt List */}
      <div className="w-64 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-3 border-b border-gray-200">
          <button
            onClick={createPrompt}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
          >
            <Plus size={14} /> New Prompt
          </button>
        </div>
        <div className="px-3 py-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-gray-400" />
            <input
              className="w-full pl-7 pr-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredPrompts.map((p) => (
            <div
              key={p.id}
              className={`px-3 py-2 cursor-pointer border-b border-gray-100 flex items-center justify-between group ${
                selectedId === p.id ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
              onClick={() => selectPrompt(p.id)}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{p.name}</div>
                <div className="text-xs text-gray-400">
                  v{p.versions?.[0]?.versionNum || 1}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deletePrompt(p.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Center: Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedId ? (
          <>
            <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center gap-3">
              <input
                className="text-lg font-semibold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none px-1 flex-1"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
              />
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <select
                  className="px-2 py-1 border rounded text-sm"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  <option value="auto">auto</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
                  <option value="claude-haiku-4-20250414">claude-haiku-4</option>
                  <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                </select>
                <span className="text-xs text-gray-400">T:{temperature}</span>
                <input
                  type="range" min="0" max="2" step="0.1"
                  className="w-20"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                />
              </div>
            </div>
            <div className="flex-1">
              <Editor
                height="100%"
                language="markdown"
                value={content}
                onChange={(val) => setContent(val || "")}
                theme="vs-light"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  wordWrap: "on",
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  padding: { top: 16 },
                }}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-lg mb-2">Select a prompt to edit</p>
              <p className="text-sm">or create a new one</p>
            </div>
          </div>
        )}
      </div>

      {/* Right: Test Panel + Versions */}
      <div className="w-80 border-l border-gray-200 bg-white flex flex-col">
        {/* Test Panel */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <h3 className="font-semibold text-sm text-gray-700 mb-3">Test</h3>
          <textarea
            className="w-full px-3 py-2 text-sm border rounded resize-none h-20 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Test input (replaces {{input}})..."
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
          />
          <div className="flex items-center gap-2 mt-2">
            <select
              className="flex-1 px-2 py-1 text-xs border rounded"
              value={testModel}
              onChange={(e) => setTestModel(e.target.value)}
            >
              <option value="">Use default</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
              <option value="gemini-2.0-flash">gemini-flash</option>
            </select>
            <button
              onClick={runTest}
              disabled={testing || !selectedId}
              className="flex items-center gap-1 px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              <Play size={12} /> {testing ? "..." : "Run"}
            </button>
          </div>
          {(testLatency !== null || testUsage) && (
            <div className="flex gap-2 mt-2">
              {testLatency !== null && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{testLatency}ms</span>
              )}
              {testUsage && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {testUsage.prompt_tokens || 0}+{testUsage.completion_tokens || 0} tokens
                </span>
              )}
            </div>
          )}
          {testOutput && (
            <div className="mt-3 bg-gray-50 border rounded p-3 text-xs max-h-48 overflow-y-auto whitespace-pre-wrap">
              {testOutput}
            </div>
          )}
        </div>

        {/* Version History */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <button
            onClick={() => setShowVersions(!showVersions)}
            className="flex items-center gap-1 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 border-b"
          >
            {showVersions ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Clock size={14} /> Version History
          </button>
          {showVersions && selectedId && (
            <div className="flex-1 overflow-y-auto">
              <div className="p-3 border-b border-gray-100">
                <input
                  className="w-full px-2 py-1 text-sm border rounded mb-2"
                  placeholder="Version notes (optional)"
                  value={saveNotes}
                  onChange={(e) => setSaveNotes(e.target.value)}
                />
                <button
                  onClick={saveVersion}
                  disabled={saving || !content}
                  className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save size={12} /> {saving ? "Saving..." : "Save Version"}
                </button>
              </div>
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="px-3 py-2 border-b border-gray-100 cursor-pointer hover:bg-blue-50"
                  onClick={() => loadVersion(v.versionNum)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">v{v.versionNum}</span>
                    <span className="text-xs text-gray-400">{new Date(v.createdAt).toLocaleString()}</span>
                  </div>
                  {v.notes && <div className="text-xs text-gray-500 mt-0.5">{v.notes}</div>}
                  {v.model && <div className="text-xs text-gray-400 mt-0.5">{v.model}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
