import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Zap, Clock, Settings, ArrowRight, Trash2, Cpu } from "lucide-react";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import { StatsHUD } from "../components/StatsHUD";

interface Workflow {
  id: string;
  name: string;
  description: string;
  status: "ACTIVE" | "INACTIVE" | "IDLE";
  steps: number;
  lastRun: string;
  successRate: number;
}

export function WorkflowsView() {
  const [workflows, _setWorkflows] = useState<Workflow[]>([
    { id: "1", name: "Data_Ingestion_Protocol", description: "Automated indexing of neural vector repositories from Sector-INTEL.", status: "ACTIVE", steps: 8, lastRun: "2m ago", successRate: 99.2 },
    { id: "2", name: "Model_Self_Evaluation", description: "Periodic simulation and benchmarking of active LLM units.", status: "IDLE", steps: 12, lastRun: "1h ago", successRate: 98.5 },
    { id: "3", name: "Entropy_Correction_Loop", description: "Detect and stabilize halluncination patterns in latent outputs.", status: "ACTIVE", steps: 5, lastRun: "30s ago", successRate: 100 },
  ]);

  const [isCreating, setIsCreating] = useState(false);

  const activeCount = workflows.filter(w => w.status === "ACTIVE").length;

  return (
    <div className="relative min-h-screen bg-[#000000] overflow-hidden">
      <TechnicalGrid />
      
      <div className="relative z-10 h-full overflow-y-auto scrollbar-custom p-4 lg:p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-7xl mx-auto space-y-12 pb-24"
        >
          {/* Sector Header */}
          <SectorHUD 
            sectorId="PROT-04"
            title="Protocol_Hub"
            subtitle="Autonomous Logic Sequences // Distributed Orchestration"
            accentColor="var(--accent-gold)"
            telemetry={[
              { label: "ACTIVE_FLUX", value: activeCount.toString(), status: "optimal" },
              { label: "SUCCESS_RATIO", value: "99.4%", status: "online" },
              { label: "UPLINK", value: "SECURE", status: "optimal" }
            ]}
          />

          <div className="flex justify-between items-center bg-white/[0.02] border border-white/5 p-6 rounded-[2rem] backdrop-blur-3xl">
            <div className="flex items-center gap-4">
              <div className="w-2 h-2 rounded-full bg-[var(--accent-gold)] animate-ping" />
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 font-diag">System Status: Nominal</span>
            </div>
            <button 
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-3 px-8 h-12 rounded-xl bg-[var(--accent-gold)] text-black font-black uppercase tracking-widest text-[10px] shadow-[0_0_20px_rgba(251,191,36,0.3)] hover:scale-105 active:scale-95 transition-all"
            >
              <Plus size={16} />
              INIT_PROTOCOL
            </button>
          </div>
        

        {/* ━━━ Protocol Grid ━━━ */}
        <div className="grid grid-cols-1 gap-6">
            <AnimatePresence mode="popLayout">
                {workflows.map((w, i) => (
                    <motion.div
                        key={w.id}
                        layout
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="relative p-8 rounded-[2.5rem] bg-gradient-to-r from-white/[0.03] to-transparent border border-white/5 backdrop-blur-3xl group overflow-hidden hover:border-[var(--accent-gold)]/20 transition-all duration-500 shadow-xl"
                    >
                        <div className="absolute top-0 right-0 w-64 h-full bg-[var(--accent-gold)]/5 blur-[100px] pointer-events-none group-hover:bg-[var(--accent-gold)]/10 transition-colors duration-700" />
                        
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 relative z-10">
                            <div className="flex items-center gap-8">
                                <div className={`w-20 h-20 rounded-[2rem] bg-black/40 border border-white/10 flex items-center justify-center transition-all duration-700 group-hover:border-[var(--accent-gold)]/40 ${w.status === "ACTIVE" ? "text-[var(--accent-gold)] shadow-[0_0_20px_rgba(251,191,36,0.1)]" : "text-white/20"}`}>
                                    <Zap size={32} className={w.status === "ACTIVE" ? "animate-pulse" : ""} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-4 mb-2">
                                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter italic group-hover:text-[var(--accent-gold)] transition-colors">{w.name}</h3>
                                        <div className={`px-3 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] flex items-center gap-2 ${
                                            w.status === "ACTIVE" ? "bg-[var(--accent-gold)]/10 border-[var(--accent-gold)]/20 text-[var(--accent-gold)]" : "bg-white/5 border-white/10 text-white/20"
                                        }`}>
                                            <div className={`w-1.5 h-1.5 rounded-full ${w.status === "ACTIVE" ? "bg-[var(--accent-gold)] animate-pulse" : "bg-white/20"}`} />
                                            {w.status}
                                        </div>
                                    </div>
                                    <p className="text-xs text-white/40 font-diag uppercase tracking-widest max-w-lg leading-relaxed">{w.description}</p>
                                    <div className="flex items-center gap-6 mt-6">
                                        <div className="flex items-center gap-2 px-3 py-1 bg-white/[0.03] border border-white/5 rounded-lg">
                                            <Cpu size={12} className="text-white/20" />
                                            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">{w.steps} LOGIC_STEPS</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Clock size={12} className="text-white/20" />
                                            <span className="text-[10px] font-diag text-white/20 uppercase tracking-widest">LAST_SYNC: {w.lastRun}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="text-right mr-8 hidden lg:block">
                                    <div className="text-[8px] font-diag text-white/20 uppercase tracking-widest mb-1">Efficiency</div>
                                    <div className="text-xl font-black text-[var(--accent-mint)] tracking-tighter">{w.successRate}%</div>
                                </div>
                                <div className="h-10 w-px bg-white/5 hidden lg:block mr-4" />
                                <button className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all hover:border-white/20 active:scale-90 shadow-lg">
                                    <Settings size={20} />
                                </button>
                                <button className="h-14 px-8 rounded-2xl bg-white text-black font-black uppercase tracking-widest text-[11px] hover:bg-[var(--accent-gold)] hover:scale-105 active:scale-95 transition-all flex items-center gap-3 shadow-2xl">
                                    EXECUTE
                                    <ArrowRight size={16} />
                                </button>
                                <button className="w-14 h-14 rounded-2xl bg-red-500/5 border border-red-500/10 flex items-center justify-center text-red-500/20 hover:text-red-500 hover:bg-red-500/10 transition-all hover:border-red-500/20 active:scale-90">
                                    <Trash2 size={20} />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>

            {/* Empty State / Add Protocol */}
            <motion.button
                onClick={() => setIsCreating(true)}
                whileHover={{ scale: 0.995 }}
                className="w-full py-20 rounded-[3rem] border-2 border-dashed border-white/5 bg-white/[0.01] flex flex-col items-center justify-center gap-6 text-white/10 hover:text-[var(--accent-gold)] hover:border-[var(--accent-gold)]/20 hover:bg-[var(--accent-gold)]/[0.02] transition-all duration-700 group"
            >
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center group-hover:border-[var(--accent-gold)]/40 group-hover:bg-[var(--accent-gold)]/10 transition-all duration-700">
                  <Plus size={32} className="opacity-40 group-hover:opacity-100 group-hover:rotate-90 transition-all duration-700" />
                </div>
                <div className="text-center">
                  <span className="block text-[10px] font-black uppercase tracking-[0.5em] font-diag mb-2">Forge_New_Logical_Sequence</span>
                  <p className="text-[10px] text-white/20 uppercase tracking-widest">Construct autonomous orchestration path</p>
                </div>
            </motion.button>
        </div>
        </motion.div>

        <StatsHUD 
          stats={[
            { label: "ACTIVE_FLUX", value: activeCount, color: "var(--accent-gold)" },
            { label: "SUCCESS_RATIO", value: "99.4%", color: "var(--accent-mint)" },
            { label: "LOGIC_NODES", value: workflows.reduce((acc, w) => acc + w.steps, 0), color: "var(--accent-blue)" }
          ]}
        />
      </div>

      {/* Simplified Modal Overworld */}
      <AnimatePresence>
        {isCreating && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-3xl p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="w-full max-w-2xl bg-[#0a0a0a] border border-white/10 rounded-[3rem] p-12 shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden relative"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--accent-gold)]/5 blur-[80px] pointer-events-none" />
              <div className="flex items-center justify-between mb-10">
                <h2 className="text-3xl font-black text-white uppercase tracking-tighter italic">Init_Protocol</h2>
                <button 
                  onClick={() => setIsCreating(false)}
                  className="text-[10px] font-black text-white/30 uppercase tracking-widest hover:underline"
                >
                  ABORT_SEQUENCE
                </button>
              </div>
              
              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="text-[9px] font-diag text-white/30 uppercase tracking-[0.4em] ml-2">Protocol_Designation</label>
                  <input type="text" placeholder="ENTROPY_RECOVERY_V3" className="w-full bg-black/40 border border-white/10 rounded-2xl px-8 py-5 text-sm text-white focus:outline-none focus:border-[var(--accent-gold)]/50 transition-all font-bold tracking-tight" />
                </div>
                <div className="space-y-3">
                  <label className="text-[9px] font-diag text-white/30 uppercase tracking-[0.4em] ml-2">Logical_Framework</label>
                  <textarea rows={4} placeholder="Describe the autonomous logic path..." className="w-full bg-black/40 border border-white/10 rounded-2xl px-8 py-5 text-sm text-white focus:outline-none focus:border-[var(--accent-gold)]/50 transition-all font-bold tracking-tight resize-none" />
                </div>
                <button className="w-full py-6 rounded-2xl bg-[var(--accent-gold)] text-black font-black uppercase tracking-[0.2em] text-[12px] shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all">
                  STABILIZE_LATTICE_NODE
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
