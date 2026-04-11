import { useCallback } from "react";
import Editor from "@monaco-editor/react";
import type { Node } from "@xyflow/react";

interface NodeConfigPanelProps {
  node: Node | null;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
}

const inputClass = "w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400";

export function NodeConfigPanel({ node, onUpdateNode }: NodeConfigPanelProps) {
  const update = useCallback(
    (key: string, value: unknown) => {
      if (!node) return;
      onUpdateNode(node.id, { ...node.data, [key]: value });
    },
    [node, onUpdateNode]
  );

  if (!node) {
    return (
      <div className="w-72 border-l border-gray-200 bg-gray-50 p-4 text-sm text-gray-400">
        Select a node to configure
      </div>
    );
  }

  return (
    <div className="w-72 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto">
      <h3 className="font-semibold text-sm mb-3 text-gray-700 uppercase tracking-wide">
        {node.type} Config
      </h3>
      <div className="space-y-3">
        {renderFields(node, update)}
      </div>
    </div>
  );
}

function renderFields(
  node: Node,
  update: (key: string, value: unknown) => void
) {
  const d = node.data;
  switch (node.type) {
    case "input":
    case "output":
      return (
        <>
          <Field label="Name">
            <input className={inputClass} value={(d.name as string) || ""} onChange={(e) => update("name", e.target.value)} />
          </Field>
          <Field label="Type">
            <select className={inputClass} value={(d.type as string) || "string"} onChange={(e) => update("type", e.target.value)}>
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="object">object</option>
            </select>
          </Field>
        </>
      );

    case "llm":
      return (
        <>
          <Field label="Model">
            <select className={inputClass} value={(d.model as string) || "auto"} onChange={(e) => update("model", e.target.value)}>
              <option value="auto">auto</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
              <option value="claude-haiku-4-20250414">claude-haiku-4</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            </select>
          </Field>
          <Field label={`Temperature: ${(d.temperature as number) ?? 0.7}`}>
            <input type="range" min="0" max="2" step="0.1" className="w-full" value={(d.temperature as number) ?? 0.7} onChange={(e) => update("temperature", parseFloat(e.target.value))} />
          </Field>
          <Field label="System Prompt">
            <textarea className={`${inputClass} h-20`} value={(d.system_prompt as string) || ""} onChange={(e) => update("system_prompt", e.target.value)} placeholder="System prompt..." />
          </Field>
          <Field label="User Prompt">
            <textarea className={`${inputClass} h-20`} value={(d.user_prompt as string) || ""} onChange={(e) => update("user_prompt", e.target.value)} placeholder="Use {{variable}} for inputs" />
          </Field>
        </>
      );

    case "tool":
      return (
        <Field label="Tool Name">
          <input className={inputClass} value={(d.tool_name as string) || ""} onChange={(e) => update("tool_name", e.target.value)} placeholder="search, read_webpage..." />
        </Field>
      );

    case "condition":
      return (
        <>
          <Field label="Value Key">
            <input className={inputClass} value={(d.value as string) || ""} onChange={(e) => update("value", e.target.value)} />
          </Field>
          <Field label="Operator">
            <select className={inputClass} value={(d.operator as string) || "equals"} onChange={(e) => update("operator", e.target.value)}>
              <option value="equals">equals</option>
              <option value="not_equals">not equals</option>
              <option value="contains">contains</option>
              <option value="gt">greater than</option>
              <option value="lt">less than</option>
              <option value="is_empty">is empty</option>
            </select>
          </Field>
          <Field label="Compare To">
            <input className={inputClass} value={(d.compare_to as string) || ""} onChange={(e) => update("compare_to", e.target.value)} />
          </Field>
        </>
      );

    case "template":
      return (
        <Field label="Template">
          <textarea className={`${inputClass} h-32`} value={(d.template as string) || ""} onChange={(e) => update("template", e.target.value)} placeholder="Hello {{name}}, ..." />
        </Field>
      );

    case "code":
      return (
        <>
          <Field label="Language">
            <select className={inputClass} value={(d.language as string) || "javascript"} onChange={(e) => update("language", e.target.value)}>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
            </select>
          </Field>
          <div className="border rounded overflow-hidden">
            <Editor
              height="200px"
              language={(d.language as string) || "javascript"}
              value={(d.code as string) || ""}
              onChange={(val) => update("code", val || "")}
              theme="vs-dark"
              options={{ minimap: { enabled: false }, fontSize: 12, lineNumbers: "off", scrollBeyondLastLine: false }}
            />
          </div>
        </>
      );

    case "http":
      return (
        <>
          <Field label="Method">
            <select className={inputClass} value={(d.method as string) || "GET"} onChange={(e) => update("method", e.target.value)}>
              {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="URL">
            <input className={inputClass} value={(d.url as string) || ""} onChange={(e) => update("url", e.target.value)} placeholder="https://..." />
          </Field>
          <Field label="Headers (JSON)">
            <textarea className={`${inputClass} h-16 font-mono text-xs`} value={typeof d.headers === 'object' ? JSON.stringify(d.headers, null, 2) : (d.headers as string) || "{}"} onChange={(e) => { try { const parsed = JSON.parse(e.target.value); update("headers", parsed); } catch { /* allow intermediate invalid JSON while typing */ } }} />
          </Field>
          <Field label="Body">
            <textarea className={`${inputClass} h-16`} value={(d.body as string) || ""} onChange={(e) => update("body", e.target.value)} />
          </Field>
        </>
      );

    case "human_gate":
      return (
        <>
          <Field label="Prompt">
            <input className={inputClass} value={(d.prompt as string) || ""} onChange={(e) => update("prompt", e.target.value)} />
          </Field>
          <Field label="Options (comma-separated)">
            <input className={inputClass} value={Array.isArray(d.options) ? (d.options as string[]).join(", ") : ""} onChange={(e) => update("options", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))} />
          </Field>
        </>
      );

    case "loop":
      return (
        <Field label="Max Iterations">
          <input type="number" className={inputClass} min={1} max={1000} value={(d.max_iterations as number) || 100} onChange={(e) => update("max_iterations", parseInt(e.target.value) || 100)} />
        </Field>
      );

    default:
      return <div className="text-xs text-gray-400">No configuration available</div>;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
