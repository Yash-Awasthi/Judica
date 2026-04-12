import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import ReactECharts from "echarts-for-react";
import { Activity, Coins, Clock, MessageSquare, BarChart3 } from "lucide-react";
import { AnimatedCounter } from "../components/AnimatedCounter";
import { SkeletonLoader } from "../components/SkeletonLoader";

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
  container: { animate: { transition: { staggerChildren: 0.08 } } },
  item: { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } },
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
        fetchWithAuth("/api/traces?limit=10"),
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

  if (loading) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        <SkeletonLoader variant="card" count={4} className="grid grid-cols-4 gap-4" />
        <SkeletonLoader variant="card" count={2} className="grid grid-cols-2 gap-6" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-muted)]">
        <div className="text-center">
          <BarChart3 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Failed to load analytics data.</p>
        </div>
      </div>
    );
  }

  const tokenLineOption = useMemo(() => ({
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: "var(--bg-surface-1)",
      borderColor: "var(--border-medium)",
      textStyle: { color: "var(--text-primary)", fontSize: 12 },
    },
    grid: { left: 40, right: 16, top: 16, bottom: 30 },
    xAxis: {
      type: "category" as const,
      data: data.dailyUsage.map(d => d.date.slice(5)),
      axisLine: { lineStyle: { color: "var(--border-subtle)" } },
      axisLabel: { color: "var(--text-muted)", fontSize: 10 },
    },
    yAxis: {
      type: "value" as const,
      axisLine: { lineStyle: { color: "var(--border-subtle)" } },
      axisLabel: { color: "var(--text-muted)", fontSize: 10 },
      splitLine: { lineStyle: { color: "var(--border-subtle)", type: "dashed" as const } },
    },
    series: [{
      data: data.dailyUsage.map(d => d.tokens),
      type: "line" as const,
      smooth: true,
      lineStyle: { color: "#6ee7b7", width: 2 },
      itemStyle: { color: "#6ee7b7" },
      showSymbol: false,
      areaStyle: { color: "rgba(110,231,183,0.08)" },
    }],
  }), [data.dailyUsage]);

  const costBarOption = useMemo(() => ({
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: "var(--bg-surface-1)",
      borderColor: "var(--border-medium)",
      textStyle: { color: "var(--text-primary)", fontSize: 12 },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        return `${p.name}<br/>Cost: $${Number(p.value).toFixed(4)}`;
      },
    },
    grid: { left: 40, right: 16, top: 16, bottom: 30 },
    xAxis: {
      type: "category" as const,
      data: data.dailyUsage.map(d => d.date.slice(5)),
      axisLine: { lineStyle: { color: "var(--border-subtle)" } },
      axisLabel: { color: "var(--text-muted)", fontSize: 10 },
    },
    yAxis: {
      type: "value" as const,
      axisLine: { lineStyle: { color: "var(--border-subtle)" } },
      axisLabel: { color: "var(--text-muted)", fontSize: 10 },
      splitLine: { lineStyle: { color: "var(--border-subtle)", type: "dashed" as const } },
    },
    series: [{
      data: data.dailyUsage.map(d => d.cost),
      type: "bar" as const,
      barBorderRadius: [4, 4, 0, 0],
      itemStyle: { color: "#60a5fa" },
    }],
  }), [data.dailyUsage]);

  const pieOption = useMemo(() => ({
    tooltip: {
      backgroundColor: "var(--bg-surface-1)",
      borderColor: "var(--border-medium)",
      textStyle: { color: "var(--text-primary)", fontSize: 12 },
    },
    legend: {
      bottom: 0,
      textStyle: { color: "var(--text-muted)", fontSize: 11 },
    },
    series: [{
      type: "pie" as const,
      radius: ["30%", "65%"],
      center: ["50%", "45%"],
      data: data.modelDistribution.map((d, i) => ({
        name: d.model.split("/").pop() || d.model,
        value: d.count,
        itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] },
      })),
      label: {
        formatter: "{b} {d}%",
        color: "var(--text-muted)",
        fontSize: 11,
      },
      emphasis: {
        itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,0.3)" },
      },
    }],
  }), [data.modelDistribution]);

  return (
    <div className="h-full overflow-y-auto scrollbar-custom p-6">
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="max-w-6xl mx-auto space-y-6"
      >
        <motion.div variants={stagger.item} className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Analytics</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Platform usage and cost insights</p>
          </div>
        </motion.div>

        {/* KPI Cards */}
        <motion.div variants={stagger.item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard icon={<MessageSquare size={20} />} label="Conversations" value={data.totalConversations} />
          <KPICard icon={<Activity size={20} />} label="Total Tokens" value={data.totalTokensUsed} formatted={formatNumber(data.totalTokensUsed)} />
          <KPICard icon={<Coins size={20} />} label="Total Cost" value={0} formatted={formatCost(data.totalCostUsd)} />
          <KPICard icon={<Clock size={20} />} label="Avg Latency" value={0} formatted={data.avgLatencyMs + "ms"} />
        </motion.div>

        {/* Charts */}
        <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Token usage line chart */}
          <div className="surface-card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Daily Token Usage (30d)</h2>
            <div className="h-64">
              <ReactECharts option={tokenLineOption} style={{ height: "100%", width: "100%" }} />
            </div>
          </div>

          {/* Cost bar chart */}
          <div className="surface-card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Daily Cost Breakdown</h2>
            <div className="h-64">
              <ReactECharts option={costBarOption} style={{ height: "100%", width: "100%" }} />
            </div>
          </div>
        </motion.div>

        {/* Pie + Traces */}
        <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Model distribution */}
          <div className="surface-card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Model Distribution</h2>
            <div className="h-64">
              {data.modelDistribution.length > 0 ? (
                <ReactECharts option={pieOption} style={{ height: "100%", width: "100%" }} />
              ) : (
                <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">
                  No model data yet
                </div>
              )}
            </div>
          </div>

          {/* Traces table */}
          <div className="surface-card p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Recent Traces</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                    <th className="text-left py-2 px-2 font-semibold">Type</th>
                    <th className="text-right py-2 px-2 font-semibold">Latency</th>
                    <th className="text-right py-2 px-2 font-semibold">Tokens</th>
                    <th className="text-right py-2 px-2 font-semibold">Cost</th>
                    <th className="text-right py-2 px-2 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {traces
                    .sort((a, b) => b.totalLatencyMs - a.totalLatencyMs)
                    .map((t) => (
                      <tr key={t.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--glass-bg-hover)] transition-colors">
                        <td className="py-2 px-2 text-[var(--text-primary)]">{t.type}</td>
                        <td className="py-2 px-2 text-right text-[var(--text-secondary)] font-mono">{t.totalLatencyMs}ms</td>
                        <td className="py-2 px-2 text-right text-[var(--text-secondary)] font-mono">{formatNumber(t.totalTokens)}</td>
                        <td className="py-2 px-2 text-right text-[var(--text-secondary)] font-mono">{formatCost(t.totalCostUsd)}</td>
                        <td className="py-2 px-2 text-right text-[var(--text-muted)]">
                          {new Date(t.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  {traces.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-[var(--text-muted)] italic">
                        No traces recorded yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function KPICard({ icon, label, value, formatted }: { icon: React.ReactNode; label: string; value: number; formatted?: string }) {
  return (
    <div className="surface-card p-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-[rgba(110,231,183,0.08)] border border-[rgba(110,231,183,0.12)] flex items-center justify-center text-[var(--accent-mint)] shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] font-bold">{label}</p>
        <p className="text-xl font-bold text-[var(--text-primary)] mt-0.5">
          {formatted || <AnimatedCounter value={value} />}
        </p>
      </div>
    </div>
  );
}
