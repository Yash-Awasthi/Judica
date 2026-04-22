import { useState, useEffect } from "react";
import { api } from "~/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { LineChart } from "~/components/charts/LineChart";
import { Activity, PlayCircle, TrendingUp } from "lucide-react";

interface Evaluation {
  id: string; conversationId: string; coherence: number;
  consensus: number; diversity: number; quality: number; createdAt: string;
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cls = pct >= 80 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : pct >= 60 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-red-500/10 text-red-400 border-red-500/20";
  return <Badge className={`text-xs border ${cls}`}>{pct}%</Badge>;
}

export default function EvaluationPage() {
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Evaluation[]>("/evaluation").then(setEvals).catch(() => setEvals([])).finally(() => setLoading(false));
  }, []);

  const chartData = evals.slice(-14).map((e) => ({
    date: new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    Quality: Math.round(e.quality * 100),
    Coherence: Math.round(e.coherence * 100),
    Consensus: Math.round(e.consensus * 100),
  }));

  const avg = (key: keyof Evaluation) => evals.length ? Math.round((evals.reduce((s, e) => s + (e[key] as number), 0) / evals.length) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><Activity className="w-6 h-6 text-indigo-400" /><h1 className="text-2xl font-semibold">Evaluation</h1></div>
        <Button className="gap-2"><PlayCircle className="w-4 h-4" />Run Evaluation</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["quality","coherence","consensus","diversity"].map((k) => (
          <Card key={k}>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground capitalize">{k}</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold">{avg(k as keyof Evaluation)}%</p><Progress value={avg(k as keyof Evaluation)} className="mt-2 h-1" /></CardContent>
          </Card>
        ))}
      </div>

      {chartData.length > 0 && <LineChart data={chartData} title="Quality Over Time" xKey="date" yKeys={["Quality","Coherence","Consensus"]} height={280} />}

      {loading ? (
        <div className="space-y-3">{Array.from({length:4}).map((_,i)=><div key={i} className="h-16 rounded-lg bg-muted animate-pulse"/>)}</div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4"/>Evaluation History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {evals.map((e) => (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                  <div><p className="text-sm font-medium font-mono">{e.conversationId}</p><p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</p></div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Q</span><ScoreBadge score={e.quality} />
                    <span className="text-xs text-muted-foreground">C</span><ScoreBadge score={e.coherence} />
                    <span className="text-xs text-muted-foreground">D</span><ScoreBadge score={e.diversity} />
                  </div>
                </div>
              ))}
              {evals.length === 0 && <p className="text-center py-8 text-muted-foreground">No evaluations yet</p>}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
