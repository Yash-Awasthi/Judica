import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { Plus, ArrowRight, Search, Filter, FileText, Share2, Clock, Activity, CheckCircle, XCircle, ChevronDown } from "lucide-react";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import { SkeletonLoader } from "../components/SkeletonLoader";
import { StatsHUD } from "../components/StatsHUD";

interface Evaluation {
  id: string;
  name: string;
  model: string;
  dataset: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  accuracy: number | null;
  totalSamples: number;
  completedSamples: number;
  createdAt: string;
}

interface Dataset {
  id: string;
  name: string;
  count: number;
}

export function EvaluationView() {
  const { fetchWithAuth } = useAuth();
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Selection
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [evalName, setEvalName] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [evalsRes, dsRes] = await Promise.all([
        fetchWithAuth("/api/evaluations"),
        fetchWithAuth("/api/evaluations/datasets"),
      ]);
      if (evalsRes.ok) {
        const data = await evalsRes.json();
        setEvals(data.data || []);
      }
      if (dsRes.ok) {
        const data = await dsRes.json();
        setDatasets(data.data || []);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedModel || !selectedDatasetId || !evalName.trim()) return;
    setIsStarting(true);
    try {
      const res = await fetchWithAuth("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: evalName.trim(),
          model: selectedModel,
          datasetId: selectedDatasetId,
        }),
      });
      if (res.ok) {
        setEvalName("");
        loadData();
      }
    } finally {
      setIsStarting(false);
    }
  };

  const activeEvalsCount = useMemo(() => evals.filter(e => e.status === "RUNNING").length, [evals]);
  const avgAccuracy = useMemo(() => {
    const completed = evals.filter(e => e.status === "COMPLETED" && e.accuracy !== null);
    if (!completed.length) return 0;
    return (completed.reduce((acc, curr) => acc + (curr.accuracy || 0), 0) / completed.length) * 100;
  }, [evals]);

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
            sectorId="SIM-05"
            title="Sim_Convergence"
            subtitle="Neural Benchmarking // Stochastic Validity Testing"
            accentColor="var(--accent-coral)"
            telemetry={[
              { label: "CONCURRENT_SIMS", value: activeEvalsCount.toString(), status: "optimal" },
              { label: "LATTICE_ACCURACY", value: `${avgAccuracy.toFixed(1)}%`, status: "online" },
              { label: "COMPUTE_LOAD", value: "98%", status: "optimal" }
            ]}
          />
        

        {/* ━━━ Simulation Forge ━━━ */}
        <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="relative p-12 rounded-[3.5rem] bg-white/[0.01] border border-white/5 backdrop-blur-3xl overflow-hidden group shadow-2xl"
        >
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[var(--accent-coral)]/40 to-transparent" />
          <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-[var(--accent-coral)]/5 blur-[120px] pointer-events-none" />
          
          <div className="flex items-center gap-6 mb-12">
            <div className="w-12 h-12 rounded-2xl bg-[var(--accent-coral)]/10 flex items-center justify-center text-[var(--accent-coral)] border border-[var(--accent-coral)]/20 shadow-[0_0_20px_rgba(248,113,113,0.1)]">
              <Plus size={20} />
            </div>
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-[0.4em] font-diag mb-1">Forge_New_Bench_Sequence</h2>
              <p className="text-[9px] text-white/20 uppercase tracking-[0.2em]">Parameter definition for stochastic convergence</p>
            </div>
          </div>

          <form onSubmit={handleStart} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 items-end relative z-10">
            <DropdownField label="Lattice_Entity" value={selectedModel} onChange={setSelectedModel} placeholder="Pick Model..." options={["gpt-4o", "claude-3-5-sonnet", "gemini-1.5-pro"]} />
            <DropdownField label="Knowledge_Set" value={selectedDatasetId} onChange={setSelectedDatasetId} placeholder="Pick Dataset..." options={datasets.map(d => ({ label: `${d.name} (${d.count})`, value: d.id }))} />
            <div className="space-y-3">
              <label className="block text-[9px] font-diag text-white/30 uppercase tracking-[0.4em] ml-1">Sequence_ID</label>
              <input type="text" value={evalName} onChange={(e) => setEvalName(e.target.value)} placeholder="e.g. COLD_START_TEST" className="w-full bg-black/60 border border-white/10 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:border-[var(--accent-coral)]/40 transition-all font-bold" />
            </div>
            <button disabled={isStarting} className="group h-[54px] rounded-2xl bg-[var(--accent-coral)] text-black font-black uppercase tracking-[0.2em] text-[11px] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-30 flex items-center justify-center gap-3 shadow-2xl">
                {isStarting ? "FORGING..." : "INIT_SIM_DEEP"}
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </form>
        </motion.div>

        {/* ━━━ Active Trace Grid ━━━ */}
        <div className="space-y-8">
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-4">
                   <div className="w-2 h-2 rounded-full bg-[var(--accent-coral)] shadow-[0_0_8px_var(--accent-coral)]" />
                   <h2 className="text-[10px] font-black text-white/40 uppercase tracking-[0.5em] font-diag">Neural_Convergence_Logs</h2>
                </div>
                <div className="flex items-center gap-4">
                   <Search size={14} className="text-white/20" />
                   <Filter size={14} className="text-white/20" />
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {Array.from({ length: 4 }).map((_, i) => <SkeletonLoader key={i} variant="card" />)}
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <AnimatePresence mode="popLayout">
                        {evals.map((ev, i) => (
                            <motion.div
                                key={ev.id}
                                layout
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="relative p-10 rounded-[3rem] bg-gradient-to-br from-white/[0.03] to-transparent border border-white/5 backdrop-blur-3xl overflow-hidden group shadow-xl hover:border-white/10 transition-all duration-500"
                            >
                                <div className="absolute top-0 right-0 w-48 h-48 bg-white/[0.02] blur-[80px] pointer-events-none group-hover:bg-white/[0.05] transition-all" />
                                
                                <div className="flex items-start justify-between mb-8 relative z-10">
                                    <div className="flex items-center gap-6">
                                        <div className={`w-16 h-16 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-center transition-all duration-700 ${ev.status === "RUNNING" ? "border-[var(--accent-coral)]/30 text-[var(--accent-coral)]" : "text-white/20"}`}>
                                            <FileText size={24} className={ev.status === "RUNNING" ? "animate-pulse" : ""} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3 mb-1">
                                                <h3 className="text-xl font-black text-white uppercase tracking-tight italic">{ev.name}</h3>
                                                <StatusBadge status={ev.status} />
                                            </div>
                                            <p className="text-[10px] text-white/30 font-diag uppercase tracking-widest">{ev.model} // {ev.dataset}</p>
                                        </div>
                                    </div>
                                    <button aria-label="Share evaluation" className="text-white/10 hover:text-white transition-colors"><Share2 size={16} /></button>
                                </div>

                                <div className="space-y-6 relative z-10">
                                    <div className="flex items-center justify-between">
                                        <div className="text-[10px] font-black text-white/40 uppercase tracking-widest font-diag">Neural_Sync_Progress</div>
                                        <div className="text-[10px] font-mono text-white/20">{ev.completedSamples}/{ev.totalSamples} NODES</div>
                                    </div>
                                    
                                    <div className="h-1.5 w-full bg-white/[0.02] rounded-full overflow-hidden border border-white/[0.03]">
                                        <motion.div 
                                            initial={{ width: 0 }}
                                            animate={{ width: `${(ev.completedSamples / ev.totalSamples) * 100}%` }}
                                            className={`h-full ${ev.status === "FAILED" ? "bg-red-500" : ev.status === "COMPLETED" ? "bg-[var(--accent-mint)]" : "bg-[var(--accent-coral)] animate-pulse"}`} 
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-6 pt-4">
                                        <div className="p-6 rounded-2xl bg-black/40 border border-white/[0.03]">
                                            <div className="text-[8px] font-diag text-white/20 uppercase tracking-widest mb-1">Accuracy_Index</div>
                                            <div className="text-2xl font-black text-white tracking-tighter italic">
                                                {ev.accuracy !== null ? `${(ev.accuracy * 100).toFixed(1)}%` : "---%"}
                                            </div>
                                        </div>
                                        <div className="p-6 rounded-2xl bg-black/40 border border-white/[0.03]">
                                            <div className="text-[8px] font-diag text-white/20 uppercase tracking-widest mb-1">Temporal_Lag</div>
                                            <div className="text-2xl font-black text-white tracking-tighter italic">
                                                {new Date(ev.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-8 pt-8 border-t border-white/[0.03] flex items-center justify-between relative z-10">
                                    <div className="flex items-center gap-2">
                                        <Clock size={12} className="text-white/20" />
                                        <span className="text-[9px] font-diag text-white/20 uppercase tracking-widest">TRACE_INIT_V5</span>
                                    </div>
                                    <button className="flex items-center gap-2 text-[10px] font-black text-[var(--accent-coral)] uppercase tracking-widest hover:underline transition-all group/btn">
                                        VIEW_DETAILED_LOG
                                        <ArrowRight size={14} className="group-hover/btn:translate-x-1 transition-transform" />
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
        </motion.div>

        {/* ━━━━ Simulation HUD ━━━━ */}
        <StatsHUD 
          stats={[
            { label: "ACTIVE_SIMS", value: activeEvalsCount, color: "var(--accent-coral)" },
            { label: "AVG_ACCURACY", value: `${avgAccuracy.toFixed(1)}%`, color: "var(--accent-mint)" },
            { label: "NODES_SYNCED", value: evals.reduce((acc, curr) => acc + curr.completedSamples, 0), color: "var(--accent-blue)" }
          ]}
        />
      </div>
    </div>
  );
}


function StatusBadge({ status }: { status: Evaluation["status"] }) {
    const config = {
        PENDING: { color: "text-white/40", icon: <Clock size={10} />, bg: "bg-white/5 border-white/10" },
        RUNNING: { color: "text-[var(--accent-coral)]", icon: <Activity size={10} />, bg: "bg-[var(--accent-coral)]/10 border-[var(--accent-coral)]/20 shadow-[0_0_15px_rgba(248,113,113,0.1)]" },
        COMPLETED: { color: "text-[var(--accent-mint)]", icon: <CheckCircle size={10} />, bg: "bg-[var(--accent-mint)]/10 border-[var(--accent-mint)]/20" },
        FAILED: { color: "text-red-400", icon: <XCircle size={10} />, bg: "bg-red-400/10 border-red-400/20" },
    }[status];

    return (
        <div className={`px-2.5 py-0.5 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] flex items-center gap-1.5 ${config.bg} ${config.color}`}>
            <div className={`w-1 h-1 rounded-full ${status === "RUNNING" ? "bg-current animate-pulse" : "bg-current"}`} />
            {status}
        </div>
    );
}

function DropdownField({ label, value, onChange, placeholder, options }: any) {
    return (
        <div className="space-y-3">
            <label className="block text-[9px] font-diag text-white/30 uppercase tracking-[0.4em] ml-1">{label}</label>
            <div className="relative group/select">
                <select 
                    value={value} 
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full bg-black/60 border border-white/10 rounded-2xl px-6 py-4 text-xs text-white focus:outline-none focus:border-white/30 transition-all font-bold appearance-none cursor-pointer"
                >
                    <option value="" disabled>{placeholder}</option>
                    {options.map((opt: any) => (
                        <option key={typeof opt === "string" ? opt : opt.value} value={typeof opt === "string" ? opt : opt.value}>
                            {typeof opt === "string" ? opt : opt.label}
                        </option>
                    ))}
                </select>
                <ChevronDown size={14} className="absolute right-6 top-1/2 -translate-y-1/2 text-white/10 pointer-events-none group-hover/select:text-white/30 transition-colors" />
            </div>
        </div>
    );
}
