import { Brain, Wrench, GitBranch, FileText, Code, Globe, UserCheck, Repeat, ArrowRightCircle, ArrowLeftCircle, Merge, Split } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";

const NODE_GROUPS = [
  {
    label: "Input / Output",
    items: [
      { type: "input", label: "Input", icon: ArrowRightCircle, color: "text-green-600" },
      { type: "output", label: "Output", icon: ArrowLeftCircle, color: "text-red-600" },
    ],
  },
  {
    label: "AI",
    items: [
      { type: "llm", label: "LLM", icon: Brain, color: "text-purple-600" },
    ],
  },
  {
    label: "Tools",
    items: [
      { type: "tool", label: "Tool", icon: Wrench, color: "text-orange-600" },
      { type: "http", label: "HTTP", icon: Globe, color: "text-blue-600" },
      { type: "code", label: "Code", icon: Code, color: "text-gray-600" },
    ],
  },
  {
    label: "Logic",
    items: [
      { type: "condition", label: "Condition", icon: GitBranch, color: "text-yellow-600" },
      { type: "template", label: "Template", icon: FileText, color: "text-teal-600" },
      { type: "loop", label: "Loop", icon: Repeat, color: "text-indigo-600" },
    ],
  },
  {
    label: "Control",
    items: [
      { type: "human_gate", label: "Human Gate", icon: UserCheck, color: "text-pink-600" },
      { type: "merge", label: "Merge", icon: Merge, color: "text-slate-600" },
      { type: "split", label: "Split", icon: Split, color: "text-slate-600" },
    ],
  },
];

export function NodePalette() {
  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const onKeyDown = (event: KeyboardEvent, nodeType: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // Dispatch a custom event that the workflow canvas can listen for
      const customEvent = new CustomEvent("nodePaletteAdd", {
        detail: { nodeType },
        bubbles: true,
      });
      event.currentTarget.dispatchEvent(customEvent);
    }
  };

  return (
    <div className="w-56 border-r border-gray-200 bg-gray-50 p-3 overflow-y-auto">
      <h3 className="font-semibold text-sm mb-3 text-gray-700">Nodes</h3>
      {NODE_GROUPS.map((group) => (
        <div key={group.label} className="mb-4">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{group.label}</div>
          <div className="space-y-1" role="list" aria-label={group.label}>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.type}
                  className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-gray-200 cursor-grab hover:border-blue-300 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  draggable
                  role="listitem"
                  tabIndex={0}
                  aria-label={`Add ${item.label} node`}
                  onDragStart={(e) => onDragStart(e, item.type)}
                  onKeyDown={(e) => onKeyDown(e, item.type)}
                >
                  <Icon size={14} className={item.color} />
                  <span className="text-xs font-medium text-gray-700">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
