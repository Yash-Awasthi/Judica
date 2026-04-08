import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
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
    <div className="flex-1 flex flex-col items-center justify-center p-4 bg-bg h-full overflow-y-auto">
      <div className="relative w-full max-w-lg glass-panel rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
        <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-accent text-base" style={{ fontVariationSettings: "'FILL' 1" }}>bar_chart</span>
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-text">Usage Statistics</h3>
              <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">Council Analytics</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors text-text-muted hover:text-text"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!metrics ? (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-text-muted">
              <span className="material-symbols-outlined animate-spin text-4xl text-accent">cycle</span>
              <span className="text-xs uppercase tracking-widest font-bold">Retrieving Data...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Total Requests", value: metrics.totalRequests || 0, color: "text-text" },
                { label: "Conversations", value: metrics.totalConversations || 0, color: "text-text" },
              ].map(({ label, value, color }) => (
                <div key={label} className="glass-panel p-5 rounded-xl border border-white/5">
                  <p className="text-[9px] text-text-muted uppercase font-black tracking-widest mb-1">{label}</p>
                  <p className={`text-3xl font-black ${color}`}>{value.toLocaleString()}</p>
                </div>
              ))}
              <div className="glass-panel p-5 rounded-xl border border-white/5">
                <p className="text-[9px] text-text-muted uppercase font-black tracking-widest mb-1">Cache Hit Rate</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-black text-accent">{metrics.cache?.hitRatePercentage || 0}%</p>
                  <p className="text-[10px] text-text-muted font-bold">({metrics.cache?.hits || 0} hits)</p>
                </div>
              </div>
              <div className="glass-panel p-5 rounded-xl border border-white/5">
                <p className="text-[9px] text-text-muted uppercase font-black tracking-widest mb-1">Avg Latency</p>
                <p className="text-3xl font-black text-text">{((metrics.performance?.averageLatencyMs || 0) / 1000).toFixed(1)}s</p>
              </div>
              <div className="col-span-2 p-5 rounded-xl border border-accent/20 bg-accent/5">
                <p className="text-[9px] text-accent uppercase font-black tracking-widest mb-1">Total Tokens Consumed</p>
                <p className="text-4xl font-black text-text">{(metrics.performance?.totalTokensUsed || 0).toLocaleString()}</p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex justify-end">
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 bg-accent text-black text-xs font-black uppercase tracking-widest rounded-lg transition-all hover:brightness-110"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
