import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Grid, List, BookOpen, Star, Zap, ArrowRight, Shield, Cpu, Terminal, Globe } from "lucide-react";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import { StatsHUD } from "../components/StatsHUD";

interface Skill {
  id: string;
  name: string;
  description: string;
  category: "INTEL" | "PROTO" | "UNIT" | "SYSTEM";
  usageCount: number;
  complexity: "LOW" | "MED" | "HIGH";
  author: string;
  isUnlocked: boolean;
}

const CATEGORIES = ["ALL", "INTEL", "PROTO", "UNIT", "SYSTEM"];

const SKILLS: Skill[] = [
  { id: "1", name: "Vector_Synthesis_V2", description: "Performs deep semantic extraction from unstructured neural lattices.", category: "INTEL", usageCount: 4200, complexity: "HIGH", author: "SYSTEM", isUnlocked: true },
  { id: "2", name: "Entropy_Dampener", description: "Stabilizes stochastic variance during high-temp inference cycles.", category: "SYSTEM", usageCount: 1240, complexity: "MED", author: "SYSTEM", isUnlocked: true },
  { id: "3", name: "Logical_Bridge_API", description: "Connects external data streams to internal cognitive loops.", category: "UNIT", usageCount: 890, complexity: "LOW", author: "YASHA", isUnlocked: true },
  { id: "4", name: "Recursive_Debugger", description: "Self-correcting code optimization module with latent vision capabilities.", category: "PROTO", usageCount: 2310, complexity: "HIGH", author: "SYSTEM", isUnlocked: true },
  { id: "5", name: "Cross_Lattice_Sync", description: "Synchronizes knowledge across asynchronous model clusters.", category: "INTEL", usageCount: 560, complexity: "MED", author: "SYSTEM", isUnlocked: false },
];

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.1 } } },
  item: { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] } } },
};

export function SkillsView() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filteredSkills = useMemo(() => {
    return SKILLS.filter(s => {
      const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) || 
                          s.description.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = activeCategory === "ALL" || s.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [search, activeCategory]);

  return (
    <div className="h-full overflow-y-auto scrollbar-custom bg-[#000000] relative selection:bg-[var(--accent-blue)]/30">
      <TechnicalGrid opacity={0.15} />
      
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="max-w-[1400px] mx-auto p-10 space-y-12 relative z-10"
      >
        {/* Sector Header */}
        <SectorHUD 
          sectorId="UNIT-11" 
          title="Cognitive_Armory" 
          subtitle="Modular heuristic assets for complex multi-agent deliberation."
          accentColor="var(--accent-blue)"
          telemetry={[
            { label: "READY_UNITS", value: "84%", status: "optimal" },
            { label: "LATTICE_SYNC", value: "ACTIVE", status: "online" },
            { label: "ASSET_INTEG", value: "99.2%", status: "optimal" }
          ]}
        />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mt-10">
            <div className="flex items-center gap-4">
                 <div className="relative group/search">
                   <Search size={14} className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--accent-blue)] opacity-40 group-focus-within/search:opacity-100 transition-all" />
                   <input 
                     type="text" 
                     value={search}
                     onChange={(e) => setSearch(e.target.value)}
                     placeholder="LOCATE_CAPABILITY..." 
                     className="w-full lg:w-96 bg-black/60 border border-white/10 rounded-2xl pl-14 pr-6 py-3.5 text-xs text-white focus:outline-none focus:border-[var(--accent-blue)]/40 transition-all font-diag uppercase tracking-widest placeholder:text-white/10 shadow-inner" 
                   />
                 </div>
                 <div className="flex p-1 bg-white/[0.02] border border-white/5 rounded-2xl items-center">
                    <button onClick={() => setViewMode("grid")} aria-label="Grid view" className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${viewMode === "grid" ? "bg-[var(--accent-blue)] text-black" : "text-white/20 hover:text-white"}`}><Grid size={16} /></button>
                    <button onClick={() => setViewMode("list")} aria-label="List view" className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${viewMode === "list" ? "bg-[var(--accent-blue)] text-black" : "text-white/20 hover:text-white"}`}><List size={16} /></button>
                 </div>
            </div>

            <div className="flex flex-wrap gap-3">
                {CATEGORIES.map((cat) => (
                    <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`px-6 py-2.5 rounded-xl text-[9px] font-black tracking-[0.2em] uppercase transition-all border ${
                            activeCategory === cat 
                            ? "bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border-[var(--accent-blue)]/40 shadow-[0_0_20px_rgba(96,165,250,0.1)]" 
                            : "bg-black/40 text-white/30 border-white/5 hover:border-white/20 hover:bg-white/[0.02]"
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>
        </div>

        {/* Unit Grid */}
        <motion.div 
            layout 
            className={viewMode === "grid" 
                ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8" 
                : "flex flex-col gap-6"
            }
        >
            <AnimatePresence mode="popLayout">
                {filteredSkills.map((s, i) => (
                    <motion.div
                        key={s.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                        className={`surface-card group/unit p-8 rounded-[2.5rem] bg-white/[0.01] border border-white/5 hover:border-[var(--accent-blue)]/30 transition-all duration-500 relative overflow-hidden ${!s.isUnlocked ? "brightness-50 grayscale" : ""}`}
                    >
                        <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--accent-blue)]/[0.02] blur-[80px] pointer-events-none group-hover/unit:bg-[var(--accent-blue)]/[0.06] transition-all duration-1000" />
                        
                        <div className="flex items-start justify-between mb-8">
                            <div className="w-14 h-14 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center text-white/20 group-hover/unit:text-[var(--accent-blue)] group-hover/unit:border-[var(--accent-blue)]/40 group-hover/unit:scale-110 transition-all duration-700 shadow-inner">
                                {s.category === "INTEL" ? <BookOpen size={24} /> : 
                                 s.category === "PROTO" ? <Zap size={24} /> : 
                                 s.category === "UNIT" ? <Terminal size={24} /> : 
                                 <Cpu size={24} />}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <div className="px-3 py-1 bg-white/[0.03] border border-white/5 rounded-full text-[8px] font-black text-white/20 tracking-[0.2em] font-mono">0x{s.id.padStart(4, "0")}</div>
                                {!s.isUnlocked && <Shield size={14} className="text-[var(--accent-coral)]/40" />}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <h3 className="text-xl font-black text-white uppercase tracking-tighter italic transition-colors group-hover/unit:text-[var(--accent-blue)]">{s.name}</h3>
                                <Star size={12} className="text-[var(--accent-gold)] opacity-0 group-hover/unit:opacity-100 transition-opacity" />
                            </div>
                            <p className="text-[11px] text-white/40 font-diag leading-relaxed min-h-[4rem] group-hover/unit:text-white/60 transition-colors uppercase tracking-widest">{s.description}</p>
                        </div>

                        <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <div className="text-[8px] font-diag text-white/20 uppercase tracking-[0.3em] mb-1">Usage_Volume</div>
                                    <div className="text-[14px] font-black text-white font-mono tracking-tight">{s.usageCount.toLocaleString()} <span className="text-[8px] opacity-20">TRC</span></div>
                                </div>
                                <div>
                                    <div className="text-[8px] font-diag text-white/20 uppercase tracking-[0.3em] mb-1">Logic_Load</div>
                                    <div className="text-[14px] font-black text-[var(--accent-gold)] font-diag tracking-widest">{s.complexity}</div>
                                </div>
                            </div>
                            
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.4em] font-diag">Auth: {s.author}</span>
                                {s.isUnlocked ? (
                                    <button className="flex items-center gap-3 group/btn px-5 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-[9px] font-black text-white/40 uppercase tracking-widest hover:text-white hover:border-[var(--accent-blue)]/40 hover:bg-[var(--accent-blue)]/10 transition-all active:scale-95">
                                        DEPLOY_UNIT
                                        <ArrowRight size={12} className="group-hover/btn:translate-x-1 transition-transform text-[var(--accent-blue)]" />
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2 text-[9px] font-black text-[var(--accent-coral)] uppercase tracking-widest bg-[var(--accent-coral)]/5 px-4 py-2 rounded-xl border border-[var(--accent-coral)]/20 animate-pulse">
                                        <Shield size={10} />
                                        LOCKED
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </motion.div>

        {/* HUD Footer Diagnostics */}
        <StatsHUD 
          stats={[
            { label: "Unit_Readiness", value: "84%", icon: <Zap size={16} />, color: "var(--accent-blue)" },
            { label: "Asset_Integrity", value: "99.2%", icon: <Shield size={16} />, color: "var(--accent-mint)" },
            { label: "Lattice_Sync", value: "Active", icon: <Globe size={16} />, color: "var(--accent-gold)" }
          ]}
        />
      </motion.div>
    </div>
  );
}


