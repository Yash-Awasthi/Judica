import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { BarChart2, TrendingUp, Coins, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useAuth } from "~/context/AuthContext";
import { api } from "~/lib/api";
import { LineChart } from "~/components/charts/LineChart";
import { BarChart } from "~/components/charts/BarChart";
import { DonutChart } from "~/components/charts/DonutChart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

interface UsageData {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  dailyBreakdown: { date: string; requests: number; tokens: number; cost: number }[];
}

interface AnalyticsData {
  agentPerformance: { name: string; avgScore: number; requests: number }[];
  modelUsage: { model: string; tokens: number; cost: number }[];
  deliberationQuality: { coherence: number; consensus: number; diversity: number };
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const cardsRef = useRef<HTMLDivElement>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<UsageData>("/usage").catch(() => null),
      api.get<AnalyticsData>("/analytics").catch(() => null),
    ]).then(([u, a]) => {
      setUsage(u);
      setAnalytics(a);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (loading || !cardsRef.current) return;
    const cards = cardsRef.current.querySelectorAll("[data-animate-card]");
    const ctx = gsap.context(() => {
      gsap.from(cards, {
        opacity: 0,
        y: 20,
        duration: 0.5,
        stagger: 0.08,
        ease: "power2.out",
      });
    });
    return () => ctx.revert();
  }, [loading]);

  const avgQuality = analytics
    ? (
        (analytics.deliberationQuality.coherence +
          analytics.deliberationQuality.consensus +
          analytics.deliberationQuality.diversity) /
        3
      ).toFixed(2)
    : "—";

  const statCards = [
    {
      label: "Total Requests",
      value: usage?.totalRequests.toLocaleString() ?? "—",
      icon: BarChart2,
      color: "text-chart-1",
    },
    {
      label: "Total Tokens",
      value: usage?.totalTokens.toLocaleString() ?? "—",
      icon: Activity,
      color: "text-chart-2",
    },
    {
      label: "Total Cost",
      value: usage ? `$${usage.totalCostUsd.toFixed(2)}` : "—",
      icon: Coins,
      color: "text-chart-3",
    },
    {
      label: "Avg Quality Score",
      value: avgQuality,
      icon: TrendingUp,
      color: "text-chart-4",
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading analytics...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" ref={cardsRef}>
      <div data-animate-card>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Platform usage, performance, and quality metrics.
        </p>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card
              key={stat.label}
              data-animate-card
              className="bg-card/60 backdrop-blur-sm border-border/50"
            >
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
                <p className="text-2xl font-semibold">{stat.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-animate-card className="bg-card/60 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Daily Requests & Cost</CardTitle>
          </CardHeader>
          <CardContent>
            {usage?.dailyBreakdown.length ? (
              <LineChart
                data={usage.dailyBreakdown}
                xKey="date"
                yKeys={[
                  { key: "requests", name: "Requests", color: "hsl(245, 58%, 51%)" },
                  { key: "cost", name: "Cost ($)", color: "hsl(270, 60%, 55%)" },
                ]}
                height={300}
              />
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                No daily data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-animate-card className="bg-card/60 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Agent Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics?.agentPerformance.length ? (
              <BarChart
                data={analytics.agentPerformance}
                xKey="name"
                yKeys={[
                  { key: "avgScore", name: "Avg Score", color: "hsl(200, 70%, 50%)" },
                  { key: "requests", name: "Requests", color: "hsl(150, 60%, 45%)" },
                ]}
                height={300}
              />
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                No agent data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model usage donut */}
        <Card data-animate-card className="bg-card/60 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Model Usage Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics?.modelUsage.length ? (
              <DonutChart
                data={analytics.modelUsage.map((m) => ({
                  name: m.model,
                  value: m.tokens,
                }))}
                height={300}
              />
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
                No model usage data
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deliberation quality table */}
        <Card data-animate-card className="bg-card/60 backdrop-blur-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Deliberation Quality</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      { label: "Coherence", value: analytics.deliberationQuality.coherence },
                      { label: "Consensus", value: analytics.deliberationQuality.consensus },
                      { label: "Diversity", value: analytics.deliberationQuality.diversity },
                    ] as const
                  ).map((metric) => (
                    <TableRow key={metric.label}>
                      <TableCell className="font-medium">{metric.label}</TableCell>
                      <TableCell>{metric.value.toFixed(3)}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            metric.value > 0.8
                              ? "bg-green-500/10 text-green-500"
                              : metric.value > 0.6
                                ? "bg-yellow-500/10 text-yellow-500"
                                : "bg-red-500/10 text-red-500"
                          }`}
                        >
                          {metric.value > 0.8
                            ? "Excellent"
                            : metric.value > 0.6
                              ? "Good"
                              : "Needs Improvement"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">
                No quality data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
