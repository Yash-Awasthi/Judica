import { motion } from "framer-motion";
import { Terminal } from "lucide-react";

interface AssetPublishFormProps {
  pubType: any;
  setPubType: (t: any) => void;
  pubName: string;
  setPubName: (s: string) => void;
  pubDesc: string;
  setPubDesc: (s: string) => void;
  pubTags: string;
  setPubTags: (s: string) => void;
  pubContent: string;
  setPubContent: (s: string) => void;
  publishing: boolean;
  onPublish: () => void;
  onCancel: () => void;
}

export function AssetPublishForm({
  pubType, setPubType,
  pubName, setPubName,
  pubDesc, setPubDesc,
  pubTags, setPubTags,
  pubContent, setPubContent,
  publishing,
  onPublish,
  onCancel
}: AssetPublishFormProps) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="overflow-hidden mb-10"
    >
      <div className="surface-card p-10 border border-[var(--accent-mint)]/20 bg-white/[0.01] rounded-[2.5rem] backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-10">
          <div className="p-2.5 rounded-xl bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]">
            <Terminal size={20} />
          </div>
          <div>
            <h2 className="text-[11px] font-black uppercase tracking-[0.4em] text-white">Neural Exchange Publication</h2>
            <p className="text-[8px] font-diag text-[var(--text-muted)] mt-1 uppercase tracking-widest">Global Asset Registration Protocol</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
          <div className="space-y-3">
            <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] ml-1">Asset_Class</label>
            <select 
              value={pubType} 
              onChange={(e) => setPubType(e.target.value)} 
              className="w-full bg-black/60 border border-white/10 rounded-2xl px-5 py-3.5 text-xs font-black uppercase tracking-widest text-[var(--accent-mint)] focus:ring-1 focus:ring-[var(--accent-mint)]/30 appearance-none cursor-pointer transition-all"
            >
              <option value="prompt">Prompt_Sequence</option>
              <option value="workflow">Operation_Protocol</option>
              <option value="persona">Synthetic_Identity</option>
              <option value="tool">Logic_Module</option>
            </select>
          </div>
          <div className="space-y-3">
            <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] ml-1">Asset_Designation</label>
            <input 
              value={pubName} 
              onChange={(e) => setPubName(e.target.value)} 
              placeholder="Enter system designation..." 
              className="w-full bg-black/60 border border-white/10 rounded-2xl px-5 py-3.5 text-xs font-bold text-white focus:border-[var(--accent-mint)]/40 transition-all placeholder:text-white/5" 
            />
          </div>
        </div>

        <div className="space-y-10">
          <div className="space-y-3">
            <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] ml-1">Functional_Abstract</label>
            <input 
              value={pubDesc} 
              onChange={(e) => setPubDesc(e.target.value)} 
              placeholder="High-level capability summary..." 
              className="w-full bg-black/60 border border-white/10 rounded-2xl px-5 py-3.5 text-xs text-white/70 focus:border-[var(--accent-mint)]/40 transition-all placeholder:text-white/5" 
            />
          </div>
          
          <div className="space-y-3">
            <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] ml-1">Neural_Trace_Tags</label>
            <input 
              value={pubTags} 
              onChange={(e) => setPubTags(e.target.value)} 
              placeholder="logic, inference, secure..." 
              className="w-full bg-black/60 border border-white/10 rounded-2xl px-5 py-3.5 text-[10px] font-mono text-[var(--accent-blue)] focus:border-[var(--accent-blue)]/40 transition-all placeholder:text-white/5" 
            />
          </div>

          <div className="space-y-3">
            <label className="text-[9px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] ml-1">Logic_Manifest (JSON/Text)</label>
            <textarea
              value={pubContent}
              onChange={(e) => setPubContent(e.target.value)}
              rows={6}
              placeholder='{"blueprint": "neural_sequence_01"}'
              className="w-full bg-black/60 border border-white/10 rounded-3xl p-8 text-[11px] font-mono text-[var(--text-secondary)] resize-none focus:border-[var(--accent-mint)]/30 transition-all scrollbar-custom"
            />
          </div>
        </div>

        <div className="flex justify-end items-center gap-8 mt-12 pt-8 border-t border-white/5">
          <button 
            onClick={onCancel} 
            className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] hover:text-white transition-colors"
          >
            Abort_X7
          </button>
          <button
            onClick={onPublish}
            disabled={publishing || !pubName.trim() || !pubDesc.trim() || !pubContent.trim()}
            className="px-10 py-4 text-[10px] font-black uppercase tracking-[0.3em] rounded-2xl bg-[var(--accent-mint)] text-black hover:shadow-[0_0_30px_rgba(110,231,183,0.3)] disabled:opacity-30 disabled:hover:shadow-none transition-all active:scale-[0.98]"
          >
            {publishing ? "Encrypting_Stream..." : "Authorize_Publication"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
