import { motion } from "framer-motion";
import { Activity, RefreshCw } from "lucide-react";

interface TrainingEvolutionMapProps {
  isTraining: boolean;
  progress: number;
}

const stagger = {
  item: {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0 }
  }
};

export function TrainingEvolutionMap({ isTraining, progress: _progress }: TrainingEvolutionMapProps) {
  return (
    <motion.div variants={stagger.item} className="surface-card p-6 space-y-6 relative overflow-hidden bg-[rgba(0,0,0,0.2)] border-dashed border-[var(--border-subtle)] overflow-hidden">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[rgba(167,139,250,0.1)] text-purple-400 shadow-[0_0_15px_rgba(167,139,250,0.15)]">
            <Activity size={20} />
          </div>
          <h3 className="font-bold text-[var(--text-primary)]">Behavioral Resonance Radar</h3>
        </div>
        <div className="text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-widest">Helix Analysis: Active</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center h-48">
        {/* Radar Map */}
        <div className="relative h-full flex items-center justify-center">
          <svg viewBox="0 0 100 100" className="w-full h-full max-w-[160px] transform transition-transform duration-1000 rotate-[-15deg]">
            <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border-subtle)" strokeWidth="0.5" strokeDasharray="2 2" />
            <circle cx="50" cy="50" r="30" fill="none" stroke="var(--border-subtle)" strokeWidth="0.5" strokeDasharray="2 2" />
            <circle cx="50" cy="50" r="15" fill="none" stroke="var(--border-subtle)" strokeWidth="0.5" strokeDasharray="2 2" />
            
            {[0, 60, 120, 180, 240, 300].map(angle => (
              <line 
                key={angle}
                x1="50" y1="50"
                x2={50 + 45 * Math.cos(angle * Math.PI / 180)}
                y2={50 + 45 * Math.sin(angle * Math.PI / 180)}
                stroke="var(--border-subtle)"
                strokeWidth="0.5"
              />
            ))}

            <motion.path 
              d={`M 50 ${50 - (isTraining ? 40 : 35)} L ${50 + (isTraining ? 30 : 25)} ${50 - 15} L ${50 + 15} ${50 + 30} L 50 ${50 + 30} L ${50 - 15} ${50 + 30} L ${50 - (isTraining ? 30 : 25)} ${50 - 15} Z`}
              fill="rgba(110,231,183,0.15)"
              stroke="var(--accent-mint)"
              strokeWidth="1.5"
              animate={{
                d: isTraining 
                  ? [`M 50 10 L 80 35 L 65 80 L 50 80 L 35 80 L 20 35 Z`, `M 50 15 L 75 40 L 60 75 L 50 75 L 40 75 L 25 40 Z`]
                  : `M 50 15 L 75 35 L 65 70 L 50 70 L 35 70 L 25 35 Z`
              }}
              transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
            />
          </svg>
          
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 text-[8px] font-black tracking-widest text-[var(--text-muted)]">CURIOSITY</div>
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-2 text-[8px] font-black tracking-widest text-[var(--text-muted)]">SAFETY</div>
          <div className="absolute top-1/2 right-0 translate-x-4 -translate-y-1/2 text-[8px] font-black tracking-widest text-[var(--text-muted)]">SPEED</div>
          <div className="absolute top-1/2 left-0 -translate-x-4 -translate-y-1/2 text-[8px] font-black tracking-widest text-[var(--text-muted)]">CREATIVITY</div>
        </div>

        {/* DNA Helix Visualization */}
        <div className="flex-1 space-y-4">
          <div className="space-y-2">
             <div className="flex justify-between text-[9px] font-mono text-[var(--text-muted)]">
                <span>Latent Space Depth</span>
                <span>Optimized</span>
             </div>
             <div className="flex gap-1">
                {[...Array(12)].map((_, i) => (
                  <motion.div 
                    key={i}
                    className={`h-4 w-1 flex-1 rounded-sm ${i < 8 ? 'bg-[var(--accent-mint)]' : 'bg-[var(--border-subtle)]'}`}
                    animate={isTraining ? { opacity: [0.3, 1, 0.3], height: [12, 16, 12] } : {}}
                    transition={{ delay: i * 0.1, duration: 1.5, repeat: Infinity }}
                  />
                ))}
             </div>
          </div>
          
          <div className="flex items-center gap-3 p-3 rounded-lg bg-black/30 border border-[var(--border-subtle)]">
             <div className="p-1.5 rounded-full bg-[rgba(110,231,183,0.1)]">
                <RefreshCw size={12} className={`text-[var(--accent-mint)] ${isTraining ? 'animate-spin' : ''}`} />
             </div>
             <div className="flex-1">
                <div className="text-[10px] font-bold text-[var(--text-secondary)]">Evolution Drift</div>
                <div className="text-[9px] text-[var(--text-muted)]">Mutation Index: {isTraining ? "0.041" : "0.000"}</div>
             </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
