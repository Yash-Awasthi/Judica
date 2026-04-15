import { motion } from "framer-motion";
import { Award, Star, TrendingUp, BarChart3 } from "lucide-react";

import { TopPerformersSkeleton } from "./LoadingSkeletons";

interface AgentPerformance {
  id: string;
  name: string;
  archetype: string;
  consensusScore: number;
  qualityScore: number;
  trend: "up" | "down" | "stable";
}

const MOCK_PERFORMERS: AgentPerformance[] = [
  {
    id: "1",
    name: "Logic-7b-Pro",
    archetype: "Lead Researcher",
    consensusScore: 98,
    qualityScore: 94,
    trend: "up"
  },
  {
    id: "2",
    name: "GPT-4o",
    archetype: "System Architect",
    consensusScore: 95,
    qualityScore: 96,
    trend: "stable"
  },
  {
    id: "3",
    name: "Claude 3.5 Sonnet",
    archetype: "Creative Strategist",
    consensusScore: 92,
    qualityScore: 98,
    trend: "up"
  }
];

export function DashboardTopPerformingAgents({ loading }: { loading?: boolean }) {
  if (loading) return <TopPerformersSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-black text-white uppercase tracking-[0.2em] flex items-center gap-2">
          <Award size={14} className="text-[var(--accent-gold)] drop-shadow-[0_0_8px_rgba(255,215,0,0.4)]" />
          Benchmark Leaders
        </h3>
        <button className="text-[9px] font-black text-[var(--accent-mint)] uppercase tracking-[0.2em] hover:text-white transition-colors flex items-center gap-1.5 opacity-80 hover:opacity-100">
          Arena Reports <BarChart3 size={10} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {MOCK_PERFORMERS.map((agent, i) => (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => window.location.hash = '#/marketplace'}
            className="group relative cursor-pointer"
          >
            {/* Background Layer with Glass Effect */}
            <div className={`absolute inset-0 holographic-panel rounded-2xl transition-all duration-500 group-hover:bg-white/[0.04] group-hover:border-[var(--accent-mint)]/30 border-white/[0.03] overflow-hidden ${i === 0 ? "shadow-[0_0_25px_rgba(255,215,0,0.05)] border-[var(--accent-gold)]/20" : ""}`}>
              {/* Corner Accents */}
              <div className="absolute top-0 left-0 w-4 h-[1px] bg-[var(--accent-mint)] opacity-20" />
              <div className="absolute top-0 left-0 w-[1px] h-4 bg-[var(--accent-mint)] opacity-20" />
            </div>
            
            {/* Status Ribbing (left side) */}
            <div className={`absolute left-0 top-4 bottom-4 w-1 rounded-full transition-all duration-500 ${i === 0 ? "bg-[var(--accent-gold)] shadow-[0_0_10px_var(--accent-gold)]" : "bg-[var(--accent-mint)] opacity-10 group-hover:opacity-100 group-hover:shadow-[0_0_8px_var(--accent-mint)]"}`} />

            <div className="relative p-4 pl-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[7px] uppercase tracking-[0.3em] text-[var(--text-muted)] font-black font-diag">
                      {agent.archetype} // Class
                    </p>
                    {i === 0 && (
                      <span className="text-[7px] bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] px-1.5 py-0.5 rounded-full font-black uppercase tracking-widest border border-[var(--accent-gold)]/20">
                        Elite Tier
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-black text-white mt-1 group-hover:text-[var(--accent-mint)] transition-colors tracking-tight">
                    {agent.name}
                  </h4>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <span className={`text-2xl font-black tracking-tighter ${i === 0 ? "text-[var(--accent-gold)] shadow-glow" : "text-[var(--accent-mint)]"}`}>
                      {agent.consensusScore}%
                    </span>
                    {agent.trend === "up" && <TrendingUp size={12} className="text-[var(--accent-mint)] drop-shadow-[0_0_5px_rgba(110,231,183,0.5)]" />}
                  </div>
                  <p className="text-[8px] text-[var(--text-muted)] font-black uppercase tracking-widest mt-0.5">
                     Integrity Index
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-[9px] font-mono tracking-wider">
                  <span className="text-[var(--text-muted)] uppercase">Quality Baseline</span>
                  <span className="text-white opacity-60">{agent.qualityScore}% Verified</span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden relative">
                  {/* Background scanning gradient */}
                  <div className="absolute inset-0 opacity-20 bg-gradient-to-r from-transparent via-white to-transparent -translate-x-full group-hover:animate-shimmer" />
                  
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${agent.qualityScore}%` }}
                    transition={{ duration: 1.5, ease: "circOut", delay: i * 0.2 }}
                    className={`h-full relative ${i === 0 ? "bg-gradient-to-r from-[var(--accent-gold)] to-[#FFD700]" : "bg-gradient-to-r from-[var(--accent-mint)] to-[var(--accent-blue)]"}`}
                  >
                    {/* Head glow */}
                    <div className="absolute right-0 top-0 bottom-0 w-4 bg-white/40 blur-sm" />
                  </motion.div>
                </div>
              </div>

              {/* Technical Detail Footer (Visible on Hover) */}
              <div className="mt-4 pt-3 border-t border-white/[0.03] flex items-center justify-between opacity-0 group-hover:opacity-100 transition-all transform translate-y-1 group-hover:translate-y-0">
                 <div className="flex gap-2">
                   <div className="w-1.5 h-1.5 rounded-sm bg-white/10" />
                   <div className="w-1.5 h-1.5 rounded-sm bg-white/10" />
                   <div className="w-1.5 h-1.5 rounded-sm bg-white/20" />
                 </div>
                 <span className="text-[8px] font-black tracking-[0.2em] text-[var(--accent-mint)] uppercase flex items-center gap-1.5">
                   Request Deployment <Star size={8} />
                 </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
