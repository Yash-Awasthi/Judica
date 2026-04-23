import { useState, useMemo } from "react";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
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

const initialEvals: EvalEntry[] = [
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

const sampleTopics = [
  "Microservices vs monolith architecture",
  "TypeScript strict mode adoption",
  "Zero-trust security model",
  "Event-driven architecture patterns",
  "Serverless cost optimization",
  "AI code review automation",
  "Kubernetes cluster scaling strategy",
  "Data lake governance policies",
  "Frontend framework migration plan",
  "Real-time collaboration features",
];

function scoreColor(value: number, isPercent = false): string {
  const v = isPercent ? value : value * 100;
  if (v >= 80) return "text-green-400";
  if (v >= 60) return "text-amber-400";
  return "text-red-400";
}

export default function EvaluationPage() {
  const [evals, setEvals] = useState<EvalEntry[]>(initialEvals);
  const [isRunning, setIsRunning] = useState(false);
  const [customTopic, setCustomTopic] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { avgQuality, avgCoherence, avgConsensus, avgDiversity } =
    useMemo(() => {
      const len = evals.length;
      if (len === 0)
        return {
          avgQuality: 0,
          avgCoherence: "0.00",
          avgConsensus: "0.00",
          avgDiversity: "0.00",
        };
      return {
        avgQuality: Math.round(
          evals.reduce((s, e) => s + e.quality, 0) / len
        ),
        avgCoherence: (
          evals.reduce((s, e) => s + e.coherence, 0) / len
        ).toFixed(2),
        avgConsensus: (
          evals.reduce((s, e) => s + e.consensus, 0) / len
        ).toFixed(2),
        avgDiversity: (
          evals.reduce((s, e) => s + e.diversity, 0) / len
        ).toFixed(2),
      };
    }, [evals]);

  const handleRun = async () => {
    setIsRunning(true);
    setError(null);

    const topic =
      customTopic.trim() ||
      sampleTopics[Math.floor(Math.random() * sampleTopics.length)];

    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Evaluation failed");
        setIsRunning(false);
        return;
      }

      const newEntry: EvalEntry = {
        id: `ev_${Date.now()}`,
        conversation: topic,
        quality: data.quality,
        coherence: data.coherence,
        consensus: data.consensus,
        diversity: data.diversity,
        date: new Date().toISOString().split("T")[0],
      };

      setEvals((prev) => [newEntry, ...prev]);
      setCustomTopic("");
    } catch (err: any) {
      setError(err?.message ?? "Network error");
    } finally {
      setIsRunning(false);
    }
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
                Measure and track quality metrics across AI council
                conversations
              </p>
            </div>
          </div>
        </div>

        {/* Topic input + run button */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
            placeholder="Enter a topic to evaluate (or leave blank for a random one)..."
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isRunning}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isRunning) handleRun();
            }}
          />
          <Button
            size="sm"
            className="gap-2"
            onClick={handleRun}
            disabled={isRunning}
          >
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

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-normal">
                Average Quality
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={`text-2xl font-bold ${scoreColor(avgQuality, true)}`}
              >
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
              <p
                className={`text-2xl font-bold ${scoreColor(Number(avgCoherence))}`}
              >
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
              <p
                className={`text-2xl font-bold ${scoreColor(Number(avgConsensus))}`}
              >
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
              <p
                className={`text-2xl font-bold ${scoreColor(Number(avgDiversity))}`}
              >
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
                  {evals.map((ev, i) => (
                    <tr
                      key={ev.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${
                        i % 2 === 0 ? "" : "bg-muted/10"
                      }`}
                    >
                      <td className="px-4 py-3 font-medium">
                        {ev.conversation}
                      </td>
                      <td
                        className={`px-4 py-3 text-center font-mono font-semibold ${scoreColor(ev.quality, true)}`}
                      >
                        {ev.quality}%
                      </td>
                      <td
                        className={`px-4 py-3 text-center font-mono font-semibold ${scoreColor(ev.coherence)}`}
                      >
                        {ev.coherence.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 text-center font-mono font-semibold ${scoreColor(ev.consensus)}`}
                      >
                        {ev.consensus.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 text-center font-mono font-semibold ${scoreColor(ev.diversity)}`}
                      >
                        {ev.diversity.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {ev.date}
                      </td>
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
