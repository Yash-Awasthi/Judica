import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Users, Plus } from "lucide-react";

const archetypes = [
  {
    id: "architect",
    name: "The Architect",
    icon: "🏗️",
    color: "bg-blue-500/20 border-blue-500/30",
    thinkingStyle: "Systems Design",
    description: "Approaches problems through systems thinking, focusing on scalability, modularity, and long-term architectural decisions.",
  },
  {
    id: "pragmatist",
    name: "The Pragmatist",
    icon: "⚡",
    color: "bg-amber-500/20 border-amber-500/30",
    thinkingStyle: "Practical Solutions",
    description: "Favors battle-tested, production-ready solutions. Prioritizes shipping speed, maintainability, and developer experience.",
  },
  {
    id: "ethicist",
    name: "The Ethicist",
    icon: "⚖️",
    color: "bg-purple-500/20 border-purple-500/30",
    thinkingStyle: "Ethical Analysis",
    description: "Evaluates decisions through privacy, fairness, and societal impact lenses. Ensures compliance and responsible AI use.",
  },
  {
    id: "scientist",
    name: "The Scientist",
    icon: "🔬",
    color: "bg-green-500/20 border-green-500/30",
    thinkingStyle: "Empirical Reasoning",
    description: "Demands evidence and data. Designs experiments, questions assumptions, and follows the scientific method rigorously.",
  },
  {
    id: "creative",
    name: "The Creative",
    icon: "🎨",
    color: "bg-pink-500/20 border-pink-500/30",
    thinkingStyle: "Lateral Thinking",
    description: "Generates unconventional ideas and novel approaches. Excels at brainstorming and breaking out of established patterns.",
  },
  {
    id: "skeptic",
    name: "The Skeptic",
    icon: "🔍",
    color: "bg-red-500/20 border-red-500/30",
    thinkingStyle: "Critical Analysis",
    description: "Challenges assumptions, identifies logical fallacies, and stress-tests arguments. The devil's advocate of the council.",
  },
  {
    id: "mentor",
    name: "The Mentor",
    icon: "📚",
    color: "bg-cyan-500/20 border-cyan-500/30",
    thinkingStyle: "Educational",
    description: "Explains complex concepts clearly, provides learning paths, and adapts explanations to the audience's knowledge level.",
  },
  {
    id: "strategist",
    name: "The Strategist",
    icon: "♟️",
    color: "bg-indigo-500/20 border-indigo-500/30",
    thinkingStyle: "Strategic Planning",
    description: "Thinks in terms of long-term positioning, competitive advantage, and risk-reward trade-offs across multiple time horizons.",
  },
  {
    id: "optimizer",
    name: "The Optimizer",
    icon: "📈",
    color: "bg-emerald-500/20 border-emerald-500/30",
    thinkingStyle: "Performance Tuning",
    description: "Focuses on efficiency, performance, and resource optimization. Finds bottlenecks and eliminates waste systematically.",
  },
  {
    id: "historian",
    name: "The Historian",
    icon: "📜",
    color: "bg-orange-500/20 border-orange-500/30",
    thinkingStyle: "Historical Context",
    description: "Draws on historical precedents and patterns. Understands why past decisions were made and what can be learned from them.",
  },
  {
    id: "futurist",
    name: "The Futurist",
    icon: "🔮",
    color: "bg-violet-500/20 border-violet-500/30",
    thinkingStyle: "Forward Thinking",
    description: "Projects current trends forward, anticipates future challenges, and designs for tomorrow's requirements today.",
  },
  {
    id: "advocate",
    name: "The Advocate",
    icon: "🗣️",
    color: "bg-teal-500/20 border-teal-500/30",
    thinkingStyle: "User Empathy",
    description: "Champions the end user's perspective. Ensures solutions are accessible, intuitive, and genuinely solve user problems.",
  },
  {
    id: "guardian",
    name: "The Guardian",
    icon: "🛡️",
    color: "bg-slate-500/20 border-slate-500/30",
    thinkingStyle: "Security First",
    description: "Prioritizes security, reliability, and risk mitigation. Identifies vulnerabilities and ensures defense-in-depth.",
  },
];

export default function ArchetypesPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users className="size-6 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold">Archetypes</h1>
              <p className="text-sm text-muted-foreground">
                AI reasoning personas that bring diverse perspectives to your council
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-2">
            <Plus className="size-3.5" />
            Create Custom
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {archetypes.map((arch) => (
            <Card
              key={arch.id}
              className={`cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all border ${arch.color}`}
            >
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{arch.icon}</span>
                  <div>
                    <CardTitle className="text-sm">{arch.name}</CardTitle>
                    <span className="text-[11px] text-muted-foreground">{arch.thinkingStyle}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {arch.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
