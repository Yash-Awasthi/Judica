import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Save, Play, Download, Upload, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { NodePalette } from "../components/workflow/NodePalette";
import { NodeConfigPanel } from "../components/workflow/NodeConfigPanel";
import { definitionFromFlow, flowFromDefinition } from "../components/workflow/serialization";

// Node components
import { InputNode } from "../components/workflow/nodes/InputNode";
import { OutputNode } from "../components/workflow/nodes/OutputNode";
import { LLMNode } from "../components/workflow/nodes/LLMNode";
import { ToolNode } from "../components/workflow/nodes/ToolNode";
import { ConditionNode } from "../components/workflow/nodes/ConditionNode";
import { TemplateNode } from "../components/workflow/nodes/TemplateNode";
import { CodeNode } from "../components/workflow/nodes/CodeNode";
import { HTTPNode } from "../components/workflow/nodes/HTTPNode";
import { HumanGateNode } from "../components/workflow/nodes/HumanGateNode";
import { LoopNode } from "../components/workflow/nodes/LoopNode";
import { MergeNode } from "../components/workflow/nodes/MergeNode";
import { SplitNode } from "../components/workflow/nodes/SplitNode";

const nodeTypes = {
  input: InputNode,
  output: OutputNode,
  llm: LLMNode,
  tool: ToolNode,
  condition: ConditionNode,
  template: TemplateNode,
  code: CodeNode,
  http: HTTPNode,
  human_gate: HumanGateNode,
  loop: LoopNode,
  merge: MergeNode,
  split: SplitNode,
};

let nodeIdCounter = 0;
function getNodeId() {
  return `node_${++nodeIdCounter}_${Date.now()}`;
}

function WorkflowEditorInner() {
  const { id: workflowId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { fetchWithAuth } = useAuth();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [workflowName, setWorkflowName] = useState("Untitled Workflow");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(workflowId || "");
  const [running, setRunning] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, "running" | "done" | "error">>({});
  const [runOutputs, setRunOutputs] = useState<Record<string, unknown> | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Load workflow if editing
  useEffect(() => {
    if (!workflowId) return;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/workflows/${workflowId}`);
        if (res.ok) {
          const wf = await res.json();
          setWorkflowName(wf.name);
          setSavedId(wf.id);
          if (wf.definition) {
            const { nodes: n, edges: e } = flowFromDefinition(wf.definition);
            setNodes(n);
            setEdges(e);
          }
        }
      } catch (err) {
        console.error("Failed to load workflow", err);
      }
    })();
  }, [workflowId, fetchWithAuth, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const onUpdateNode = useCallback(
    (id: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data } : n))
      );
      setSelectedNode((prev) => (prev?.id === id ? { ...prev, data } : prev));
    },
    [setNodes]
  );

  // Drag & drop from palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: getNodeId(),
        type,
        position,
        data: {},
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes]
  );

  // Save workflow
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const definition = definitionFromFlow(nodes, edges);
      const body = { name: workflowName, definition };

      let res;
      if (savedId) {
        res = await fetchWithAuth(`/api/workflows/${savedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetchWithAuth("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        const wf = await res.json();
        setSavedId(wf.id);
        if (!workflowId) {
          navigate(`/workflows/${wf.id}`, { replace: true });
        }
      }
    } catch (err) {
      console.error("Save failed", err);
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, workflowName, savedId, fetchWithAuth, navigate, workflowId]);

  // Run workflow
  const inputDefs = useMemo(
    () => nodes.filter((n) => n.type === "input").map((n) => ({
      name: (n.data.name as string) || n.id,
      type: (n.data.type as string) || "string",
    })),
    [nodes]
  );

  const executeRun = useCallback(async (inputs: Record<string, unknown>) => {
    if (!savedId) return;
    setRunning(true);
    setShowRunModal(false);
    setNodeStatuses({});
    setRunOutputs(null);

    try {
      const res = await fetchWithAuth(`/api/workflows/${savedId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs }),
      });

      if (!res.ok) {
        setRunning(false);
        return;
      }

      const { run_id } = await res.json();

      // Subscribe to SSE
      const token = localStorage.getItem("council_token") || "";
      const es = new EventSource(`/api/workflows/runs/${run_id}/stream?token=${token}`);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case "node_start":
              setNodeStatuses((prev) => ({ ...prev, [data.nodeId]: "running" }));
              break;
            case "node_complete":
              setNodeStatuses((prev) => ({ ...prev, [data.nodeId]: "done" }));
              break;
            case "node_error":
              setNodeStatuses((prev) => ({ ...prev, [data.nodeId]: "error" }));
              break;
            case "workflow_complete":
              setRunOutputs(data.outputs || {});
              setRunning(false);
              es.close();
              break;
            case "workflow_error":
              setRunning(false);
              es.close();
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        setRunning(false);
        es.close();
      };
    } catch (err) {
      console.error("Run failed", err);
      setRunning(false);
    }
  }, [savedId, fetchWithAuth]);

  const handleRunStart = useCallback(() => {
    if (!savedId) return;
    if (inputDefs.length > 0) {
      setShowRunModal(true);
      const defaults: Record<string, string> = {};
      inputDefs.forEach((i) => { defaults[i.name] = ""; });
      setRunInputs(defaults);
    } else {
      executeRun({});
    }
  }, [savedId, inputDefs, executeRun]);

  // Export/Import JSON
  const handleExport = useCallback(() => {
    const def = definitionFromFlow(nodes, edges);
    const blob = new Blob([JSON.stringify(def, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflowName.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges, workflowName]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const def = JSON.parse(text);
        const { nodes: n, edges: e2 } = flowFromDefinition(def);
        setNodes(n);
        setEdges(e2);
      } catch (err) {
        console.error("Import failed", err);
      }
    };
    input.click();
  }, [setNodes, setEdges]);

  // Apply status overlays to nodes
  const styledNodes = useMemo(() => {
    return nodes.map((n) => {
      const status = nodeStatuses[n.id];
      if (!status) return n;
      const className =
        status === "running" ? "ring-2 ring-blue-500 ring-offset-2 rounded-lg" :
        status === "done" ? "ring-2 ring-green-500 ring-offset-2 rounded-lg" :
        status === "error" ? "ring-2 ring-red-500 ring-offset-2 rounded-lg" : "";
      return { ...n, className };
    });
  }, [nodes, nodeStatuses]);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white">
        <input
          className="text-lg font-semibold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-400 focus:outline-none px-1 py-0.5 min-w-[200px]"
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
        />
        <div className="flex-1" />
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          <Save size={14} /> {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={handleRunStart} disabled={running || !savedId} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
          <Play size={14} /> {running ? "Running..." : "Run"}
        </button>
        <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border">
          <Download size={14} /> Export
        </button>
        <button onClick={handleImport} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border">
          <Upload size={14} /> Import
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        <NodePalette />
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={styledNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onInit={setReactFlowInstance}
            onDragOver={onDragOver}
            onDrop={onDrop}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
        <NodeConfigPanel node={selectedNode} onUpdateNode={onUpdateNode} />
      </div>

      {/* Output panel */}
      {runOutputs && (
        <div className="border-t border-gray-200 bg-gray-50 p-4 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Workflow Output</h4>
            <button onClick={() => setRunOutputs(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>
          <pre className="text-xs bg-white p-3 rounded border overflow-x-auto">{JSON.stringify(runOutputs, null, 2)}</pre>
        </div>
      )}

      {/* Run Inputs Modal */}
      {showRunModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
            <h3 className="font-semibold text-lg mb-4">Workflow Inputs</h3>
            <div className="space-y-3">
              {inputDefs.map((inp) => (
                <label key={inp.name} className="block">
                  <span className="text-sm font-medium text-gray-700">{inp.name} ({inp.type})</span>
                  <input
                    className="mt-1 w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                    value={runInputs[inp.name] || ""}
                    onChange={(e) => setRunInputs((p) => ({ ...p, [inp.name]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowRunModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
              <button onClick={() => executeRun(runInputs)} className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Run</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkflowEditorView() {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  );
}
