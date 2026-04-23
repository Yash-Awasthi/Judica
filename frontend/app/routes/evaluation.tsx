import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ClipboardCheck, Loader2, Play } from "lucide-react";

interface EvalEntry {
  id: string;
  conversation: string;
  quality: number;
  coherence: number;
  consensus: number;
  diversity: number;
  date: string;
}

const mockEvals: EvalEntry[] = [
  {
    id: "ev_1",
    conversation: "API architecture discussion",
    quality: 88,
    coherence: 0.91,
    consensus: 0.76,
    diversity: 0.93,
    date: "2026-04-22",
  },
  {
    id: "ev_2",
    conversation: "ML model selection",
    quality: 79,
    coherence: 0.84,
    consensus: 0.68,
    diversity: 0.87,
    date: "2026-04-21",
  },
  {
    id: "ev_3",
    conversation: "Security review",
    quality: 92,
    coherence: 0.95,
    consensus: 0.81,
    diversity: 0.79,
    date: "2026-04-21",
  },
  {
    id: "ev_4",
    conversation: "Database schema design",
    quality: 55,
    coherence: 0.61,
    consensus: 0.49,
    diversity: 0.95,
    date: "2026-04-20",
  },
  {
    id: "ev_5",
    conversation: "CI/CD pipeline setup",
    quality: 83,
    coherence: 0.88,
    consensus: 0.74,
    diversity: 0.91,
    date: "2026-04-20",
  },
  {
    id: "ev_6",
    conversation: "React state management",
    quality: 71,
    coherence: 0.77,
    consensus: 0.65,
    diversity: 0.88,
    date: "2026-04-19",
  },
  {
    id: "ev_7",
    conversation: "Docker containerization",
    quality: 90,
    coherence: 0.93,
    consensus: 0.79,
    diversity: 0.85,
    date: "2026-04-19",
  },
  {
    id: "ev_8",
    conversation: "GraphQL vs REST debate",
    quality: 48,
    coherence: 0.55,
    consensus: 0.41,
    diversity: 0.98,
    date: "2026-04-18",
  },
];

function scoreColor(value: number, isPercent = false): string {
  const v = isPercent ? value : value * 100;
  if (v >= 80) return "text-green-400";
  if (v >= 60) return "text-amber-400";
  return "text-red-400";
}

const avgQuality = Math.round(mockEvals.reduce((s, e) => s + e.quality, 0) / mockEvals.length);
const avgCoherence = (mockEvals.reduce((s, e) => s + e.coherence, 0) / mockEvals.length).toFixed(2);
const avgConsensus = (mockEvals.reduce((s, e) => s + e.consensus, 0) / mockEvals.length).toFixed(2);
const avgDiversity = (mockEvals.reduce((s, e) => s + e.diversity, 0) / mockEvals.length).toFixed(2);

export default function EvaluationPage() {
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = async () => {
    setIsRunning(true);
    await new Promise((res) => setTimeout(res, 2000));
    setIsRunning(false);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="size-6 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold">Evaluation</h1>
              <p className="text-sm text-muted-foreground">
                Measure and track quality metrics across AI council conversations
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-2" onClick={handleRun} disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="size-3.5" />
                Run Evaluation
              </>
            )}
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-normal">
                Average Quality
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${scoreColor(avgQuality, true)}`}>
                {avgQuality}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-normal">
                Coherence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${scoreColor(Number(avgCoherence))}`}>
                {avgCoherence}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-normal">
                Consensus
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${scoreColor(Number(avgConsensus))}`}>
                {avgConsensus}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-normal">
                Diversity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${scoreColor(Number(avgDiversity))}`}>
                {avgDiversity}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Evaluation History Table */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Evaluation History</h2>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Conversation
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">
                      Quality
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">
                      Coherence
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">
                      Consensus
                    </th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">
                      Diversity
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mockEvals.map((ev, i) => (
                    <tr
                      key={ev.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${
                        i % 2 === 0 ? "" : "bg-muted/10"
                      }`}
                    >
                      <td className="px-4 py-3 font-medium">{ev.conversation}</td>
                      <td className={`px-4 py-3 text-center font-mono font-semibold ${scoreColor(ev.quality, true)}`}>
                        {ev.quality}%
                      </td>
                      <td className={`px-4 py-3 text-center font-mono font-semibold ${scoreColor(ev.coherence)}`}>
                        {ev.coherence.toFixed(2)}
                      </td>
                      <td className={`px-4 py-3 text-center font-mono font-semibold ${scoreColor(ev.consensus)}`}>
                        {ev.consensus.toFixed(2)}
                      </td>
                      <td className={`px-4 py-3 text-center font-mono font-semibold ${scoreColor(ev.diversity)}`}>
                        {ev.diversity.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{ev.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
