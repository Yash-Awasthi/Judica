import { motion } from "framer-motion";
import { 
  CheckCircle2, ClipboardList, ArrowRight, Sparkles, 
  Lightbulb, AlertCircle, RefreshCcw
} from "lucide-react";

interface SummaryData {
  keyDecisions: string[];
  actionItems: string[];
  followUps: string[];
  lastUpdated?: string;
}

interface SummaryViewProps {
  data: SummaryData | null;
  onGenerate: () => void;
  isGenerating?: boolean;
}

export function SummaryView({ data, onGenerate, isGenerating }: SummaryViewProps) {
  if (!data && !isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center space-y-8">
        <div className="w-24 h-24 rounded-[2.5rem] bg-white/[0.02] border border-white/5 flex items-center justify-center text-white/5 relative group">
           <div className="absolute inset-0 bg-[var(--accent-blue)]/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
           <ClipboardList size={48} />
        </div>
        <div>
          <h3 className="text-2xl font-black text-white italic mb-2 tracking-tight uppercase">No Summary Indexed</h3>
          <p className="text-[10px] font-diag uppercase tracking-[0.4em] text-white/20 font-black">Intel_Consolidation_Required</p>
        </div>
        <p className="text-xs text-[var(--text-muted)] max-w-sm italic leading-relaxed uppercase tracking-widest opacity-60">
          The neural lattice has not yet consolidated the deliberations into a structured executive summary.
        </p>
        <button 
          onClick={onGenerate}
          className="px-10 py-5 bg-[var(--accent-blue)] text-black rounded-3xl font-black text-[10px] uppercase tracking-[0.3em] hover:shadow-[0_0_40px_rgba(96,165,250,0.4)] transition-all active:scale-95 flex items-center gap-4"
        >
          <Sparkles size={16} />
          Generate_Executive_Summary
        </button>
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center space-y-6">
        <div className="relative">
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            className="w-20 h-20 border-4 border-[var(--accent-blue)]/20 border-t-[var(--accent-blue)] rounded-full"
          />
          <div className="absolute inset-0 flex items-center justify-center text-[var(--accent-blue)]">
            <RefreshCcw size={20} className="animate-pulse" />
          </div>
        </div>
        <div>
          <h3 className="text-xl font-black text-white italic lowercase tracking-tight animate-pulse">Consolidating_Lattice_Output...</h3>
          <p className="text-[8px] font-diag uppercase tracking-[0.5em] text-[var(--accent-blue)] mt-2 font-black">Syncing_Decision_Matrices</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-12 space-y-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-white italic tracking-tighter uppercase mb-2">Executive_Summary</h2>
          <div className="flex items-center gap-3">
             <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)] shadow-[0_0_10px_var(--accent-blue)]" />
             <p className="text-[9px] font-diag uppercase tracking-[0.4em] text-white/40 font-black">Sector_Consolidation_Complete</p>
          </div>
        </div>
        <button 
          onClick={onGenerate}
          className="flex items-center gap-3 px-6 py-3 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black text-white/40 uppercase tracking-widest hover:text-white hover:border-[var(--accent-blue)]/50 transition-all group"
        >
          <RefreshCcw size={14} className="group-hover:rotate-180 transition-transform duration-700" />
          Re-Analyze
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Key Decisions */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-8 rounded-[2.5rem] bg-gradient-to-br from-white/[0.03] to-transparent border border-white/5 relative group hover:border-[var(--accent-blue)]/20 transition-all"
        >
          <div className="absolute top-0 right-0 p-6 text-white/5 group-hover:text-[var(--accent-blue)]/10 transition-colors">
            <CheckCircle2 size={32} />
          </div>
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 rounded-xl bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]">
              <Lightbulb size={18} />
            </div>
            <h4 className="text-[10px] font-black text-white uppercase tracking-[0.4em] font-diag">Key_Decisions</h4>
          </div>
          <ul className="space-y-4">
            {data?.keyDecisions.map((item, i) => (
              <li key={i} className="flex gap-4 group/item">
                <ArrowRight size={14} className="shrink-0 mt-1 text-[var(--accent-blue)] opacity-40 group-hover/item:opacity-100 transition-opacity" />
                <span className="text-xs text-[var(--text-muted)] leading-relaxed italic uppercase tracking-widest group-hover/item:text-white transition-colors">{item}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Action Items */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-8 rounded-[2.5rem] bg-gradient-to-br from-white/[0.03] to-transparent border border-white/5 relative group hover:border-[var(--accent-mint)]/20 transition-all"
        >
          <div className="absolute top-0 right-0 p-6 text-white/5 group-hover:text-[var(--accent-mint)]/10 transition-colors">
            <ClipboardList size={32} />
          </div>
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 rounded-xl bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]">
              <CheckCircle2 size={18} />
            </div>
            <h4 className="text-[10px] font-black text-white uppercase tracking-[0.4em] font-diag">Action_Items</h4>
          </div>
          <ul className="space-y-4">
            {data?.actionItems.map((item, i) => (
              <li key={i} className="flex gap-4 group/item">
                <ArrowRight size={14} className="shrink-0 mt-1 text-[var(--accent-mint)] opacity-40 group-hover/item:opacity-100 transition-opacity" />
                <span className="text-xs text-[var(--text-muted)] leading-relaxed italic uppercase tracking-widest group-hover/item:text-white transition-colors">{item}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Follow Ups */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="md:col-span-2 p-8 rounded-[2.5rem] bg-gradient-to-br from-white/[0.03] to-transparent border border-white/5 relative group hover:border-orange-500/20 transition-all"
        >
          <div className="absolute top-0 right-0 p-6 text-white/5 group-hover:text-orange-500/10 transition-colors">
            <AlertCircle size={32} />
          </div>
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 rounded-xl bg-orange-500/10 text-orange-500">
              <RefreshCcw size={18} />
            </div>
            <h4 className="text-[10px] font-black text-white uppercase tracking-[0.4em] font-diag">Follow_Ups</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
            {data?.followUps.map((item, i) => (
              <li key={i} className="flex gap-4 group/item list-none">
                <ArrowRight size={14} className="shrink-0 mt-1 text-orange-500 opacity-40 group-hover/item:opacity-100 transition-opacity" />
                <span className="text-xs text-[var(--text-muted)] leading-relaxed italic uppercase tracking-widest group-hover/item:text-white transition-colors">{item}</span>
              </li>
            ))}
          </div>
        </motion.div>
      </div>

      <div className="pt-8 border-t border-white/5 flex items-center justify-between opacity-40">
        <span className="text-[8px] font-diag uppercase tracking-[0.5em]">System_Ref:_0x{Math.random().toString(16).slice(2, 8).toUpperCase()}</span>
        <span className="text-[8px] font-diag uppercase tracking-[0.5em]">Index_Stability:_99.9%</span>
      </div>
    </div>
  );
}
