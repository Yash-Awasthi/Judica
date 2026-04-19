import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import Editor from "@monaco-editor/react";
import { Plus, Play, Save, Clock, Trash2, Search, Terminal, Cpu, Zap, Activity } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import { StatsHUD } from "../components/StatsHUD";

interface PromptItem {
  id: string;
  name: string;
  content: string;
  version: string;
  lastEdited: string;
  tags: string[];
}

export function PromptIDEView() {
  const { fetchWithAuth } = useAuth();

  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const loadPrompts = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/prompts");
      if (res.ok) {
        const data = await res.json();
        setPrompts(data);
        if (data.length > 0 && !selectedId) {
          setSelectedId(data[0].id);
          setEditorContent(data[0].content);
        }
      }
    } catch (err) {
      console.error("Failed to load prompts", err);
    }
  }, [fetchWithAuth, selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPrompts();
  }, [loadPrompts]);

  const activePrompt = prompts.find((p) => p.id === selectedId);

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/prompts/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editorContent }),
      });
      if (res.ok) {
        loadPrompts();
      }
    } catch (err) {
      console.error("Failed to save prompt", err);
    } finally {
      setSaving(false);
    }
  };

  const createNew = async () => {
    try {
      const res = await fetchWithAuth("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: "New System Directive", 
          content: "// AI Council System Prompt\n\n",
          version: "1.0.0",
          tags: ["general"]
        }),
      });
      if (res.ok) {
        const newPrompt = await res.json();
        setPrompts([newPrompt, ...prompts]);
        setSelectedId(newPrompt.id);
        setEditorContent(newPrompt.content);
      }
    } catch (err) {
      console.error("Failed to create prompt", err);
    }
  };

  const deletePrompt = async (id: string) => {
    if (!confirm("Are you sure?")) return;
    try {
      const res = await fetchWithAuth(`/api/prompts/${id}`, { method: "DELETE" });
      if (res.ok) {
        const nextPrompts = prompts.filter((p) => p.id !== id);
        setPrompts(nextPrompts);
        if (selectedId === id) {
          if (nextPrompts.length > 0) {
            setSelectedId(nextPrompts[0].id);
            setEditorContent(nextPrompts[0].content);
          } else {
            setSelectedId(null);
            setEditorContent("");
          }
        }
      }
    } catch (err) {
      console.error("Failed to delete prompt", err);
    }
  };

  const filteredPrompts = prompts.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full bg-[#000000] overflow-hidden selection:bg-[var(--accent-mint)]/30 relative font-sans">
      <TechnicalGrid />
      
      {/* Sector Header */}
      <SectorHUD 
        sectorId="CODE-02"
        title="Command_Forge_IDE"
        subtitle="Prompt Engineering // Sequential Branching"
        accentColor="var(--accent-mint)"
        telemetry={[
          { label: "BRANCHES", value: String(prompts.length), status: "online" },
          { label: "LATTICE", value: "STABLE", status: "optimal" },
          { label: "UPLINK", value: "SECURE", status: "optimal" }
        ]}
      />

      <div className="flex flex-1 overflow-hidden relative z-10">
      {/* Left: Prompt Registry (Sector-CODE-09-A) */}
      <div className="w-80 border-r border-white/5 bg-black/40 backdrop-blur-3xl flex flex-col relative z-20">
        <div className="absolute top-0 right-0 w-[1px] h-full bg-gradient-to-b from-transparent via-[var(--accent-mint)]/10 to-transparent" />
        
        <div className="p-6 border-b border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] font-diag">System_Directives</h2>
            <button 
              onClick={createNew}
              className="p-2 hover:bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] rounded-xl transition-all hover:scale-105"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="relative group">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-[var(--accent-mint)] transition-colors" />
            <input 
              className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-3 pl-12 pr-4 text-xs font-diag uppercase tracking-tight text-white placeholder:text-white/5 focus:outline-none focus:border-[var(--accent-mint)]/20 transition-all"
              placeholder="FILTER_COMMANDS..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-custom p-4 space-y-2">
          {filteredPrompts.map((p) => (
            <motion.div
              layout
              key={p.id}
              onClick={() => { setSelectedId(p.id); setEditorContent(p.content); }}
              className={`p-5 rounded-3xl border transition-all cursor-pointer group relative overflow-hidden ${
                selectedId === p.id 
                ? "bg-[var(--accent-mint)]/5 border-[var(--accent-mint)]/20 shadow-[0_0_30px_rgba(110,231,183,0.05)]" 
                : "bg-transparent border-transparent hover:border-white/5 hover:bg-white/[0.02]"
              }`}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-black uppercase tracking-tight italic transition-colors ${selectedId === p.id ? "text-white" : "text-white/30 group-hover:text-white/60"}`}>
                    {p.name}
                  </span>
                  <span className="text-[8px] font-diag text-white/10 uppercase tracking-widest">{p.version}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-white/5 border border-white/5 text-[7px] font-diag text-white/20 uppercase tracking-widest">{t}</span>
                  ))}
                </div>
              </div>
              
              <button 
                onClick={(e) => { e.stopPropagation(); deletePrompt(p.id); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 text-red-400/40 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
              >
                <Trash2 size={12} />
              </button>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Main: Forge Terminal (Sector-CODE-09-B) */}
      <div className="flex-1 flex flex-col relative z-10 bg-[#000000]">
        <div className="shrink-0 px-10 py-6 border-b border-white/5 flex items-center justify-between bg-black/20 backdrop-blur-3xl">
          <div className="flex items-center gap-8">
             <div className="flex items-center gap-4">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-mint)] shadow-glow-sm" />
                <h3 className="text-sm font-black text-white italic tracking-tighter uppercase">
                  {activePrompt ? activePrompt.name : "Forge_Terminal_Idle"}
                </h3>
             </div>
             <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.02] border border-white/5">
                    <Clock size={12} className="text-white/20" />
                    <span className="text-[9px] font-diag text-white/20 uppercase tracking-widest">
                       {activePrompt ? new Date(activePrompt.lastEdited).toLocaleTimeString() : "--:--:--"}
                    </span>
                </div>
             </div>
          </div>
          
          <div className="flex items-center gap-4">
             <button 
                onClick={handleSave}
                disabled={saving || !selectedId}
                className={`flex items-center gap-3 px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] transition-all ${
                  saving 
                  ? "bg-white/10 text-white/40" 
                  : "bg-[var(--accent-mint)]/10 border border-[var(--accent-mint)]/40 text-[var(--accent-mint)] hover:bg-[var(--accent-mint)] hover:text-black shadow-[0_0_20px_rgba(110,231,183,0.1)] hover:shadow-[0_0_30px_rgba(110,231,183,0.2)]"
                }`}
             >
                <Save size={14} />
                {saving ? "SYNCING..." : "COMMIT_CHANGES"}
             </button>
             <button className="flex items-center gap-3 px-8 py-3 rounded-2xl bg-white/[0.02] border border-white/5 text-[10px] font-black uppercase tracking-[0.3em] text-white/40 hover:text-white hover:border-white/20 transition-all group">
                <Play size={14} className="group-hover:text-[var(--accent-blue)] transition-colors" fill="currentColor" />
                INIT_TEST_FLIGHT
             </button>
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden group/editor">
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-mint)] opacity-[0.01] blur-[120px] pointer-events-none group-focus-within/editor:opacity-[0.03] transition-opacity duration-1000" />
          {selectedId ? (
            <Editor
              height="100%"
              defaultLanguage="markdown"
              theme="vs-dark"
              value={editorContent}
              onChange={(v) => setEditorContent(v || "")}
              options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  padding: { top: 24, bottom: 24 },
                  fontFamily: "var(--font-mono)",
                  renderLineHighlight: "all",
                  cursorBlinking: "phase",
                  smoothScrolling: true,
                  contextmenu: false,
                  wordWrap: "on",
                  lineDecorationsWidth: 10,
                  hideCursorInOverviewRuler: true,
                  scrollbar: {
                    vertical: "hidden",
                    horizontal: "hidden"
                  }
              }}
              onMount={(editor) => {
                editor.updateOptions({
                    // Custom styles for Monaco
                });
              }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 opacity-20 transition-opacity group-hover/editor:opacity-30 duration-700">
               <div className="w-24 h-24 rounded-[2.5rem] bg-white/[0.02] border border-white/5 flex items-center justify-center shadow-inner">
                  <Terminal size={40} className="text-white" />
               </div>
               <div className="text-center space-y-4">
                  <p className="text-xl font-black italic text-white uppercase tracking-tighter">Forge_Awaiting_Directive</p>
                  <p className="text-[10px] font-diag text-white/40 uppercase tracking-[0.4em]">Select a system branch to begin engineering.</p>
               </div>
            </div>
          )}
        </div>

        {/* HUD Footer Diagnostics */}
        <StatsHUD 
          stats={[
            { label: "LATENCY", value: "12ms", icon: <Zap size={14} />, color: "var(--accent-gold)" },
            { label: "SYNC_INDEX", value: "99.8%", icon: <Activity size={14} />, color: "var(--accent-mint)" },
            { label: "HOST_ID", value: "Core_Neural", icon: <Cpu size={14} />, color: "var(--accent-blue)" }
          ]}
        />
      </div>
      </div>
    </div>
  );
}
