import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { X, BarChart3, MessageSquare, Zap, Clock, Database } from "lucide-react";
import { AnimatedCounter } from "../components/AnimatedCounter";
import type { UserMetrics } from "../types/index.js";

export function MetricsView() {
  const [metrics, setMetrics] = useState<UserMetrics | null>(null);
  const { fetchWithAuth } = useAuth();
  const navigate = useNavigate();

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
    <div className="flex-1 flex flex-col items-center justify-center p-4 bg-[var(--bg)] h-full overflow-y-auto scrollbar-custom">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-lg surface-card rounded-modal shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[rgba(110,231,183,0.08)] border border-[rgba(110,231,183,0.12)] flex items-center justify-center text-[var(--accent-mint)]">
              <BarChart3 size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-[var(--text-primary)]">Usage Statistics</h3>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-semibold">Council Analytics</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg flex items-center justify-center hover:bg-[var(--glass-bg-hover)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {!metrics ? (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-[var(--text-muted)]">
              <span className="w-8 h-8 border-2 border-[var(--accent-mint)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs uppercase tracking-widest font-bold">Retrieving Data...</span>
            </div>
          ) : (
            <motion.div
              initial="initial"
              animate="animate"
              variants={{ animate: { transition: { staggerChildren: 0.06 } } }}
              className="grid grid-cols-2 gap-3"
            >
              {[
                { icon: <MessageSquare size={14} />, label: "Total Requests", value: metrics.totalRequests || 0 },
                { icon: <MessageSquare size={14} />, label: "Conversations", value: metrics.totalConversations || 0 },
              ].map(({ icon, label, value }) => (
                <motion.div
                  key={label}
                  variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }}
                  className="glass-panel p-5 rounded-card"
                >
                  <div className="flex items-center gap-1.5 mb-2 text-[var(--accent-mint)]">
                    {icon}
                  </div>
                  <p className="text-[9px] text-[var(--text-muted)] uppercase font-bold tracking-widest mb-1">{label}</p>
                  <p className="text-3xl font-bold text-[var(--text-primary)]">
                    <AnimatedCounter value={value} />
                  </p>
                </motion.div>
              ))}

              <motion.div
                variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }}
                className="glass-panel p-5 rounded-card"
              >
                <div className="flex items-center gap-1.5 mb-2 text-[var(--accent-mint)]">
                  <Zap size={14} />
                </div>
                <p className="text-[9px] text-[var(--text-muted)] uppercase font-bold tracking-widest mb-1">Cache Hit Rate</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold text-[var(--accent-mint)]">
                    <AnimatedCounter value={metrics.cache?.hitRatePercentage || 0} suffix="%" />
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] font-mono">({metrics.cache?.hits || 0} hits)</p>
                </div>
              </motion.div>

              <motion.div
                variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }}
                className="glass-panel p-5 rounded-card"
              >
                <div className="flex items-center gap-1.5 mb-2 text-[var(--accent-blue)]">
                  <Clock size={14} />
                </div>
                <p className="text-[9px] text-[var(--text-muted)] uppercase font-bold tracking-widest mb-1">Avg Latency</p>
                <p className="text-3xl font-bold text-[var(--text-primary)]">
                  {((metrics.performance?.averageLatencyMs || 0) / 1000).toFixed(1)}s
                </p>
              </motion.div>

              <motion.div
                variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }}
                className="col-span-2 p-5 rounded-card border border-[rgba(110,231,183,0.15)] bg-[rgba(110,231,183,0.04)]"
              >
                <div className="flex items-center gap-1.5 mb-2 text-[var(--accent-mint)]">
                  <Database size={14} />
                </div>
                <p className="text-[9px] text-[var(--accent-mint)] uppercase font-bold tracking-widest mb-1">Total Tokens Consumed</p>
                <p className="text-4xl font-bold text-[var(--text-primary)]">
                  <AnimatedCounter value={metrics.performance?.totalTokensUsed || 0} />
                </p>
              </motion.div>
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[var(--glass-bg)] border-t border-[var(--border-subtle)] flex justify-end">
          <button
            onClick={() => navigate('/')}
            className="btn-pill-primary text-xs px-6 py-2"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
