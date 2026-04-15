import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";

import { MessageSquare, Zap, Clock, Database, Wifi, Cpu } from "lucide-react";
import { AnimatedCounter } from "../components/AnimatedCounter";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import type { UserMetrics } from "../types/index";

export function MetricsView() {
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const { fetchWithAuth } = useAuth();


  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetchWithAuth("/api/metrics");
        if (res.ok) {
          const data = await res.json() as { metrics: UserMetrics };
          setMetrics(data.metrics);
        }
      } catch (err) {
        console.error("Failed to fetch metrics", err);
      }
    };
    fetchMetrics();
  }, [fetchWithAuth]);

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
            sectorId="SYS-01"
            title="Real-Time_Telemetry"
            subtitle="Live Neural Activity // Resource Consumption"
            accentColor="var(--accent-mint)"
            telemetry={[
              { label: "LINK_STATUS", value: "UPLINK_STABLE", status: "optimal" },
              { label: "SYNC_FREQ", value: "1.2ms", status: "online" },
              { label: "LOAD_BAL", value: "NOMINAL", status: "optimal" }
            ]}
          />

        {/* Primary Metrics Grid */}
        {!metrics ? (
          <div className="h-[400px] flex flex-col items-center justify-center gap-6 surface-card border-dashed">
            <div className="relative">
              <div className="w-12 h-12 border-2 border-[var(--accent-mint)]/20 rounded-full" />
              <div className="absolute inset-0 border-2 border-[var(--accent-mint)] border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--accent-mint)] animate-pulse">Establishing Link</span>
              <span className="text-[9px] font-mono text-[var(--text-muted)] opacity-40">Syncing with Central Registry...</span>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: <MessageSquare size={16} />, label: "Total Inferences", value: metrics.totalRequests || 0, color: "var(--accent-mint)", subtext: "Accumulated" },
                { icon: <Wifi size={16} />, label: "Active Sessions", value: metrics.totalConversations || 0, color: "var(--accent-blue)", subtext: "Neural Threads" },
                { icon: <Zap size={16} />, label: "Cache Efficiency", value: metrics.cache?.hitRatePercentage || 0, color: "var(--accent-gold)", subtext: `${metrics.cache?.hits || 0} Optimizations`, suffix: "%" },
                { icon: <Clock size={16} />, label: "Response Latency", value: ((metrics.performance?.averageLatencyMs || 0) / 1000).toFixed(1), color: "#a78bfa", subtext: "Mean Cycle Time", suffix: "s", noCounter: true },
              ].map(({ icon, label, value, color, subtext, suffix, noCounter }) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="surface-card p-6 border-t-2 group"
                  style={{ borderTopColor: color }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-lg bg-white/[0.03] text-white/40 group-hover:text-white transition-colors" style={{ color: color }}>
                      {icon}
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse opacity-40" style={{ color }} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest">{label}</p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black text-white font-mono tracking-tighter">
                        {noCounter ? value : <AnimatedCounter value={Number(value)} suffix={suffix} />}
                      </span>
                    </div>
                    <p className="text-[9px] font-mono text-[var(--text-muted)] opacity-40 uppercase tracking-widest">{subtext}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Large Token Consumption Panel */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="surface-card p-10 bg-[radial-gradient(circle_at_0%_0%,rgba(110,231,183,0.05)_0%,transparent_50%)] relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.05] transition-opacity">
                <Database size={200} />
              </div>
              
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-10">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] shadow-glow-sm">
                      <Cpu size={24} />
                    </div>
                    <div>
                      <h4 className="text-[11px] font-black uppercase tracking-[0.3em] text-[var(--accent-mint)]">Neural Load Aggregate</h4>
                      <p className="text-[10px] font-mono text-[var(--text-muted)] opacity-60">Cumulative Token Throughput</p>
                    </div>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-6xl font-black text-white tracking-tighter font-mono">
                      <AnimatedCounter value={metrics.performance?.totalTokensUsed || 0} />
                    </span>
                    <span className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest opacity-40">Processed</span>
                  </div>
                </div>

                <div className="flex-1 max-w-md space-y-4">
                   <div className="flex justify-between text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
                      <span>Network Quota</span>
                      <span>84% Reserved</span>
                   </div>
                   <div className="h-2 w-full bg-white/[0.03] rounded-full overflow-hidden p-[1px] border border-white/5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: "84%" }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-[var(--accent-mint)] to-[var(--accent-blue)] rounded-full shadow-[0_0_15px_rgba(110,231,183,0.3)]"
                      />
                   </div>
                   <p className="text-[9px] text-[var(--text-muted)] leading-relaxed italic opacity-40">
                     System resources are dynamically allocated based on council synergy levels. Current throughput is within optimal operational range.
                   </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        </motion.div>
      </div>
    </div>
  );

}
