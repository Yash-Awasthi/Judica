import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Activity, Coins, Clock, MessageSquare } from "lucide-react";

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
  "#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd",
  "#818cf8", "#7c3aed", "#5b21b6", "#4f46e5",
  "#4338ca", "#3730a3",
];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatCost(n: number): string {
  return "$" + n.toFixed(4);
}

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
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        Failed to load analytics data.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-text">Analytics</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={<MessageSquare size={20} />}
          label="Total Conversations"
          value={formatNumber(data.totalConversations)}
        />
        <KPICard
          icon={<Activity size={20} />}
          label="Total Tokens"
          value={formatNumber(data.totalTokensUsed)}
        />
        <KPICard
          icon={<Coins size={20} />}
          label="Total Cost"
          value={formatCost(data.totalCostUsd)}
        />
        <KPICard
          icon={<Clock size={20} />}
          label="Avg Latency"
          value={data.avgLatencyMs + "ms"}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily token usage line chart */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-text mb-4">Daily Token Usage (30d)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.dailyUsage}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }}
                />
                <Line type="monotone" dataKey="tokens" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost breakdown bar chart */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-text mb-4">Daily Cost Breakdown</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.dailyUsage}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }}
                  formatter={(value: number) => ["$" + value.toFixed(4), "Cost"]}
                />
                <Bar dataKey="cost" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Pie chart + traces table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model distribution pie chart */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-text mb-4">Model Distribution</h2>
          <div className="h-64">
            {data.modelDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.modelDistribution}
                    dataKey="count"
                    nameKey="model"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ model, percent }: { model: string; percent: number }) =>
                      `${model.split("/").pop()} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={{ stroke: "rgba(255,255,255,0.2)" }}
                  >
                    {data.modelDistribution.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#fff" }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-text-dim text-sm">
                No model data yet
              </div>
            )}
          </div>
        </div>

        {/* Recent traces table */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-text mb-4">Recent Traces (by latency)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-dim border-b border-white/[0.06]">
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-right py-2 px-2">Latency</th>
                  <th className="text-right py-2 px-2">Tokens</th>
                  <th className="text-right py-2 px-2">Cost</th>
                  <th className="text-right py-2 px-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {traces
                  .sort((a, b) => b.totalLatencyMs - a.totalLatencyMs)
                  .map((t) => (
                    <tr key={t.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="py-2 px-2 text-text">{t.type}</td>
                      <td className="py-2 px-2 text-right text-text-muted">{t.totalLatencyMs}ms</td>
                      <td className="py-2 px-2 text-right text-text-muted">{formatNumber(t.totalTokens)}</td>
                      <td className="py-2 px-2 text-right text-text-muted">{formatCost(t.totalCostUsd)}</td>
                      <td className="py-2 px-2 text-right text-text-dim">
                        {new Date(t.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                    </tr>
                  ))}
                {traces.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-text-dim">
                      No traces recorded yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/15 flex items-center justify-center text-accent shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-widest text-text-dim font-bold">{label}</p>
        <p className="text-xl font-bold text-text mt-0.5">{value}</p>
      </div>
    </div>
  );
}
