import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { Store, Star, Download, Search } from "lucide-react";

const mockItems = [
  {
    id: "1",
    name: "The Architect",
    type: "archetype" as const,
    author: "aibyai",
    description: "Systems-level design thinking and architectural analysis",
    stars: 234,
    installs: 1847,
  },
  {
    id: "2",
    name: "Code Review Pipeline",
    type: "workflow" as const,
    author: "devtools-co",
    description: "Automated multi-pass code review with severity scoring",
    stars: 189,
    installs: 923,
  },
  {
    id: "3",
    name: "Research Synthesizer",
    type: "prompt" as const,
    author: "ml-research",
    description: "Structured research gathering and synthesis prompt chain",
    stars: 156,
    installs: 672,
  },
  {
    id: "4",
    name: "The Ethicist",
    type: "archetype" as const,
    author: "aibyai",
    description: "Ethical analysis, bias detection, and fairness evaluation",
    stars: 201,
    installs: 1523,
  },
  {
    id: "5",
    name: "Data Pipeline Builder",
    type: "workflow" as const,
    author: "dataeng-team",
    description: "Visual data pipeline construction with validation steps",
    stars: 98,
    installs: 412,
  },
  {
    id: "6",
    name: "API Generator",
    type: "skill" as const,
    author: "apicraft",
    description: "Generate REST/GraphQL APIs from natural language specifications",
    stars: 312,
    installs: 2341,
  },
  {
    id: "7",
    name: "Debate Moderator",
    type: "prompt" as const,
    author: "council-labs",
    description: "Controls multi-archetype debate flow and consensus building",
    stars: 87,
    installs: 345,
  },
  {
    id: "8",
    name: "Security Scanner",
    type: "skill" as const,
    author: "secteam",
    description: "Automated security vulnerability scanning and reporting",
    stars: 267,
    installs: 1892,
  },
];

const typeColors: Record<string, string> = {
  archetype: "bg-blue-500/20 text-blue-400",
  workflow: "bg-green-500/20 text-green-400",
  prompt: "bg-purple-500/20 text-purple-400",
  skill: "bg-amber-500/20 text-amber-400",
};

export default function MarketplacePage() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");

  const filtered = mockItems.filter((item) => {
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase());
    const matchesTab = tab === "all" || item.type === tab;
    return matchesSearch && matchesTab;
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Store className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Marketplace</h1>
            <p className="text-sm text-muted-foreground">
              Discover and install archetypes, workflows, prompts, and skills
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search marketplace..."
              className="pl-8"
            />
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="archetype">Archetypes</TabsTrigger>
            <TabsTrigger value="workflow">Workflows</TabsTrigger>
            <TabsTrigger value="prompt">Prompts</TabsTrigger>
            <TabsTrigger value="skill">Skills</TabsTrigger>
          </TabsList>

          <TabsContent value={tab}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
              {filtered.map((item) => (
                <Card
                  key={item.id}
                  className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{item.name}</CardTitle>
                      <Badge className={`text-[10px] ${typeColors[item.type]}`}>
                        {item.type}
                      </Badge>
                    </div>
                    <CardDescription>{item.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>by {item.author}</span>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Star className="size-3" />
                          {item.stars}
                        </span>
                        <span className="flex items-center gap-1">
                          <Download className="size-3" />
                          {item.installs.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  No items found matching your search.
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
