import { useState, useCallback } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  GitBranch,
  Plus,
  CheckCircle,
  XCircle,
  Clock,
  Play,
  ChevronLeft,
  Save,
  MessageSquare,
  Brain,
  BarChart2,
  GitFork,
  Wrench,
  Code2,
  GripVertical,
} from "lucide-react";
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, useNodesState, useEdgesState, addEdge, type Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const mockWorkflows = [
  {
    id: "1",
    name: "Code Review Pipeline",
    description: "Automated code review with multiple archetype passes",
    nodeCount: 7,
    status: "success" as const,
    lastRun: "2 hours ago",
  },
  {
    id: "2",
    name: "Research Synthesis",
    description: "Gather, analyze, and synthesize research from multiple sources",
    nodeCount: 12,
    status: "success" as const,
    lastRun: "Yesterday",
  },
  {
    id: "3",
    name: "Content Generation",
    description: "Multi-stage content creation with editorial review",
    nodeCount: 5,
    status: "failed" as const,
    lastRun: "3 hours ago",
  },
  {
    id: "4",
    name: "Data Analysis Flow",
    description: "Ingest, clean, analyze, and visualize datasets",
    nodeCount: 9,
    status: "pending" as const,
    lastRun: "Never",
  },
  {
    id: "5",
    name: "Security Audit Chain",
    description: "Sequential security checks across codebase layers",
    nodeCount: 8,
    status: "success" as const,
    lastRun: "1 day ago",
  },
];

const statusConfig = {
  success: { icon: CheckCircle, label: "Success", color: "text-green-400" },
  failed: { icon: XCircle, label: "Failed", color: "text-red-400" },
  pending: { icon: Clock, label: "Pending", color: "text-yellow-400" },
};

const demoNodes: Node[] = [
  { id: '1', type: 'default', position: { x: 100, y: 100 }, data: { label: 'User Query', nodeType: 'input' }, style: { border: '2px solid #10b981', borderRadius: 8, background: '#0a0a0a', color: '#fff', padding: 12 } },
  { id: '2', type: 'default', position: { x: 100, y: 250 }, data: { label: 'GPT-4o Analysis', nodeType: 'llm' }, style: { border: '2px solid #3b82f6', borderRadius: 8, background: '#0a0a0a', color: '#fff', padding: 12 } },
  { id: '3', type: 'default', position: { x: 350, y: 250 }, data: { label: 'Claude Review', nodeType: 'llm' }, style: { border: '2px solid #3b82f6', borderRadius: 8, background: '#0a0a0a', color: '#fff', padding: 12 } },
  { id: '4', type: 'default', position: { x: 225, y: 400 }, data: { label: 'Merge Results', nodeType: 'tool' }, style: { border: '2px solid #06b6d4', borderRadius: 8, background: '#0a0a0a', color: '#fff', padding: 12 } },
  { id: '5', type: 'default', position: { x: 225, y: 550 }, data: { label: 'Final Output', nodeType: 'output' }, style: { border: '2px solid #f59e0b', borderRadius: 8, background: '#0a0a0a', color: '#fff', padding: 12 } },
];

const demoEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#555' } },
  { id: 'e1-3', source: '1', target: '3', animated: true, style: { stroke: '#555' } },
  { id: 'e2-4', source: '2', target: '4', style: { stroke: '#555' } },
  { id: 'e3-4', source: '3', target: '4', style: { stroke: '#555' } },
  { id: 'e4-5', source: '4', target: '5', style: { stroke: '#555' } },
];

const nodeTypeStyles: Record<string, { border: string; label: string; icon: React.ElementType; description: string }> = {
  input:  { border: '#10b981', label: 'Query Input',    icon: MessageSquare, description: 'Entry point for user input' },
  llm:    { border: '#3b82f6', label: 'LLM Node',       icon: Brain,         description: 'AI model processing step' },
  output: { border: '#f59e0b', label: 'Result Output',  icon: BarChart2,     description: 'Final output collector' },
  branch: { border: '#a855f7', label: 'Branch/Condition', icon: GitFork,     description: 'Conditional routing logic' },
  tool:   { border: '#06b6d4', label: 'Tool Call',      icon: Wrench,        description: 'External tool integration' },
  code:   { border: '#64748b', label: 'Code Block',     icon: Code2,         description: 'Custom code execution' },
};

function NodePalette({ onAddNode }: { onAddNode: (type: string) => void }) {
  return (
    <div className="w-56 border-r border-border flex flex-col bg-background shrink-0">
      <div className="p-3 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Node Palette</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Drag or click to add</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {Object.entries(nodeTypeStyles).map(([type, cfg]) => {
          const Icon = cfg.icon;
          return (
            <button
              key={type}
              onClick={() => onAddNode(type)}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors group border border-transparent hover:border-border"
            >
              <div
                className="size-7 rounded-md flex items-center justify-center shrink-0"
                style={{ background: `${cfg.border}20`, border: `1px solid ${cfg.border}` }}
              >
                <Icon className="size-3.5" style={{ color: cfg.border }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium leading-none">{cfg.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{cfg.description}</p>
              </div>
              <GripVertical className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 ml-auto shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PropertiesPanel({ selectedNode, onUpdateLabel }: { selectedNode: Node | null; onUpdateLabel: (id: string, label: string) => void }) {
  if (!selectedNode) {
    return (
      <div className="w-64 border-l border-border flex flex-col bg-background shrink-0">
        <div className="p-3 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Properties</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">Select a node to view its properties</p>
        </div>
      </div>
    );
  }

  const nodeType = (selectedNode.data?.nodeType as string) || 'input';
  const cfg = nodeTypeStyles[nodeType] || nodeTypeStyles.input;
  const Icon = cfg.icon;
  const label = (selectedNode.data?.label as string) || '';

  return (
    <div className="w-64 border-l border-border flex flex-col bg-background shrink-0">
      <div className="p-3 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Properties</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div className="flex items-center gap-2.5">
          <div
            className="size-8 rounded-md flex items-center justify-center shrink-0"
            style={{ background: `${cfg.border}20`, border: `1px solid ${cfg.border}` }}
          >
            <Icon className="size-4" style={{ color: cfg.border }} />
          </div>
          <div>
            <p className="text-xs font-medium">{cfg.label}</p>
            <p className="text-[10px] text-muted-foreground">Node ID: {selectedNode.id}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Label</label>
          <Input
            value={label}
            onChange={(e) => onUpdateLabel(selectedNode.id, e.target.value)}
            className="h-7 text-xs"
            placeholder="Node label..."
          />
        </div>

        {nodeType === 'llm' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <select className="w-full h-7 text-xs bg-background border border-border rounded-md px-2 text-foreground">
              <option>gpt-4o</option>
              <option>gpt-4o-mini</option>
              <option>claude-sonnet-4-6</option>
              <option>claude-haiku</option>
              <option>gemini-2.5-pro</option>
            </select>
          </div>
        )}

        {nodeType === 'branch' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Condition</label>
            <Input
              className="h-7 text-xs font-mono"
              placeholder="e.g. score > 0.8"
            />
          </div>
        )}

        {nodeType === 'code' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Language</label>
            <select className="w-full h-7 text-xs bg-background border border-border rounded-md px-2 text-foreground">
              <option>python</option>
              <option>javascript</option>
              <option>typescript</option>
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Node Type</label>
          <Badge variant="outline" className="text-[10px]" style={{ borderColor: cfg.border, color: cfg.border }}>
            {cfg.label}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function WorkflowEditor({ workflow, onBack }: { workflow: typeof mockWorkflows[0]; onBack: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(workflow.id === '1' ? demoNodes : []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(workflow.id === '1' ? demoEdges : []);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [nodeIdCounter, setNodeIdCounter] = useState(100);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, style: { stroke: '#555' } }, eds)),
    [setEdges]
  );

  const handleAddNode = useCallback((type: string) => {
    const cfg = nodeTypeStyles[type] || nodeTypeStyles.input;
    const newId = `node-${nodeIdCounter}`;
    setNodeIdCounter(c => c + 1);
    const newNode: Node = {
      id: newId,
      type: 'default',
      position: { x: 200 + Math.random() * 200, y: 200 + Math.random() * 200 },
      data: { label: cfg.label, nodeType: type },
      style: {
        border: `2px solid ${cfg.border}`,
        borderRadius: 8,
        background: '#0a0a0a',
        color: '#fff',
        padding: 12,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, [nodeIdCounter, setNodes]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleUpdateLabel = useCallback((id: string, label: string) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== id) return n;
        return { ...n, data: { ...n.data, label } };
      })
    );
    setSelectedNode((prev) => prev && prev.id === id ? { ...prev, data: { ...prev.data, label } } : prev);
  }, [setNodes]);

  return (
    <div className="flex flex-col" style={{ height: '100vh' }}>
      {/* Toolbar */}
      <div className="h-14 border-b border-border flex items-center px-4 gap-3 bg-background shrink-0 z-10">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ChevronLeft className="size-4" />
          Back
        </Button>
        <div className="w-px h-5 bg-border" />
        <GitBranch className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{workflow.name}</span>
        <Badge
          variant="outline"
          className={`text-[10px] ml-1 ${statusConfig[workflow.status].color}`}
        >
          {statusConfig[workflow.status].label}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{nodes.length} nodes · {edges.length} edges</span>
          <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs">
            <Play className="size-3" />
            Run
          </Button>
          <Button size="sm" className="gap-1.5 h-7 text-xs">
            <Save className="size-3" />
            Save
          </Button>
        </div>
      </div>

      {/* Editor layout */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette onAddNode={handleAddNode} />

        {/* Canvas */}
        <div className="flex-1" style={{ height: 'calc(100vh - 56px)' }}>
          <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              fitView
              style={{ background: '#0a0a0a' }}
            >
              <Background color="#333" gap={20} />
              <Controls />
              <MiniMap style={{ background: '#1a1a1a' }} nodeColor="#666" />
            </ReactFlow>
          </div>
        </div>

        <PropertiesPanel selectedNode={selectedNode} onUpdateLabel={handleUpdateLabel} />
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const [editingWorkflow, setEditingWorkflow] = useState<typeof mockWorkflows[0] | null>(null);

  if (editingWorkflow) {
    return <WorkflowEditor workflow={editingWorkflow} onBack={() => setEditingWorkflow(null)} />;
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitBranch className="size-6 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold">Workflows</h1>
              <p className="text-sm text-muted-foreground">
                Orchestrate multi-step AI pipelines with visual workflows
              </p>
            </div>
          </div>
          <Button size="sm" className="gap-2">
            <Plus className="size-3.5" />
            New Workflow
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mockWorkflows.map((wf) => {
            const st = statusConfig[wf.status];
            const StatusIcon = st.icon;
            return (
              <Card key={wf.id} className="hover:ring-2 hover:ring-primary/20 transition-all">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{wf.name}</CardTitle>
                    <StatusIcon className={`size-4 ${st.color}`} />
                  </div>
                  <CardDescription>{wf.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{wf.nodeCount} nodes</span>
                    <span>Last run: {wf.lastRun}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Badge variant="outline" className={`text-[10px] ${st.color}`}>
                      {st.label}
                    </Badge>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2.5 text-[11px] gap-1"
                        onClick={() => setEditingWorkflow(wf)}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" size="icon" className="size-6">
                        <Play className="size-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
