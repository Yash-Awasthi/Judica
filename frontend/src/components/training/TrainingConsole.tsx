import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Activity, RefreshCw, Zap, Shield, Info } from "lucide-react";

interface LogEntry {
  id: string;
  msg: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface TrainingConsoleProps {
  logs: LogEntry[];
  isTraining: boolean;
  progress: number;
  onRunValidation: () => void;
  selectedDna: string;
}

const stagger = {
  item: {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0 }
  }
};

export function TrainingConsole({ logs, isTraining, progress, onRunValidation, selectedDna }: TrainingConsoleProps) {
  return (
    <div className="flex flex-col gap-6 h-full min-h-0">
      <motion.div variants={stagger.item} initial="hidden" animate="show" className="surface-card bg-black flex-1 flex flex-col border-[var(--border-subtle)] shadow-2xl relative overflow-hidden group font-mono min-h-0">
        {/* Animated Scanning Line */}
        <AnimatePresence>
          {isTraining && (
            <motion.div 
              initial={{ top: "0%" }}
              animate={{ top: "100%" }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="absolute left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--accent-mint)] to-transparent opacity-50 z-10 pointer-events-none shadow-[0_0_15px_var(--accent-mint)]"
            />
          )}
        </AnimatePresence>

        <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-2)] flex items-center justify-between shrink-0">
           <div className="flex items-center gap-2">
              <Terminal size={14} className="text-[var(--accent-mint)] shadow-[0_0_8px_var(--accent-mint)]" />
              <span className="ml-2 text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Mutation-Log-Stream</span>
           </div>
           <div className="w-2 h-2 rounded-full bg-[var(--accent-mint)] animate-pulse shadow-[0_0_8px_var(--accent-mint)]" />
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 text-[11px] scrollbar-custom space-y-2 relative bg-[radial-gradient(circle_at_50%_50%,rgba(110,231,183,0.02)_0%,transparent_100%)]">
           <AnimatePresence mode="popLayout">
             {logs.map((log) => (
               <motion.div 
                 key={log.id}
                 initial={{ opacity: 0, x: -10, filter: 'blur(4px)' }}
                 animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                 className={`flex gap-3 p-1.5 rounded transition-colors hover:bg-[rgba(255,255,255,0.02)] ${
                   log.type === 'success' ? 'text-[var(--accent-mint)] text-shadow-mint' : 
                   log.type === 'error' ? 'text-red-400' :
                   log.type === 'warning' ? 'text-[var(--accent-coral)]' : 
                   'text-[var(--text-secondary)]'
                 }`}
               >
                 <span className="opacity-30 shrink-0 font-light font-mono">[{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                 <span className="flex-1 leading-relaxed">
                    <span className="mr-2 opacity-50">#</span>
                    {log.msg}
                 </span>
               </motion.div>
             ))}
           </AnimatePresence>
           {logs.length === 0 && (
             <div className="h-full flex flex-col items-center justify-center opacity-20 transform translate-y-[-10%] select-none">
                <Activity size={48} className="mb-4 animate-pulse text-[var(--accent-mint)]" />
                <span className="text-[10px] uppercase tracking-[0.4em] font-black text-[var(--text-muted)]">Awaiting Sequence</span>
             </div>
           )}
        </div>

        <div className="p-6 bg-[var(--bg-surface-3)] border-t border-[var(--border-subtle)] space-y-5 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-black uppercase text-[var(--text-muted)] tracking-[0.15em]">Evolution Integrity</span>
              <span className="text-[10px] font-mono text-[var(--text-secondary)]">Sequence Optimization: Active</span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[12px] font-mono text-[var(--accent-mint)] font-bold text-shadow-mint">{progress}%</span>
            </div>
          </div>
          
          <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-[var(--border-subtle)] p-[1px]">
             <motion.div 
               className="h-full bg-gradient-to-r from-[var(--accent-mint)] via-emerald-400 to-[var(--accent-blue)] rounded-full shadow-[0_0_10px_rgba(110,231,183,0.4)]"
               initial={{ width: 0 }}
               animate={{ width: `${progress}%` }}
               transition={{ duration: 0.5 }}
             />
          </div>
          
          <button 
            onClick={onRunValidation}
            disabled={isTraining || !selectedDna}
            className={`w-full py-4 rounded-xl flex items-center justify-center gap-3 font-bold text-sm tracking-widest uppercase transition-all relative overflow-hidden group ${
              isTraining || !selectedDna
                ? 'bg-[var(--glass-bg)] text-[var(--text-muted)] border border-[var(--glass-border)] cursor-not-allowed opacity-50'
                : 'bg-[var(--accent-mint)] text-black hover:scale-[1.01] active:scale-[0.98] hover:shadow-[0_0_30px_-5px_var(--accent-mint)] ring-1 ring-[var(--accent-mint)] ring-offset-2 ring-offset-black'
            }`}
          >
            {isTraining && (
              <motion.div 
                className="absolute inset-0 bg-white/20"
                animate={{ left: ["-100%", "200%"] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            {isTraining ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} fill="currentColor" />}
            <span className="relative z-10">{isTraining ? "Synthesizing..." : "Initialize Evolution"}</span>
          </button>
        </div>
      </motion.div>
      
      <div className="surface-card p-6 flex items-center gap-4 shrink-0 border-l-4 border-[var(--accent-gold)] shadow-xl">
        <div className="w-12 h-12 rounded-xl bg-[rgba(250,204,21,0.08)] flex items-center justify-center text-[var(--accent-gold)] shadow-[inset_0_0_15px_rgba(250,204,21,0.05)] border border-[rgba(250,204,21,0.1)]">
          <Shield size={22} className="drop-shadow-[0_0_8px_var(--accent-gold)]" />
        </div>
        <div className="flex-1 min-w-0">
           <h4 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-wider mb-0.5">Constraint Guard</h4>
           <p className="text-[10px] text-[var(--text-muted)] leading-relaxed italic">
             Mutation lab enforces strictly stateless iterations. All behavioral steering follows global compliance logs.
           </p>
        </div>
        <Info size={14} className="text-[var(--text-muted)] opacity-50" />
      </div>
    </div>
  );
}
