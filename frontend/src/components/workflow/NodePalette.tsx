import { motion } from "framer-motion";
import { Brain, Wrench, GitBranch, FileText, Code, Globe, UserCheck, Repeat, ArrowRightCircle, ArrowLeftCircle, Merge, Split } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";

const NODE_GROUPS = [
  {
    label: "I/O",
    items: [
      { type: "input", label: "Input", icon: ArrowRightCircle, color: "text-[var(--accent-mint)]", glow: "shadow-[0_0_10px_rgba(110,231,183,0.2)]" },
      { type: "output", label: "Output", icon: ArrowLeftCircle, color: "text-red-400", glow: "shadow-[0_0_10px_rgba(239,68,68,0.2)]" },
    ],
  },
  {
    label: "Neural",
    items: [
      { type: "llm", label: "LLM", icon: Brain, color: "text-purple-400", glow: "shadow-[0_0_10px_rgba(168,85,247,0.2)]" },
    ],
  },
  {
    label: "Utility",
    items: [
      { type: "tool", label: "Tool", icon: Wrench, color: "text-orange-400", glow: "shadow-[0_0_10px_rgba(251,146,60,0.2)]" },
      { type: "http", label: "HTTP", icon: Globe, color: "text-[var(--accent-blue)]", glow: "shadow-[0_0_10px_rgba(59,130,246,0.2)]" },
      { type: "code", label: "Code", icon: Code, color: "text-gray-400", glow: "shadow-[0_0_10px_rgba(156,163,175,0.2)]" },
    ],
  },
  {
    label: "Context",
    items: [
      { type: "condition", label: "Logic", icon: GitBranch, color: "text-yellow-400", glow: "shadow-[0_0_10px_rgba(250,204,21,0.2)]" },
      { type: "template", label: "Prompt", icon: FileText, color: "text-teal-400", glow: "shadow-[0_0_10px_rgba(45,212,191,0.2)]" },
      { type: "loop", label: "Cycle", icon: Repeat, color: "text-indigo-400", glow: "shadow-[0_0_10px_rgba(129,140,248,0.2)]" },
    ],
  },
  {
    label: "Flow",
    items: [
      { type: "human_gate", label: "Gate", icon: UserCheck, color: "text-pink-400", glow: "shadow-[0_0_10px_rgba(244,114,182,0.2)]" },
      { type: "merge", label: "Merge", icon: Merge, color: "text-slate-400", glow: "shadow-[0_0_10px_rgba(148,163,184,0.2)]" },
      { type: "split", label: "Split", icon: Split, color: "text-slate-400", glow: "shadow-[0_0_10px_rgba(148,163,184,0.2)]" },
    ],
  },
];

export function NodePalette() {
  const handleDragStart = (event: DragEvent<HTMLDivElement>, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, nodeType: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const customEvent = new CustomEvent("nodePaletteAdd", {
        detail: { nodeType },
        bubbles: true,
      });
      event.currentTarget.dispatchEvent(customEvent);
    }
  };

  return (
    <div className="w-64 border-r border-[var(--glass-border)] bg-[rgba(15,15,15,0.7)] backdrop-blur-xl p-5 overflow-y-auto scrollbar-custom z-30">
      <div className="flex items-center gap-2 mb-8">
        <div className="w-2 h-2 rounded-full bg-[var(--accent-mint)] animate-pulse shadow-[0_0_10px_var(--accent-mint)]" />
        <h3 className="font-black text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)] italic">Neural Modules</h3>
      </div>
      
      {NODE_GROUPS.map((group) => (
        <div key={group.label} className="mb-8">
          <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.2em] mb-4 opacity-40 px-1">{group.label}</div>
          <div className="grid grid-cols-2 gap-2" role="list" aria-label={group.label}>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.type}
                  whileHover={{ y: -2, scale: 1.02 }}
                  whileTap={{ scale: 0.95 }}
                  className={`flex flex-col items-center justify-center gap-2 p-3 bg-[var(--bg-surface-3)] border border-[var(--glass-border)] rounded-2xl cursor-grab hover:border-[var(--accent-mint)]/30 hover:bg-[rgba(255,255,255,0.02)] transition-all ${item.glow} group`}
                  draggable
                  role="listitem"
                  tabIndex={0}
                  aria-label={`Add ${item.label} node`}
                  onDragStart={(e: any) => handleDragStart(e, item.type)}
                  onKeyDown={(e) => onKeyDown(e, item.type)}
                >
                  <div className={`p-2 rounded-xl bg-[rgba(255,255,255,0.03)] group-hover:bg-transparent ${item.color} transition-colors`}>
                    <Icon size={18} strokeWidth={2.5} />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">{item.label}</span>
                </motion.div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
