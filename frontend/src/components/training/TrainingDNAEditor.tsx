import { motion } from "framer-motion";
import { Cpu, Database, Layers, RefreshCw, Shield, Zap, Save, Activity, Brain } from "lucide-react";

interface DNA {
  id: string;
  name: string;
  systemPrompt: string;
  steeringRules: string;
  consensusBias: string;
  critiqueStyle: string;
}

interface KB {
  id: string;
  name: string;
  document_count: number;
}

interface TrainingDNAEditorProps {
  dnas: DNA[];
  selectedDna: string;
  setSelectedDna: (id: string) => void;
  dnaDraft: Partial<DNA>;
  setDnaDraft: React.Dispatch<React.SetStateAction<Partial<DNA>>>;
  kbs: KB[];
  selectedKb: string;
  setSelectedKb: (id: string) => void;
  isSaving: boolean;
  onSave: () => void;
  onRevert: () => void;
}

const stagger = {
  container: {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  },
  item: {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0 }
  }
};

export function TrainingDNAEditor({
  dnas, selectedDna, setSelectedDna,
  dnaDraft, setDnaDraft,
  kbs, selectedKb, setSelectedKb,
  isSaving, onSave, onRevert
}: TrainingDNAEditorProps) {
  return (
    <div className="space-y-8">
      <motion.div variants={stagger.container} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 gap-6 shrink-0">
        {/* Subject DNA */}
        <motion.div variants={stagger.item} className="surface-card p-6 space-y-4 shadow-xl border-t-2 border-[var(--accent-mint)]">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-[rgba(110,231,183,0.1)] text-[var(--accent-mint)] shadow-[0_0_15px_rgba(110,231,183,0.2)]">
              <Cpu size={20} />
            </div>
            <h3 className="font-bold text-[var(--text-primary)]">Sovereign DNA</h3>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)]">Source Profile</label>
              <select 
                className="input-base text-sm focus:ring-1 focus:ring-[var(--accent-mint)]"
                value={selectedDna}
                onChange={(e) => setSelectedDna(e.target.value)}
              >
                <option value="">Select DNA Sequence...</option>
                {dnas.map(dna => <option key={dna.id} value={dna.id}>{dna.name}</option>)}
              </select>
            </div>
            
            {selectedDna && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)]">Consensus Bias</label>
                  <div className="flex gap-2">
                    {['Conservative', 'Neutral', 'Aggressive'].map(b => (
                      <button 
                        key={b}
                        onClick={() => setDnaDraft(prev => ({ ...prev, consensusBias: b.toLowerCase() }))}
                        className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg border transition-all ${
                          dnaDraft.consensusBias?.toLowerCase() === b.toLowerCase()
                            ? 'bg-[var(--accent-mint)] text-black border-[var(--accent-mint)] shadow-[0_0_15px_rgba(110,231,183,0.3)]'
                            : 'bg-transparent text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--accent-mint)]'
                        }`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Knowledge Coupling */}
        <motion.div variants={stagger.item} className="surface-card p-6 space-y-4 shadow-xl border-t-2 border-[var(--accent-blue)]">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-[rgba(147,197,253,0.1)] text-[var(--accent-blue)] shadow-[0_0_15px_rgba(147,197,253,0.2)]">
              <Database size={20} />
            </div>
            <h3 className="font-bold text-[var(--text-primary)]">Knowledge Coupling</h3>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)]">Active KB</label>
              <select 
                className="input-base text-sm focus:ring-1 focus:ring-[var(--accent-blue)]"
                value={selectedKb}
                onChange={(e) => setSelectedKb(e.target.value)}
              >
                <option value="">No Knowledge Base (General)</option>
                {kbs.map(kb => <option key={kb.id} value={kb.id}>{kb.name} ({kb.document_count} docs)</option>)}
              </select>
            </div>
            <div className="pt-2">
              <div className="p-3 rounded-lg border border-dashed border-[var(--border-subtle)] flex items-center justify-center gap-2 group cursor-pointer hover:border-[var(--accent-blue)] transition-colors hover:bg-[rgba(147,197,253,0.05)]">
                <Activity size={14} className="text-[var(--text-muted)] group-hover:text-[var(--accent-blue)]" />
                <span className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]">Monitor Knowledge Sync</span>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* DNA Refinement Area */}
      <motion.div variants={stagger.item} initial="hidden" animate="show" className="glass-panel p-8 space-y-6 relative overflow-hidden group">
         <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.03] pointer-events-none group-hover:opacity-[0.05] transition-opacity">
           <Brain size={128} className="absolute top-4 right-4" />
         </div>

         <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[rgba(250,204,21,0.1)] text-[var(--accent-gold)] shadow-[0_0_15px_rgba(250,204,21,0.2)]">
                <Layers size={20} />
              </div>
              <h3 className="text-xl font-bold text-[var(--text-primary)]">Steering & Prompt Mutation</h3>
            </div>
            <div className="flex gap-2">
              <button onClick={onRevert} className="btn-pill-ghost py-1 text-xs gap-2">
                <RefreshCw size={14} /> Revert
              </button>
            </div>
         </div>
         
         <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
           <div className="space-y-3">
             <label className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)] flex items-center gap-1.5">
               <Shield size={12} className="text-[var(--accent-coral)]" /> Behavioral Steering Rules
             </label>
             <textarea 
               className="w-full h-48 input-base text-[11px] font-mono p-4 scrollbar-custom resize-none border-[var(--bg-surface-3)] focus:border-[var(--accent-coral)] transition-colors"
               placeholder="Define behavioral constraints..."
               value={dnaDraft.steeringRules || ""}
               onChange={(e) => setDnaDraft(prev => ({ ...prev, steeringRules: e.target.value }))}
             />
           </div>
           <div className="space-y-3">
             <label className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)] flex items-center gap-1.5">
               <Zap size={12} className="text-[var(--accent-gold)]" /> Core System Directive
             </label>
             <textarea 
               className="w-full h-48 input-base text-[11px] font-mono p-4 scrollbar-custom resize-none border-[var(--bg-surface-3)] focus:border-[var(--accent-gold)] transition-colors"
               placeholder="The essential persona identity..."
               value={dnaDraft.systemPrompt || ""}
               onChange={(e) => setDnaDraft(prev => ({ ...prev, systemPrompt: e.target.value }))}
             />
           </div>
         </div>

         <div className="pt-4 flex justify-end gap-3">
            <button 
              onClick={onSave}
              disabled={!selectedDna || isSaving}
              className={`btn-pill-primary text-xs gap-2 px-8 py-2.5 min-w-[200px] shadow-lg hover:shadow-[0_0_20px_-5px_var(--accent-mint)] transition-all ${isSaving ? 'opacity-50' : ''}`}
            >
              {isSaving ? <RefreshCw className="animate-spin" size={14} /> : <Save size={14} />} 
              {isSaving ? 'Saving Mutations...' : 'Commit DNA Changes'}
            </button>
         </div>
      </motion.div>
    </div>
  );
}
