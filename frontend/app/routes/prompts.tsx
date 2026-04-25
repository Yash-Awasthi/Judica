import { lazy, Suspense, useState, useCallback } from 'react';
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  FileText,
  Plus,
  Search,
  Save,
  Trash2,
  GitCommit,
  Tag,
  ChevronDown,
} from "lucide-react";

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

const mockPrompts = [
  {
    id: "p1",
    name: "System Architect",
    version: 4,
    model: "gpt-4o",
    tags: ["system", "architecture"],
    content: "You are The Architect, a systems-thinking AI archetype.\n\n## Role\nAnalyze complex systems and identify structural patterns, dependencies, and potential failure modes.\n\n## Instructions\n- Break down the problem into components\n- Identify interfaces between components\n- Evaluate scalability and maintainability\n- Consider {{context}} when analyzing\n\n## Output Format\n1. System Overview\n2. Component Analysis\n3. Dependency Map\n4. Recommendations",
  },
  {
    id: "p2",
    name: "Code Reviewer",
    version: 7,
    model: "claude-sonnet-4-6",
    tags: ["code", "review"],
    content: "You are a senior code reviewer.\n\n## Review Checklist\n- [ ] Correctness: Does the code do what it's supposed to?\n- [ ] Performance: Are there any O(n²) or worse algorithms?\n- [ ] Security: Any injection vectors, XSS, or auth issues?\n- [ ] Style: Does it follow {{project_style_guide}}?\n\n## Severity Levels\n- 🔴 Critical: Must fix before merge\n- 🟡 Warning: Should fix, but not blocking\n- 🟢 Suggestion: Nice to have improvement",
  },
  {
    id: "p3",
    name: "Research Synthesis",
    version: 2,
    model: "gpt-4o",
    tags: ["research", "analysis"],
    content: "Synthesize research from multiple sources into a coherent analysis.\n\n## Process\n1. Gather key findings from each source\n2. Identify common themes and contradictions\n3. Weight evidence by source reliability\n4. Generate synthesis with citations\n\n## Variables\n- Topic: {{topic}}\n- Sources: {{source_list}}\n- Depth: {{analysis_depth}}",
  },
  {
    id: "p4",
    name: "Debate Moderator",
    version: 3,
    model: "gemini-2.5-pro",
    tags: ["debate", "moderation"],
    content: "You moderate multi-agent debates.\n\n## Rules\n1. Each agent gets equal speaking time\n2. Encourage constructive disagreement\n3. Synthesize a verdict when consensus emerges\n4. Flag logical fallacies\n\n## Format\nRound {{round_number}} of {{total_rounds}}\nTopic: {{debate_topic}}",
  },
  {
    id: "p5",
    name: "Creative Brainstorm",
    version: 1,
    model: "claude-sonnet-4-6",
    tags: ["creative", "ideas"],
    content: "Generate creative solutions using divergent thinking.\n\n## Techniques\n- SCAMPER method\n- Random association\n- Constraint removal\n- Cross-domain analogy\n\n## Challenge\n{{challenge_description}}\n\n## Output\nGenerate 10 ideas, ranked by novelty and feasibility.",
  },
];

type Prompt = typeof mockPrompts[0];

const MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-sonnet-4-6",
  "claude-haiku",
  "gemini-2.5-pro",
];

function extractVariables(content: string): string[] {
  const matches = content.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, '').trim()))];
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>(mockPrompts);
  const [selectedId, setSelectedId] = useState<string>(mockPrompts[0].id);
  const [search, setSearch] = useState('');
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [editedModel, setEditedModel] = useState<Record<string, string>>({});
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  const selectedPrompt = prompts.find((p) => p.id === selectedId) || null;

  const currentContent = selectedId
    ? (editedContent[selectedId] ?? selectedPrompt?.content ?? '')
    : '';

  const currentModel = selectedId
    ? (editedModel[selectedId] ?? selectedPrompt?.model ?? 'gpt-4o')
    : 'gpt-4o';

  const variables = extractVariables(currentContent);

  const filteredPrompts = prompts.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  const handleContentChange = useCallback((value: string) => {
    if (!selectedId) return;
    setEditedContent((prev) => ({ ...prev, [selectedId]: value }));
  }, [selectedId]);

  const handleModelChange = useCallback((model: string) => {
    if (!selectedId) return;
    setEditedModel((prev) => ({ ...prev, [selectedId]: model }));
    setShowModelDropdown(false);
  }, [selectedId]);

  const handleSave = useCallback(() => {
    if (!selectedId) return;
    setPrompts((prev) =>
      prev.map((p) => {
        if (p.id !== selectedId) return p;
        return {
          ...p,
          content: editedContent[selectedId] ?? p.content,
          model: editedModel[selectedId] ?? p.model,
          version: p.version + 1,
        };
      })
    );
    setEditedContent((prev) => {
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
    setEditedModel((prev) => {
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
  }, [selectedId, editedContent, editedModel]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    const remaining = prompts.filter((p) => p.id !== selectedId);
    setPrompts(remaining);
    setSelectedId(remaining[0]?.id || '');
  }, [selectedId, prompts]);

  const handleNewPrompt = useCallback(() => {
    const newPrompt: Prompt = {
      id: `p-${Date.now()}`,
      name: "Untitled Prompt",
      version: 1,
      model: "gpt-4o",
      tags: [],
      content: "# New Prompt\n\nDescribe the role and instructions here.\n\n## Variables\n- Input: {{input}}",
    };
    setPrompts((prev) => [newPrompt, ...prev]);
    setSelectedId(newPrompt.id);
  }, []);

  const hasUnsavedChanges = selectedId && (
    (editedContent[selectedId] !== undefined && editedContent[selectedId] !== selectedPrompt?.content) ||
    (editedModel[selectedId] !== undefined && editedModel[selectedId] !== selectedPrompt?.model)
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left sidebar */}
      <div className="w-64 border-r border-border flex flex-col bg-background shrink-0">
        {/* Sidebar header */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Prompts</span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {prompts.length}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={handleNewPrompt}
              title="New prompt"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts..."
              className="h-7 pl-6 text-xs"
            />
          </div>
        </div>

        {/* Prompt list */}
        <ScrollArea className="flex-1">
          <div className="p-1.5 space-y-0.5">
            {filteredPrompts.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No prompts found</p>
            )}
            {filteredPrompts.map((prompt) => {
              const isSelected = prompt.id === selectedId;
              const isDirty = editedContent[prompt.id] !== undefined || editedModel[prompt.id] !== undefined;
              return (
                <button
                  key={prompt.id}
                  onClick={() => setSelectedId(prompt.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-md transition-colors ${
                    isSelected
                      ? 'bg-primary/10 text-foreground'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-medium truncate flex-1">{prompt.name}</span>
                    <Badge
                      variant="outline"
                      className="text-[9px] h-4 px-1 shrink-0 gap-0.5"
                    >
                      <GitCommit className="size-2" />
                      v{prompt.version}
                    </Badge>
                    {isDirty && (
                      <span className="size-1.5 rounded-full bg-orange-400 shrink-0" title="Unsaved changes" />
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {prompt.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] text-muted-foreground bg-muted px-1 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Main editor area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedPrompt ? (
          <>
            {/* Top bar */}
            <div className="h-12 border-b border-border flex items-center px-4 gap-3 bg-background shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium truncate">{selectedPrompt.name}</span>
                <Badge variant="outline" className="text-[10px] shrink-0 gap-0.5">
                  <GitCommit className="size-2.5" />
                  v{selectedPrompt.version}
                </Badge>
              </div>

              {/* Tags */}
              <div className="hidden md:flex items-center gap-1">
                <Tag className="size-3 text-muted-foreground" />
                {selectedPrompt.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] h-5">
                    {tag}
                  </Badge>
                ))}
              </div>

              {/* Model selector */}
              <div className="relative">
                <button
                  onClick={() => setShowModelDropdown((v) => !v)}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border text-xs hover:bg-muted transition-colors"
                >
                  <span className="text-muted-foreground">Model:</span>
                  <span className="font-medium">{currentModel}</span>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </button>
                {showModelDropdown && (
                  <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-md shadow-lg z-50 min-w-40 py-1">
                    {MODELS.map((m) => (
                      <button
                        key={m}
                        onClick={() => handleModelChange(m)}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${
                          m === currentModel ? 'text-primary font-medium' : ''
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                onClick={handleDelete}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleSave}
                disabled={!hasUnsavedChanges}
              >
                <Save className="size-3.5" />
                Save{hasUnsavedChanges ? ' *' : ''}
              </Button>
            </div>

            {/* Monaco Editor */}
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={
                <div className="flex-1 flex items-center justify-center text-muted-foreground h-full">
                  Loading editor...
                </div>
              }>
                <MonacoEditor
                  height="100%"
                  language="markdown"
                  theme="vs-dark"
                  value={currentContent}
                  onChange={(value) => handleContentChange(value || "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    wordWrap: "on",
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    padding: { top: 16 },
                  }}
                />
              </Suspense>
            </div>

            {/* Variable bar at bottom */}
            {variables.length > 0 && (
              <div className="h-10 border-t border-border flex items-center px-4 gap-2 bg-muted/30 shrink-0">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold shrink-0">
                  Variables
                </span>
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {variables.map((v) => (
                    <Badge
                      key={v}
                      variant="outline"
                      className="text-[10px] h-5 shrink-0 font-mono border-orange-500/40 text-orange-400 bg-orange-500/5"
                    >
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-2">
              <FileText className="size-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Select a prompt to edit</p>
              <Button size="sm" onClick={handleNewPrompt} className="gap-1.5">
                <Plus className="size-3.5" />
                New Prompt
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Click outside to close model dropdown */}
      {showModelDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowModelDropdown(false)}
        />
      )}
    </div>
  );
}
