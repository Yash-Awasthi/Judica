import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type DragEvent,
} from "react";
import { useNavigate, useParams } from "react-router";
import { ReactFlow, 
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Save, Play, Trash2, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { ScrollArea } from "~/components/ui/scroll-area";
import { api } from "~/lib/api";
import { useAuth } from "~/context/AuthContext";

// --- Custom node component ---

const borderColors: Record<string, string> = {
  input: "border-emerald-500",
  llm: "border-indigo-500",
  output: "border-blue-500",
  condition: "border-yellow-500",
  tool: "border-purple-500",
  code: "border-gray-500",
};

const bgColors: Record<string, string> = {
  input: "bg-emerald-500/10",
  llm: "bg-indigo-500/10",
  output: "bg-blue-500/10",
  condition: "bg-yellow-500/10",
  tool: "bg-purple-500/10",
  code: "bg-gray-500/10",
};

function CustomNode({ data }: { data: Record<string, unknown> }) {
  const nodeType = (data.nodeType as string) ?? "input";
  const label = (data.label as string) ?? "Node";
  return (
    <div
      className={`rounded-lg border-2 ${borderColors[nodeType] ?? "border-gray-400"} ${bgColors[nodeType] ?? ""} bg-card px-4 py-3 text-sm shadow-md min-w-[140px]`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="font-medium text-card-foreground">{label}</div>
      {data.subtitle && (
        <div className="text-xs text-muted-foreground mt-0.5">
          {data.subtitle as string}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

// --- Node palette items ---

interface PaletteItem {
  nodeType: string;
  label: string;
  subtitle: string;
  color: string;
}

const paletteItems: PaletteItem[] = [
  { nodeType: "input", label: "Query Input", subtitle: "User input", color: "bg-emerald-500" },
  { nodeType: "llm", label: "LLM Node", subtitle: "Model call", color: "bg-indigo-500" },
  { nodeType: "output", label: "Result Output", subtitle: "Final output", color: "bg-blue-500" },
  { nodeType: "condition", label: "Branch/Condition", subtitle: "If/else", color: "bg-yellow-500" },
  { nodeType: "tool", label: "Tool Call", subtitle: "External tool", color: "bg-purple-500" },
  { nodeType: "code", label: "Code Block", subtitle: "Custom code", color: "bg-gray-500" },
];

// --- Workflow data types ---

interface WorkflowData {
  id: string;
  name: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
}

export default function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [workflowName, setWorkflowName] = useState("Untitled Workflow");
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  // Load workflow
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const data = await api.get<WorkflowData>(`/workflows/${id}`);
        setWorkflowName(data.name);
        if (data.nodes?.length) {
          setNodes(
            data.nodes.map((n) => ({ ...n, type: "custom" }))
          );
        }
        if (data.edges?.length) {
          setEdges(data.edges);
        }
      } catch {
        // silent
      }
    })();
  }, [id, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => setSelectedNode(node),
    []
  );

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  // Drag from palette
  function onDragStart(e: DragEvent, item: PaletteItem) {
    e.dataTransfer.setData("application/reactflow", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/reactflow");
    if (!raw) return;
    const item: PaletteItem = JSON.parse(raw);

    const newNode: Node = {
      id: `node-${Date.now()}`,
      type: "custom",
      position: { x: e.clientX - 300, y: e.clientY - 80 },
      data: {
        label: item.label,
        subtitle: item.subtitle,
        nodeType: item.nodeType,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }

  // Update selected node data
  function updateNodeData(key: string, value: string) {
    if (!selectedNode) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? { ...n, data: { ...n.data, [key]: value } }
          : n
      )
    );
    setSelectedNode((prev) =>
      prev ? { ...prev, data: { ...prev.data, [key]: value } } : null
    );
  }

  function deleteSelectedNode() {
    if (!selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
    setEdges((eds) =>
      eds.filter(
        (e) => e.source !== selectedNode.id && e.target !== selectedNode.id
      )
    );
    setSelectedNode(null);
  }

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    try {
      await api.put(`/workflows/${id}`, {
        name: workflowName,
        nodes,
        edges,
      });
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    if (!id) return;
    setRunning(true);
    try {
      await api.post(`/workflows/${id}/run`);
    } catch {
      // silent
    } finally {
      setRunning(false);
    }
  }

  function handleClear() {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b bg-card px-4 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate("/workflows")}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Input
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="h-7 w-56 border-none bg-transparent text-sm font-medium focus-visible:ring-0"
        />
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleClear}>
          Clear
        </Button>
        <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
          <Save className="size-3.5 mr-1" />
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" onClick={handleRun} disabled={running}>
          <Play className="size-3.5 mr-1" />
          {running ? "Running..." : "Run"}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - Node palette */}
        <div className="w-52 shrink-0 border-r bg-card/50 p-3">
          <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            Nodes
          </h3>
          <div className="space-y-2">
            {paletteItems.map((item) => (
              <div
                key={item.nodeType}
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                className="flex items-center gap-2.5 rounded-lg border bg-card p-2.5 text-sm cursor-grab hover:ring-1 hover:ring-primary/30 active:cursor-grabbing"
              >
                <div className={`size-2.5 rounded-full ${item.color}`} />
                <div>
                  <div className="text-xs font-medium">{item.label}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {item.subtitle}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div
          className="flex-1"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-background"
          >
            <Background gap={16} size={1} />
            <Controls className="!bg-card !border-border !shadow-sm" />
            <MiniMap
              className="!bg-card !border-border"
              nodeColor="#6366f1"
              maskColor="rgba(0,0,0,0.1)"
            />
          </ReactFlow>
        </div>

        {/* Right panel - Node config */}
        {selectedNode && (
          <div className="w-64 shrink-0 border-l bg-card/50 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Node Config</h3>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setSelectedNode(null)}
              >
                <X className="size-3" />
              </Button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input
                  value={(selectedNode.data.label as string) ?? ""}
                  onChange={(e) => updateNodeData("label", e.target.value)}
                  className="h-7 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Subtitle</Label>
                <Input
                  value={(selectedNode.data.subtitle as string) ?? ""}
                  onChange={(e) => updateNodeData("subtitle", e.target.value)}
                  className="h-7 text-xs"
                />
              </div>

              {(selectedNode.data.nodeType as string) === "llm" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Model</Label>
                  <select
                    value={(selectedNode.data.model as string) ?? "gpt-4"}
                    onChange={(e) => updateNodeData("model", e.target.value)}
                    className="flex h-7 w-full rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="gpt-4">GPT-4</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    <option value="claude-sonnet">Claude Sonnet</option>
                    <option value="claude-opus">Claude Opus</option>
                  </select>
                </div>
              )}

              <div className="pt-2">
                <Badge variant="secondary" className="text-[10px]">
                  Type: {(selectedNode.data.nodeType as string) ?? "unknown"}
                </Badge>
              </div>

              <Button
                variant="destructive"
                size="sm"
                className="w-full mt-4"
                onClick={deleteSelectedNode}
              >
                <Trash2 className="size-3 mr-1" />
                Delete Node
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
