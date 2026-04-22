import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  LayoutDashboard,
  MessageSquare,
  FolderOpen,
  GitBranch,
  Code2,
  Database,
  Zap,
  GitBranch as Github,
  Store,
  BarChart2,
  Shield,
  Settings,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";

interface CommandItem {
  label: string;
  icon: React.ElementType;
  path: string;
  keywords?: string[];
}

const commands: CommandItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard", keywords: ["home", "overview"] },
  { label: "Chat", icon: MessageSquare, path: "/chat", keywords: ["conversation", "message"] },
  { label: "Projects", icon: FolderOpen, path: "/projects", keywords: ["project"] },
  { label: "Workflows", icon: GitBranch, path: "/workflows", keywords: ["flow", "pipeline"] },
  { label: "Prompts IDE", icon: Code2, path: "/prompts", keywords: ["prompt", "editor", "code"] },
  { label: "Knowledge Base", icon: Database, path: "/knowledge", keywords: ["docs", "knowledge"] },
  { label: "Skills", icon: Zap, path: "/skills", keywords: ["skill", "ability"] },
  { label: "Repositories", icon: GitBranch as Github, path: "/repositories", keywords: ["repo", "git"] },
  { label: "Marketplace", icon: Store, path: "/marketplace", keywords: ["market", "store", "browse"] },
  { label: "Analytics", icon: BarChart2, path: "/analytics", keywords: ["stats", "metrics"] },
  { label: "Admin", icon: Shield, path: "/admin", keywords: ["admin", "manage"] },
  { label: "Settings", icon: Settings, path: "/settings", keywords: ["settings", "preferences"] },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = query.trim()
    ? commands.filter((cmd) => {
        const q = query.toLowerCase();
        return (
          cmd.label.toLowerCase().includes(q) ||
          cmd.keywords?.some((k) => k.includes(q))
        );
      })
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  const runCommand = useCallback(
    (cmd: CommandItem) => {
      onOpenChange(false);
      navigate(cmd.path);
    },
    [navigate, onOpenChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      runCommand(filtered[selectedIndex]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden" aria-describedby={undefined}>
        <div className="p-3 border-b border-border">
          <Input
            placeholder="Search commands..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="border-0 bg-transparent focus-visible:ring-0 text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No results found.
            </p>
          ) : (
            filtered.map((cmd, i) => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.path}
                  onClick={() => runCommand(cmd)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
                    i === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/80 hover:bg-accent/50"
                  }`}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span>{cmd.label}</span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
