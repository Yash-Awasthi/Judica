import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import ReactECharts from "echarts-for-react";
import { Activity, Coins, Clock, MessageSquare, Zap, Share2 } from "lucide-react";
import { SkeletonLoader } from "../components/SkeletonLoader";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import { StatsHUD } from "../components/StatsHUD";

interface AnalyticsData {
  totalConversations: number;
  totalMessages: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  modelDistribution: { model: string; count: number }[];
  dailyUsage: { date: string; tokens: number; cost: number }[];
  topTools: { tool: string; count: number }[];
}

interface TraceRow {
  id: string;
  type: string;
  totalLatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
  createdAt: string;
}

const CHART_COLORS = [
  "#6ee7b7", "#60a5fa", "#a78bfa", "#fbbf24",
  "#f472b6", "#34d399", "#818cf8", "#fb923c",
  "#38bdf8", "#e879f9",
];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatCost(n: number): string {
  return "$" + n.toFixed(4);
}

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.1 } } },
  item: { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] } } },
};

export function AnalyticsView() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, tracesRes] = await Promise.all([
        fetchWithAuth("/api/analytics/overview"),
        fetchWithAuth("/api/traces?limit=15"),
      ]);
      if (overviewRes.ok) {
        setData(await overviewRes.json());
      }
      if (tracesRes.ok) {
        const t = await tracesRes.json();
        setTraces(t.traces || []);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  const tokenLineOption = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "#000",
      borderColor: "rgba(110,231,183,0.3)",
      textStyle: { color: "#fff", fontSize: 11, fontFamily: "Geist mono" },
      axisPointer: { lineStyle: { color: "rgba(110,231,183,0.2)" } }
    },
    grid: { left: "4%", right: "4%", top: "10%", bottom: "10%", containLabel: true },
    xAxis: {
      type: "category",
      data: data?.dailyUsage.map(d => d.date.slice(5)) || [],
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
      axisLabel: { color: "rgba(255,255,255,0.3)", fontSize: 10 },
      splitLine: { show: false }
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisLabel: { color: "rgba(255,255,255,0.3)", fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.03)", type: "dashed" } }
    },
    series: [{
      data: data?.dailyUsage.map(d => d.tokens) || [],
      type: "line",
      smooth: true,
      lineStyle: { width: 3, color: "#6ee7b7", shadowBlur: 15, shadowColor: "rgba(110,231,183,0.5)" },
      itemStyle: { color: "#6ee7b7" },
      showSymbol: false,
      areaStyle: {
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: "rgba(110,231,183,0.15)" }, { offset: 1, color: "transparent" }]
        }
      }
    }]
  }), [data]);

  const pieOption = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      backgroundColor: "#000",
      borderColor: "rgba(255,255,255,0.1)",
      textStyle: { color: "#fff", fontSize: 11 }
    },
    series: [{
      type: "pie",
      radius: ["55%", "75%"],
      center: ["50%", "50%"],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 10, borderColor: "#050505", borderWidth: 4 },
      label: { show: false },
      data: data?.modelDistribution.map((d, i) => ({
        name: d.model.split("/").pop() || d.model,
        value: d.count,
        itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] }
      })) || []
    }]
  }), [data]);

  if (loading) {
    return (
      <div className="h-full overflow-y-auto p-10 space-y-10 bg-[#000000] relative">
        <TechnicalGrid opacity={0.15} />
        <div className="max-w-[1400px] mx-auto space-y-12 relative z-10 w-full">
            <SkeletonLoader variant="card" count={4} className="grid grid-cols-4 gap-6" />
            <SkeletonLoader variant="card" className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-custom bg-[#000000] relative selection:bg-[var(--accent-mint)]/30">
      <TechnicalGrid opacity={0.15} />
      
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="max-w-[1400px] mx-auto p-10 space-y-12 relative z-10"
      >
        {/* Sector Header */}
        <SectorHUD 
          sectorId="TELE-08" 
          title="Global_Neural_Telemetry" 
          subtitle="In-depth analysis of synaptic flow, resource throughput, and behavioral patterns"
          accentColor="var(--accent-mint)"
          telemetry={[
            { label: "NODE_HEALTH", value: "99.99%", status: "optimal" },
            { label: "CPU_LOAD", value: "18%", status: "online" },
            { label: "LATENCY", value: `${data?.avgLatencyMs || 0}ms`, status: "optimal" }
          ]}
        />

        {/* Main Analytics Content */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
          
          {/* Token Flow Projection */}
          <motion.div variants={stagger.item} className="xl:col-span-2 glass-panel border border-white/5 rounded-3xl overflow-hidden bg-white/[0.01]">
             <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-4">
                    <div className="w-2 h-8 bg-[var(--accent-mint)] rounded-full" />
                    <div>
                        <h2 className="text-sm font-black text-white italic tracking-tight uppercase">Inference_Volume_Lattice</h2>
                        <p className="text-[8px] font-diag uppercase tracking-[0.3em] text-white/20">Temporal_Usage_Tracing</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-[8px] font-diag text-white/20 uppercase tracking-widest">Projection: Mode_Alpha</span>
                </div>
             </div>
             <div className="p-10 h-[450px]">
               <ReactECharts option={tokenLineOption} style={{ height: "100%", width: "100%" }} />
             </div>
          </motion.div>

          {/* Model Distribution Ring */}
          <motion.div variants={stagger.item} className="glass-panel border border-white/5 rounded-3xl overflow-hidden bg-white/[0.01]">
             <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-4">
                    <div className="w-2 h-8 bg-[var(--accent-blue)] rounded-full" />
                    <div>
                        <h2 className="text-sm font-black text-white italic tracking-tight uppercase">Entity_Distribution</h2>
                        <p className="text-[8px] font-diag uppercase tracking-[0.3em] text-white/20">Unit_Allocation_Ratio</p>
                    </div>
                </div>
             </div>
             <div className="p-10">
                <div className="relative h-64 w-full">
                    <ReactECharts option={pieOption} style={{ height: "100%", width: "100%" }} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-[9px] font-diag text-white/20 uppercase tracking-widest mb-1">Active_Units</span>
                        <span className="text-3xl font-black text-white tracking-tighter italic">
                            {data?.modelDistribution.length || 0}
                        </span>
                    </div>
                </div>
                <div className="mt-10 space-y-4">
                    {data?.modelDistribution.slice(0, 4).map((m, i) => (
                    <div key={i} className="flex items-center justify-between px-5 py-4 rounded-2xl bg-white/[0.02] border border-white/[0.03] hover:bg-white/[0.05] transition-all">
                        <div className="flex items-center gap-3">
                        <div className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-[11px] font-black text-white/60 uppercase tracking-tight">{m.model.split("/").pop()}</span>
                        </div>
                        <span className="text-[10px] font-mono text-white/30">{m.count} TRACE</span>
                    </div>
                    ))}
                </div>
             </div>
          </motion.div>
        </div>

        {/* Diagnostic Trace Log */}
        <motion.div variants={stagger.item} className="glass-panel border border-white/5 rounded-3xl overflow-hidden bg-white/[0.01]">
          <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
            <div className="flex items-center gap-4">
                <div className="w-2 h-8 bg-white/20 rounded-full" />
                <div>
                    <h2 className="text-sm font-black text-white italic tracking-tight uppercase">Central_Trace_Log</h2>
                    <p className="text-[8px] font-diag uppercase tracking-[0.3em] text-white/20">System_Event_Audit</p>
                </div>
            </div>
            <button className="flex items-center gap-3 px-5 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-[9px] font-black text-white/40 uppercase tracking-widest hover:bg-white/[0.08] hover:text-white hover:border-white/20 transition-all active:scale-95">
               <Share2 size={12} />
               Export_Manifest
            </button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#080808]">
                <tr>
                  <th className="text-left py-6 px-8 text-[9px] font-diag text-white/20 uppercase tracking-[0.4em]">Resource_Identity</th>
                  <th className="text-right py-6 px-8 text-[9px] font-diag text-white/20 uppercase tracking-[0.4em]">Latency_ms</th>
                  <th className="text-right py-6 px-8 text-[9px] font-diag text-white/20 uppercase tracking-[0.4em]">Vector_Volume</th>
                  <th className="text-right py-6 px-8 text-[9px] font-diag text-white/20 uppercase tracking-[0.4em]">Resource_Cost</th>
                  <th className="text-right py-6 px-8 text-[9px] font-diag text-white/20 uppercase tracking-[0.4em]">Temporal_Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {traces.map((t) => (
                  <tr key={t.id} className="group hover:bg-white/[0.02] transition-colors">
                    <td className="py-6 px-8">
                      <div className="flex items-center gap-4">
                        <div className="w-9 h-9 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-white/20 group-hover:text-[var(--accent-mint)] group-hover:border-[var(--accent-mint)]/30 transition-all">
                          <Activity size={16} />
                        </div>
                        <span className="text-[12px] font-black text-white/80 uppercase tracking-tight">{t.type}</span>
                      </div>
                    </td>
                    <td className="py-6 px-8 text-right">
                       <span className="text-[12px] font-mono font-bold text-[var(--accent-coral)]">{t.totalLatencyMs}ms</span>
                    </td>
                    <td className="py-6 px-8 text-right">
                       <span className="text-[12px] font-mono text-white/60">{formatNumber(t.totalTokens)}</span>
                    </td>
                    <td className="py-6 px-8 text-right">
                       <span className="text-[12px] font-mono text-[var(--accent-blue)] font-bold">{formatCost(t.totalCostUsd)}</span>
                    </td>
                    <td className="py-6 px-8 text-right">
                       <span className="text-[10px] text-white/30 font-diag uppercase tracking-widest">{new Date(t.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </motion.div>

      <StatsHUD 
        stats={[
          { label: "Total_Sessions", value: data?.totalConversations || 0, icon: <MessageSquare size={16} /> },
          { label: "Token_Velocity", value: formatNumber(data?.totalTokensUsed || 0), icon: <Zap size={16} />, color: "var(--accent-gold)" },
          { label: "Accum_Overhead", value: formatCost(data?.totalCostUsd || 0), icon: <Coins size={16} />, color: "var(--accent-blue)" },
          { label: "Latency_Sync", value: `${data?.avgLatencyMs || 0}ms`, icon: <Clock size={16} />, color: "var(--accent-coral)" }
        ]}
      />
    </div>
  );
}

