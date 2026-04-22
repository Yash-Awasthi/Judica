/**
 * analytics-charts.tsx
 *
 * All Recharts components live here and are lazy-loaded from admin-analytics.tsx
 * via React.lazy(). This prevents Recharts from running during SSR, which causes
 * "window is not defined" errors in React Router 7 / Cloudflare Workers.
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";

// ─── Static chart data (deterministic — no Math.random()) ─────────────────────

const dailyConversations = [
  { day: "Mon", count: 32 },
  { day: "Tue", count: 45 },
  { day: "Wed", count: 28 },
  { day: "Thu", count: 64 },
  { day: "Fri", count: 52 },
  { day: "Sat", count: 18 },
  { day: "Sun", count: 47 },
];

// Deterministic 30-day data using sine-based pseudo-random values
const last30Days = Array.from({ length: 30 }, (_, i) => {
  const date = new Date("2026-04-22");
  date.setDate(date.getDate() - (29 - i));
  const requests = Math.floor(Math.abs(Math.sin(i * 7.13 + 1.5)) * 100 + 50);
  const cost = parseFloat((Math.abs(Math.sin(i * 3.77 + 0.9)) * 5 + 1).toFixed(2));
  return {
    date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    requests,
    cost,
  };
});

const xAxisTickFormatter = (_: string, index: number) =>
  index % 5 === 0 ? last30Days[index]?.date ?? "" : "";

const providerUsage = [
  { name: "OpenAI", value: 45, color: "#10b981" },
  { name: "Anthropic", value: 35, color: "#3b82f6" },
  { name: "Google", value: 12, color: "#f59e0b" },
  { name: "Mistral", value: 8, color: "#a855f7" },
];

const topModels = [
  { name: "gpt-4o", provider: "OpenAI", requests: 1240, tokens: "1.2M", cost: "$18.60" },
  { name: "claude-sonnet-4-6", provider: "Anthropic", requests: 890, tokens: "980K", cost: "$14.70" },
  { name: "gemini-2.0-flash", provider: "Google", requests: 340, tokens: "420K", cost: "$6.30" },
  { name: "mistral-large", provider: "Mistral", requests: 210, tokens: "200K", cost: "$8.23" },
];

// ─── Shared chart theme ────────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: "#1c1c1c",
  border: "1px solid #333",
  borderRadius: 8,
  fontSize: 12,
};

const GRID_PROPS = {
  strokeDasharray: "3 3" as const,
  stroke: "#333",
};

const AXIS_PROPS = {
  stroke: "#888" as const,
  fontSize: 12,
  tickLine: false,
  axisLine: false,
};

// ─── Custom PieChart label ─────────────────────────────────────────────────────

function renderPieLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
}) {
  if (percent < 0.08) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={500}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// ─── Default export (consumed by React.lazy in admin-analytics.tsx) ───────────

export default function AnalyticsCharts() {
  return (
    <div className="space-y-4">
      {/* Row 2: Bar chart + Pie chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily conversations bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Conversations</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyConversations} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="day" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: "#ccc" }}
                  itemStyle={{ color: "#10b981" }}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Conversations" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Provider usage pie chart */}
        <Card>
          <CardHeader>
            <CardTitle>Provider Usage</CardTitle>
            <CardDescription>Request distribution across providers</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="60%" height={200}>
                <PieChart>
                  <Pie
                    data={providerUsage}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                    labelLine={false}
                    label={renderPieLabel as any}
                  >
                    {providerUsage.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={{ color: "#ccc" }}
                    formatter={(value) => [`${value}%`, "Share"]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 flex-1">
                {providerUsage.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 text-sm">
                    <span
                      className="size-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="text-muted-foreground flex-1">{p.name}</span>
                    <span className="font-medium tabular-nums">{p.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: 30-day line chart */}
      <Card>
        <CardHeader>
          <CardTitle>Requests &amp; Costs Over Time</CardTitle>
          <CardDescription>Last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={last30Days} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="date"
                {...AXIS_PROPS}
                tickFormatter={xAxisTickFormatter}
                interval={0}
              />
              <YAxis yAxisId="left" {...AXIS_PROPS} />
              <YAxis
                yAxisId="right"
                orientation="right"
                {...AXIS_PROPS}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: "#ccc" }}
                itemStyle={{ fontSize: 12 }}
                cursor={{ stroke: "#444" }}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="requests"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                name="Requests"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cost"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                name="Cost ($)"
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground justify-center">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-emerald-500 inline-block" />
              Requests
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-amber-500 inline-block" />
              Cost
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Top models table */}
      <Card>
        <CardHeader>
          <CardTitle>Top Models</CardTitle>
          <CardDescription>Most used models by request count</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Model
                  </th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                    Provider
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">
                    Requests
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">
                    Tokens
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {topModels.map((model) => (
                  <tr key={model.name} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-3 text-sm font-medium font-mono">{model.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{model.provider}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">
                      {model.requests.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-muted-foreground tabular-nums">
                      {model.tokens}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">{model.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
