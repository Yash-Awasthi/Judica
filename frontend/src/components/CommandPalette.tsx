import * as React from 'react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, Workflow, Code2, 
  Database, BarChart3, Store, Brain, Settings, Shield,
  Plus, Layout as LayoutIcon, ArrowRight, Sparkles, Command
} from "lucide-react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface CommandItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  category: "navigation" | "action" | "recent";
  onSelect: () => void;
  shortcut?: string;
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const toggle = useCallback(() => {
    setIsOpen(v => !v);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  const commands: CommandItem[] = useMemo(() => [
    { 
      id: "new-chat", 
      icon: <Plus size={16} />, 
      label: "Start New Deliberation", 
      description: "Initialize a new multi-agent council", 
      category: "action",
      onSelect: () => navigate("/chat"),
      shortcut: "N"
    },
    { 
      id: "nav-dashboard", 
      icon: <LayoutIcon size={16} />, 
      label: "Go to Dashboard", 
      description: "Mission Control overview", 
      category: "navigation",
      onSelect: () => navigate("/")
    },
    { 
      id: "nav-workflows", 
      icon: <Workflow size={16} />, 
      label: "Workflows", 
      description: "Manage agent pipelines", 
      category: "navigation",
      onSelect: () => navigate("/workflows")
    },
    { 
      id: "nav-prompts", 
      icon: <Code2 size={16} />, 
      label: "Prompt IDE", 
      description: "Refine agent instructions", 
      category: "navigation",
      onSelect: () => navigate("/prompts")
    },
    { 
      id: "nav-training", 
      icon: <Brain size={16} />, 
      label: "Training Lab", 
      description: "Evolve agent DNA", 
      category: "navigation",
      onSelect: () => navigate("/training")
    },
    { 
      id: "nav-benchmarks", 
      icon: <BarChart3 size={16} />, 
      label: "Arena Benchmarks", 
      description: "Agent conflict & consensus reports", 
      category: "navigation",
      onSelect: () => navigate("/benchmarks")
    },
    { 
      id: "nav-marketplace", 
      icon: <Store size={16} />, 
      label: "Marketplace", 
      description: "Explore community agents", 
      category: "navigation",
      onSelect: () => navigate("/marketplace")
    },
    { 
      id: "nav-repos", 
      icon: <Database size={16} />, 
      label: "Knowledge Base", 
      description: "Manage RAG repositories", 
      category: "navigation",
      onSelect: () => navigate("/repos")
    },
    { 
      id: "nav-admin", 
      icon: <Shield size={16} />, 
      label: "Admin Panel", 
      description: "System configuration", 
      category: "navigation",
      onSelect: () => navigate("/admin")
    },
    { 
      id: "nav-settings", 
      icon: <Settings size={16} />, 
      label: "Settings", 
      description: "User preferences", 
      category: "navigation",
      onSelect: () => navigate("/settings")
    },
  ], [navigate]);

  const filteredLines = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(c => 
      c.label.toLowerCase().includes(q) || 
      c.description.toLowerCase().includes(q)
    );
  }, [commands, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(v => (v + 1) % filteredLines.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(v => (v - 1 + filteredLines.length) % filteredLines.length);
    } else if (e.key === "Enter" && filteredLines[selectedIndex]) {
      e.preventDefault();
      filteredLines[selectedIndex].onSelect();
      setIsOpen(false);
    }
  };

  const trapRef = useFocusTrap(() => setIsOpen(false));

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh] px-4 pointer-events-none">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
          />
          
          <motion.div
            ref={trapRef}
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full max-w-xl glass-panel relative z-10 overflow-hidden pointer-events-auto shadow-2xl"
            onKeyDown={handleKeyDown}
          >
            {/* Search Header */}
            <div className="flex items-center px-4 py-4 border-b border-[var(--border-subtle)] bg-white/5">
              <Search size={20} className="text-[var(--text-muted)] mr-3" />
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Type a command or search..."
                className="flex-1 bg-transparent border-none outline-none text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--glass-bg)] border border-[var(--glass-border)]">
                <span className="text-[10px] font-bold text-[var(--text-muted)]">ESC</span>
              </div>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto scrollbar-custom py-2">
              {filteredLines.length > 0 ? (
                <>
                  {["action", "navigation"].map(cat => {
                    const items = filteredLines.filter(f => f.category === cat);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="px-4 py-2">
                          <span className="text-[10px] uppercase tracking-widest font-bold text-[var(--text-muted)]">
                            {cat === 'action' ? 'Actions' : 'Navigation'}
                          </span>
                        </div>
                        {items.map((cmd) => {
                          const globalIdx = filteredLines.indexOf(cmd);
                          const isActive = globalIdx === selectedIndex;
                          return (
                            <button
                              key={cmd.id}
                              onClick={() => { cmd.onSelect(); setIsOpen(false); }}
                              onMouseEnter={() => setSelectedIndex(globalIdx)}
                              className={`w-full flex items-center px-4 py-3 text-left transition-colors relative group ${
                                isActive ? 'bg-[var(--glass-bg-hover)]' : ''
                              }`}
                            >
                              {isActive && (
                                <motion.div 
                                  layoutId="active-bar"
                                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-[var(--accent-mint)]" 
                                />
                              )}
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mr-3 transition-colors ${
                                isActive ? 'bg-[rgba(110,231,183,0.1)] text-[var(--accent-mint)]' : 'bg-[var(--glass-bg)] text-[var(--text-muted)]'
                              }`}>
                                {cmd.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className={`block text-sm font-semibold ${isActive ? 'text-[var(--accent-mint)]' : 'text-[var(--text-primary)]'}`}>
                                  {cmd.label}
                                </span>
                                <span className="block text-xs text-[var(--text-muted)] truncate italic">
                                  {cmd.description}
                                </span>
                              </div>
                              {cmd.shortcut && (
                                <div className="text-[10px] font-bold text-[var(--text-muted)] bg-[var(--glass-bg)] border border-[var(--glass-border)] px-1.5 py-0.5 rounded ml-2">
                                  {cmd.shortcut}
                                </div>
                              )}
                              <ArrowRight size={14} className={`ml-2 transition-all ${
                                isActive ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'
                              } text-[var(--accent-mint)]`} />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="py-12 text-center text-[var(--text-muted)]">
                  <Sparkles size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No commands found for "{query}"</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] flex items-center justify-center">
                    <span className="text-[8px] font-bold text-[var(--text-muted)]">↑</span>
                  </div>
                  <div className="w-4 h-4 rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] flex items-center justify-center">
                    <span className="text-[8px] font-bold text-[var(--text-muted)]">↓</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">Navigate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="px-1 py-0.5 rounded bg-[var(--glass-bg)] border border-[var(--glass-border)] flex items-center justify-center min-w-[32px]">
                    <span className="text-[8px] font-bold text-[var(--text-muted)]">ENTER</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">Select</span>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] font-bold italic opacity-50">
                <Command size={10} />
                <span>COMMAND CENTER v2</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
