import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import {
  Code2,
  Plus,
  Save,
  Play,
  Trash2,
  Tag,
  FileText,
} from "lucide-react";
import gsap from "gsap";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import { api } from "~/lib/api";
import { useAuth } from "~/context/AuthContext";
import { useTheme } from "~/context/ThemeContext";

const Editor = lazy(() => import("@monaco-editor/react"));

interface Prompt {
  id: string;
  name: string;
  content: string;
  version: number;
  model: string;
  tags: string[];
}

export default function PromptsPage() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Prompt | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [model, setModel] = useState("gpt-4");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const fetchPrompts = useCallback(async () => {
    try {
      const data = await api.get<Prompt[]>("/prompts");
      setPrompts(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  useEffect(() => {
    if (!loading && listRef.current) {
      gsap.fromTo(
        listRef.current,
        { opacity: 0, x: -12 },
        { opacity: 1, x: 0, duration: 0.35, ease: "power2.out" }
      );
    }
  }, [loading]);

  function selectPrompt(p: Prompt) {
    setSelected(p);
    setEditorContent(p.content);
    setModel(p.model);
    setTagsInput(p.tags.join(", "));
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    try {
      const created = await api.post<Prompt>("/prompts", {
        name: newName.trim(),
        content: "",
        model: "gpt-4",
        tags: [],
      });
      setCreateOpen(false);
      setNewName("");
      await fetchPrompts();
      selectPrompt(created);
    } catch {
      // silent
    }
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.put(`/prompts/${selected.id}`, {
        content: editorContent,
        model,
        tags,
      });
      await fetchPrompts();
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.del(`/prompts/${id}`);
      if (selected?.id === id) {
        setSelected(null);
        setEditorContent("");
      }
      await fetchPrompts();
    } catch {
      // silent
    }
  }

  // Detect {{variable}} patterns
  const variables = Array.from(
    new Set(editorContent.match(/\{\{(\w+)\}\}/g)?.map((m) => m.slice(2, -2)) ?? [])
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar - prompt list */}
      <div
        ref={listRef}
        className="w-72 shrink-0 border-r bg-card/50 flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-semibold">Prompts</h2>
          <Button size="icon-xs" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 rounded-lg bg-muted/50 animate-pulse mb-1"
                  />
                ))
              : prompts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectPrompt(p)}
                    className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors group ${
                      selected?.id === p.id
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate">{p.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-[10px] h-4">
                        {p.model}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        v{p.version}
                      </span>
                    </div>
                    {p.tags.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {p.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="text-[9px] text-muted-foreground bg-muted rounded px-1"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}
            {!loading && prompts.length === 0 && (
              <div className="text-center py-8 text-xs text-muted-foreground">
                <FileText className="size-8 mx-auto mb-2 opacity-40" />
                No prompts yet
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right side - editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 border-b px-4 py-2">
              <h3 className="text-sm font-medium truncate">{selected.name}</h3>
              <div className="flex-1" />
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="h-7 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="gpt-4">GPT-4</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                <option value="claude-sonnet">Claude Sonnet</option>
                <option value="claude-opus">Claude Opus</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="size-3.5 mr-1" />
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm">
                <Play className="size-3.5 mr-1" />
                Run
              </Button>
            </div>

            {/* Monaco editor */}
            <div className="flex-1 min-h-0">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Loading editor...
                  </div>
                }
              >
                <Editor
                  height="100%"
                  language="markdown"
                  theme={theme === "dark" ? "vs-dark" : "vs"}
                  value={editorContent}
                  onChange={(v) => setEditorContent(v ?? "")}
                  options={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    wordWrap: "on",
                    minimap: { enabled: false },
                    padding: { top: 16 },
                    scrollBeyondLastLine: false,
                    renderLineHighlight: "none",
                  }}
                />
              </Suspense>
            </div>

            {/* Bottom panel - variables & tags */}
            <div className="border-t bg-card/50 px-4 py-3 space-y-3">
              {variables.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-2">
                    Variables
                  </Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {variables.map((v) => (
                      <div key={v} className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {`{{${v}}}`}
                        </Badge>
                        <Input
                          placeholder={`Value for ${v}...`}
                          className="h-6 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Tag className="size-3 text-muted-foreground" />
                <Input
                  placeholder="Tags (comma separated)"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="h-6 text-xs flex-1"
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="rounded-2xl bg-muted/50 p-6 mb-4">
              <Code2 className="size-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium">Prompts IDE</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Select a prompt from the sidebar or create a new one to start
              editing.
            </p>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Prompt</DialogTitle>
            <DialogDescription>
              Create a new prompt template.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="prompt-name">Name</Label>
            <Input
              id="prompt-name"
              placeholder="My Prompt"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
