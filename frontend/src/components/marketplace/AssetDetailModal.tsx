import { motion, AnimatePresence } from "framer-motion";
import { X, Activity, User, Star } from "lucide-react";
import { NeuralBlueprint } from "../NeuralBlueprint";

interface MarketplaceItem {
  id: string;
  type: string;
  name: string;
  description: string;
  content: unknown;
  authorName: string;
  tags: string[];
  stars: number;
  downloads: number;
  version: string;
  starred?: boolean;
}

interface AssetDetailModalProps {
  item: MarketplaceItem | null;
  onClose: () => void;
  onStar: (id: string) => void;
  onInstall: (id: string) => void;
}

export function AssetDetailModal({ item, onClose, onStar, onInstall }: AssetDetailModalProps) {
  return (
    <AnimatePresence>
      {item && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-8"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/90 backdrop-blur-2xl"
          />

          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.98 }}
            transition={{ type: "spring", damping: 25, stiffness: 300, duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
            className="relative surface-card w-full max-w-5xl max-h-[92vh] overflow-hidden shadow-[0_0_100px_rgba(0,0,0,0.8)] rounded-[3rem] border border-white/10 flex flex-col bg-[#080808]"
          >
            <div className="shrink-0 p-12 border-b border-white/5 relative bg-white/[0.01]">
               <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-[var(--accent-mint)]/5 to-transparent pointer-events-none" />
               <div className="flex items-start justify-between relative z-10">
                  <div className="space-y-5">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 text-[9px] font-black uppercase tracking-[0.2em] rounded-md bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] border border-[var(--accent-mint)]/20 shadow-[0_0_15px_rgba(110,231,183,0.15)]">
                        {item.type.replace('_', ' ')}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] font-mono text-white/30 uppercase tracking-widest">
                        <Activity size={10} />
                        Asset_Revision_{item.version}
                      </div>
                    </div>
                    <h2 className="text-5xl font-black text-white tracking-tighter leading-none">{item.name}</h2>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-white/5 flex items-center justify-center border border-white/10 text-[var(--accent-mint)]">
                          <User size={12} />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.1em] text-white/50">Admin: {item.authorName}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={onClose} aria-label="Close" className="p-4 rounded-full bg-white/5 border border-white/10 text-white/30 hover:text-white hover:bg-white/10 transition-all active:scale-95">
                    <X size={24} />
                  </button>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-custom p-12 bg-[radial-gradient(circle_at_50%_0%,rgba(110,231,183,0.02)_0%,transparent_100%)]">
               <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
                 <div className="lg:col-span-12 space-y-12">
                   <section className="space-y-6">
                     <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] ml-1">Structural Blueprint</h3>
                     <NeuralBlueprint type={item.type} name={item.name} />
                   </section>

                   <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                      <section className="space-y-6">
                        <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] ml-1">Logical Specification</h3>
                        <div className="glass-panel p-10 bg-white/[0.01] border-white/5 rounded-[2rem] space-y-8">
                           <div className="space-y-3">
                             <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Abstract</p>
                             <p className="text-[14px] text-white/70 leading-relaxed italic pr-4">{item.description}</p>
                           </div>
                           <div className="space-y-4">
                             <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Classification_Nodes</p>
                             <div className="flex flex-wrap gap-2.5">
                               {item.tags.map((tag: string) => (
                                 <span key={tag} className="px-3.5 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-xl bg-[var(--accent-blue)]/5 text-[var(--accent-blue)] border border-[var(--accent-blue)]/10">{tag}</span>
                               ))}
                             </div>
                           </div>
                        </div>
                      </section>

                      <section className="space-y-6">
                         <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em] ml-1">Telemetry Metrics</h3>
                         <div className="surface-card p-10 bg-[var(--accent-mint)]/[0.02] border-[var(--accent-mint)]/10 rounded-[2rem] space-y-10">
                            <div className="flex items-center justify-between">
                               <div className="space-y-1.5">
                                  <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Deployments</p>
                                  <p className="text-4xl font-black text-white font-mono tracking-tighter">{item.downloads.toLocaleString()}</p>
                               </div>
                               <button onClick={() => onStar(item.id)} className={`p-5 rounded-2xl border transition-all active:scale-95 ${item.starred ? 'bg-[var(--accent-gold)]/10 border-[var(--accent-gold)]/30 text-[var(--accent-gold)] shadow-[0_0_20px_rgba(251,191,36,0.1)]' : 'bg-white/5 border-white/10 text-white/20 hover:text-white hover:bg-white/10'}`}>
                                 <Star size={24} fill={item.starred ? "currentColor" : "none"} />
                               </button>
                            </div>
                            <button onClick={() => onInstall(item.id)} className="w-full py-6 text-xs font-black uppercase tracking-[0.4em] bg-[var(--accent-mint)] text-black rounded-2xl hover:shadow-[0_0_40px_rgba(110,231,183,0.3)] transition-all active:scale-[0.98]">
                              Authorize_Deployment
                            </button>
                         </div>
                      </section>
                   </div>

                   <section className="space-y-6">
                      <div className="flex items-center justify-between px-1">
                        <h3 className="text-[10px] font-black text-white/30 uppercase tracking-[0.4em]">Logic Manifest Source</h3>
                      </div>
                      <div className="rounded-[2rem] border border-white/5 overflow-hidden">
                         <pre className="p-10 bg-black/60 text-[11px] font-mono text-white/50 overflow-x-auto scrollbar-custom whitespace-pre-wrap leading-relaxed">
                           {typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2)}
                         </pre>
                      </div>
                   </section>
                 </div>
               </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
