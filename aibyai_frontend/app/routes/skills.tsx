import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import {
  Zap,
  Search,
  Plus,
  Code2,
  X,
} from "lucide-react";
import gsap from "gsap";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { api } from "~/lib/api";
import { useAuth } from "~/context/AuthContext";
import { useTheme } from "~/context/ThemeContext";

const Editor = lazy(() => import("@monaco-editor/react"));

interface Skill {
  id: string;
  name: string;
  description: string;
  language: string;
  code?: string;
  tags: string[];
}

const langColors: Record<string, string> = {
  python: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  javascript: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  typescript: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
};

export default function SkillsPage() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewSkill, setViewSkill] = useState<Skill | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const data = await api.get<Skill[]>("/skills");
      setSkills(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    if (!loading && gridRef.current) {
      const cards = gridRef.current.querySelectorAll("[data-card]");
      gsap.fromTo(
        cards,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, stagger: 0.06, duration: 0.4, ease: "power2.out" }
      );
    }
  }, [loading, skills.length]);

  const filtered = skills.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  async function openCode(skill: Skill) {
    if (skill.code) {
      setViewSkill(skill);
      return;
    }
    try {
      const full = await api.get<Skill>(`/skills/${skill.id}`);
      setViewSkill(full);
    } catch {
      setViewSkill({ ...skill, code: "// Could not load code" });
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse and manage AI skill functions
            </p>
          </div>
          <Button disabled>
            <Plus className="size-4 mr-1.5" />
            Create Skill
          </Button>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted mt-2" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-2xl bg-muted/50 p-6 mb-4">
              <Zap className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium">
              {search ? "No matching skills" : "No skills yet"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {search
                ? "Try a different search term."
                : "Skills will appear here once they are created."}
            </p>
          </div>
        ) : (
          <div
            ref={gridRef}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {filtered.map((skill) => {
              const langClass =
                langColors[skill.language.toLowerCase()] ??
                "bg-muted text-muted-foreground";
              return (
                <Card key={skill.id} data-card>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="line-clamp-1">
                        {skill.name}
                      </CardTitle>
                      <Badge variant="secondary" className={langClass}>
                        {skill.language}
                      </Badge>
                    </div>
                    <CardDescription className="line-clamp-2">
                      {skill.description || "No description"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1 flex-wrap">
                        {skill.tags.slice(0, 3).map((t) => (
                          <Badge
                            key={t}
                            variant="outline"
                            className="text-[10px] h-4"
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => openCode(skill)}
                      >
                        <Code2 className="size-3 mr-1" />
                        View Code
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Code viewer dialog */}
      <Dialog open={!!viewSkill} onOpenChange={() => setViewSkill(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="size-4" />
              {viewSkill?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 rounded-lg overflow-hidden border">
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                  Loading editor...
                </div>
              }
            >
              <Editor
                height="400px"
                language={
                  viewSkill?.language.toLowerCase() === "python"
                    ? "python"
                    : "javascript"
                }
                theme={theme === "dark" ? "vs-dark" : "vs"}
                value={viewSkill?.code ?? "// Loading..."}
                options={{
                  readOnly: true,
                  fontSize: 13,
                  minimap: { enabled: false },
                  padding: { top: 12 },
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                }}
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
