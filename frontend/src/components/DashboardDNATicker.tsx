import { motion } from "framer-motion";
import { Brain, Fingerprint, Dna, GitMerge, ArrowRight } from "lucide-react";

interface Mutation {
  id: string;
  agentName: string;
  changeType: "steering" | "directives" | "knowledge";
  description: string;
  timestamp: string;
}

const MOCK_MUTATIONS: Mutation[] = [
  {
    id: "1",
    agentName: "Architect-v2",
    changeType: "steering",
    description: "Added 'Conflict Mitigation' rule to persona",
    timestamp: "10m ago"
  },
  {
    id: "2",
    agentName: "Analyst-Alpha",
    changeType: "knowledge",
    description: "Coupled with 'Finance Repo v3' kb",
    timestamp: "1h ago"
  },
  {
    id: "3",
    agentName: "Critic-4",
    changeType: "directives",
    description: "Updated system prompt for higher diversity",
    timestamp: "3h ago"
  }
];

export function DashboardDNATicker() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
          <Dna size={14} className="text-[var(--accent-mint)]" />
          Persona Evolution History
        </h3>
        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest px-2 py-0.5 rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)]">
          Iterative DNA
        </span>
      </div>

      <div className="space-y-2">
        {MOCK_MUTATIONS.map((mutation, i) => (
          <motion.div
            key={mutation.id}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.1 }}
            className="surface-card p-4 hover:border-[var(--accent-mint)] transition-colors group cursor-pointer"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[rgba(110,231,183,0.1)] to-[rgba(147,197,253,0.1)] border border-[rgba(255,255,255,0.05)] flex items-center justify-center shrink-0">
                {mutation.changeType === "steering" ? <Fingerprint size={18} className="text-[var(--accent-mint)]" /> :
                 mutation.changeType === "directives" ? <Brain size={18} className="text-[var(--accent-blue)]" /> :
                 <GitMerge size={18} className="text-[var(--accent-gold)]" />}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-[var(--text-primary)] truncate">
                    {mutation.agentName}
                  </h4>
                  <span className="text-[9px] text-[var(--text-muted)] font-mono whitespace-nowrap">
                    {mutation.timestamp}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mt-1 line-clamp-1">
                  {mutation.description}
                </p>
                
                <div className="flex items-center gap-2 mt-2">
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${
                    mutation.changeType === "steering" ? "bg-emerald-500/10 text-emerald-400" :
                    mutation.changeType === "directives" ? "bg-blue-500/10 text-blue-400" :
                    "bg-amber-500/10 text-amber-400"
                  }`}>
                    {mutation.changeType}
                  </span>
                  <div className="flex-1 h-[1px] bg-[var(--border-subtle)]" />
                  <ArrowRight size={10} className="text-[var(--text-muted)] group-hover:text-[var(--accent-mint)] group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
