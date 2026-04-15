import { motion, AnimatePresence } from "framer-motion";
import { Activity, Cpu, Shield, Zap, Terminal } from "lucide-react";
import { useState, useEffect } from "react";

const TELEMETRY_LINES = [
  "NEURAL_LINK: ESTABLISHED",
  "CONSENSUS_ENGINE: NOMINAL",
  "ENTROPY_INDEX: 0.124",
  "SYNERGY_FLOW: OPTIMIZED",
  "LATENT_SPACE: STABLE",
  "COGNITIVE_LOAD: 14%",
  "ORCHESTRATOR: ACTIVE",
];

export function GlobalHUD() {
  const [tickerIndex, setTickerIndex] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setTickerIndex((prev) => (prev + 1) % TELEMETRY_LINES.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-[60] p-6 font-mono overflow-hidden">
      {/* ━━━━━ TOP LEFT: SYSTEM IDENTITY ━━━━━ */}
      <div className="absolute top-6 left-6 flex flex-col gap-1 items-start">
        <div className="flex items-center gap-2 text-[var(--accent-mint)] opacity-40">
          <Terminal size={12} />
          <span className="text-[10px] font-black tracking-[0.2em] uppercase">AIBYAI_HUD_V2.0</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-[1px] w-12 bg-[var(--accent-mint)] opacity-20" />
          <span className="text-[8px] text-white/20 uppercase tracking-[0.4em]">Grid_Sector_Alpha</span>
        </div>
      </div>

      {/* ━━━━━ BOTTOM LEFT: STATUS TELEMETRY ━━━━━ */}
      <motion.div 
        className="absolute bottom-6 left-6 flex flex-col gap-2 pointer-events-auto cursor-help group"
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
      >
        <div className="flex items-center gap-3 text-[var(--accent-mint)]">
          <Activity size={12} className="opacity-50 animate-pulse" />
          <AnimatePresence mode="wait">
            <motion.span 
              key={tickerIndex}
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 0.4, x: 0 }}
              exit={{ opacity: 0, x: 5 }}
              className="text-[9px] font-black tracking-[0.2em] uppercase"
            >
              {TELEMETRY_LINES[tickerIndex]}
            </motion.span>
          </AnimatePresence>
        </div>
        
        <AnimatePresence>
          {isExpanded && (
            <motion.div 
              initial={{ opacity: 0, y: 10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: 10, height: 0 }}
              className="flex flex-col gap-1 pl-6 border-l border-white/5 mt-2"
            >
              <div className="flex items-center gap-2 text-[8px] text-white/30 uppercase tracking-widest">
                <Cpu size={10} />
                <span>Proc_Cluster: ACTIVE</span>
              </div>
              <div className="flex items-center gap-2 text-[8px] text-white/30 uppercase tracking-widest">
                <Shield size={10} />
                <span>Sec_Protocol: ENFORCED</span>
              </div>
              <div className="flex items-center gap-2 text-[8px] text-white/30 uppercase tracking-widest">
                <Zap size={10} />
                <span>Power_Grid: 100%</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ━━━━━ BOTTOM RIGHT: PERFORMANCE HUD ━━━━━ */}
      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-1 opacity-20 hover:opacity-100 transition-opacity duration-500 pointer-events-auto">
        <div className="flex items-center gap-4 text-[9px] text-[var(--accent-gold)] font-black uppercase tracking-[0.3em]">
          <span>Telemetry_Verif</span>
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-gold)] shadow-[0_0_5px_var(--accent-gold)] animate-pulse" />
        </div>
        <div className="text-[10px] text-white/40 flex gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[7px] text-white/20 uppercase">Entropy</span>
            <span className="font-mono">0.024</span>
          </div>
          <div className="h-4 w-[1px] bg-white/5 my-auto" />
          <div className="flex flex-col items-end">
            <span className="text-[7px] text-white/20 uppercase">Synergy</span>
            <span className="font-mono text-[var(--accent-mint)]">+12.4%</span>
          </div>
        </div>
      </div>

      {/* ━━━━━ CORNER DECORATIONS ━━━━━ */}
      <div className="absolute top-0 right-0 w-32 h-32 opacity-10 pointer-events-none">
        <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" stroke="currentColor">
          <path d="M90 10 L100 10 L100 20" strokeWidth="0.5" />
          <circle cx="95" cy="5" r="1.5" strokeWidth="0.5" />
          <line x1="100" y1="0" x2="80" y2="0" strokeWidth="0.1" />
          <line x1="100" y1="0" x2="100" y2="20" strokeWidth="0.1" />
        </svg>
      </div>
      <div className="absolute bottom-0 left-0 w-32 h-32 opacity-10 pointer-events-none rotate-180">
        <svg width="100%" height="100%" viewBox="0 0 100 100" fill="none" stroke="currentColor">
          <path d="M90 10 L100 10 L100 20" strokeWidth="0.5" />
          <circle cx="95" cy="5" r="1.5" strokeWidth="0.5" />
        </svg>
      </div>
    </div>
  );
}
