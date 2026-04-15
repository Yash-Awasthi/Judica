import { useCallback } from "react";
import Editor from "@monaco-editor/react";
import type { Node } from "@xyflow/react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Cpu, Activity, Info, AlertCircle } from "lucide-react";

interface NodeConfigPanelProps {
  node: Node | null;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
}

const inputClass = "w-full px-4 py-2.5 text-xs font-mono bg-[var(--bg-surface-3)] border border-[var(--glass-border)] rounded-xl focus:outline-none focus:border-[var(--accent-mint)]/50 focus:shadow-[0_0_15px_rgba(110,231,183,0.1)] transition-all text-[var(--text-primary)] placeholder:opacity-30";
const labelClass = "block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em] mb-2 opacity-60";

export function NodeConfigPanel({ node, onUpdateNode }: NodeConfigPanelProps) {
  const update = useCallback(
    (key: string, value: unknown) => {
      if (!node) return;
      onUpdateNode(node.id, { ...node.data, [key]: value });
    },
    [node, onUpdateNode]
  );

  return (
    <div className="w-80 border-l border-[var(--glass-border)] bg-[rgba(15,15,15,0.7)] backdrop-blur-xl flex flex-col overflow-hidden z-30">
      <AnimatePresence mode="wait">
        {!node ? (
          <motion.div 
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center p-8 text-center"
          >
            <div className="w-16 h-16 rounded-3xl bg-[rgba(255,255,255,0.02)] border border-[var(--glass-border)] flex items-center justify-center mb-4">
              <Settings size={24} className="text-[var(--text-muted)] opacity-20" />
            </div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] italic">Awaiting Telemetry</h4>
            <p className="text-[10px] text-[var(--text-muted)] opacity-40 mt-2 leading-relaxed">Select a neural node to initiate diagnostic bridge</p>
          </motion.div>
        ) : (
          <motion.div
            key="configured"
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0 }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Diagnostic Header */}
            <div className="p-6 border-b border-[var(--glass-border)] relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Cpu size={40} />
              </div>
              <div className="flex items-center gap-2 mb-3">
                <div className="px-2 py-0.5 rounded-pill bg-[var(--accent-mint)]/10 border border-[var(--accent-mint)]/20 text-[var(--accent-mint)] text-[9px] font-bold uppercase tracking-widest">
                  Live Vector
                </div>
                <Activity size={12} className="text-[var(--accent-mint)] animate-pulse" />
              </div>
              <h3 className="text-lg font-black text-[var(--text-primary)] tracking-tight uppercase">
                {node.type?.replace("_", " ")} <span className="text-[var(--text-muted)] opacity-30 text-sm font-light">Config</span>
              </h3>
              <p className="text-[9px] font-mono text-[var(--text-muted)] opacity-40 mt-1 truncate">{node.id}</p>
            </div>

            {/* Scrollable Config Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-custom">
              {renderFields(node, update)}
              
              {/* Telemetry Footer */}
              <div className="pt-8 border-t border-[var(--glass-border)]">
                <div className="flex items-start gap-3 p-4 rounded-2xl bg-[rgba(255,255,255,0.02)] border border-[var(--glass-border)]">
                  <Info size={14} className="text-[var(--accent-blue)] shrink-0 mt-0.5" />
                  <p className="text-[10px] leading-relaxed text-[var(--text-muted)] opacity-60 italic">
                    All parameters are hot-swapped into the execution engine. Changes persist automatically to the cluster.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
        <div className="space-y-6">
          <Field label="Vector Identifier">
            <input className={inputClass} value={(d.name as string) || ""} onChange={(e) => update("name", e.target.value)} placeholder="e.g. system_input_01" />
          </Field>
          <Field label="Data Specification">
            <select className={inputClass} value={(d.type as string) || "string"} onChange={(e) => update("type", e.target.value)}>
              <option value="string">STRING</option>
              <option value="number">NUMBER</option>
              <option value="boolean">BOOLEAN</option>
              <option value="object">OBJECT</option>
            </select>
          </Field>
        </div>
      );

    case "llm":
      return (
        <div className="space-y-6">
          <Field label="Inference Engine">
            <select className={inputClass} value={(d.model as string) || "auto"} onChange={(e) => update("model", e.target.value)}>
              <option value="auto">AUTO_ORCHESTRATE</option>
              <option value="gpt-4o">GPT_4O_OMNI</option>
              <option value="gpt-4o-mini">GPT_4O_MINI</option>
              <option value="claude-sonnet-4-20250514">CLAUDE_4_SONNET</option>
              <option value="claude-haiku-4-20250414">CLAUDE_4_HAIKU</option>
              <option value="gemini-2.0-flash">GEMINI_2_FLASH</option>
            </select>
          </Field>
          <Field label={`Thermal Quotient: ${(d.temperature as number) ?? 0.7}`}>
            <input type="range" min="0" max="2" step="0.1" className="w-full accent-[var(--accent-mint)]" value={(d.temperature as number) ?? 0.7} onChange={(e) => update("temperature", parseFloat(e.target.value))} />
          </Field>
          <Field label="System Directives">
            <textarea className={`${inputClass} h-24 scrollbar-custom resize-none`} value={(d.system_prompt as string) || ""} onChange={(e) => update("system_prompt", e.target.value)} placeholder="Define behavioral constraints..." />
          </Field>
          <Field label="Inquiry Template">
            <textarea className={`${inputClass} h-32 scrollbar-custom resize-none`} value={(d.user_prompt as string) || ""} onChange={(e) => update("user_prompt", e.target.value)} placeholder="Inject variables via {{key}} syntax" />
          </Field>
        </div>
      );

    case "tool":
      return (
        <Field label="Subroutine Identifier">
          <input className={inputClass} value={(d.tool_name as string) || ""} onChange={(e) => update("tool_name", e.target.value)} placeholder="e.g. neuro_search, file_spec..." />
        </Field>
      );

    case "condition":
      return (
        <div className="space-y-6">
          <Field label="Observation Key">
            <input className={inputClass} value={(d.value as string) || ""} onChange={(e) => update("value", e.target.value)} placeholder="e.g. data.status" />
          </Field>
          <Field label="Comparator">
            <select className={inputClass} value={(d.operator as string) || "equals"} onChange={(e) => update("operator", e.target.value)}>
              <option value="equals">IS_EQUAL</option>
              <option value="not_equals">NOT_EQUAL</option>
              <option value="contains">CONTAINS</option>
              <option value="gt">GREATER_THAN</option>
              <option value="lt">LESS_THAN</option>
              <option value="is_empty">NULL_VECTOR</option>
            </select>
          </Field>
          <Field label="Reference Vector">
            <input className={inputClass} value={(d.compare_to as string) || ""} onChange={(e) => update("compare_to", e.target.value)} placeholder="Target value..." />
          </Field>
        </div>
      );

    case "template":
      return (
        <Field label="Morphology Protocol">
          <textarea className={`${inputClass} h-48 scrollbar-custom resize-none`} value={(d.template as string) || ""} onChange={(e) => update("template", e.target.value)} placeholder="Hello {{name}}, initiate sequence..." />
        </Field>
      );

    case "code":
      return (
        <div className="space-y-6">
          <Field label="Syntax Environment">
            <select className={inputClass} value={(d.language as string) || "javascript"} onChange={(e) => update("language", e.target.value)}>
              <option value="javascript">V8_JAVASCRIPT</option>
              <option value="python">PY_NEURAL_LINK</option>
            </select>
          </Field>
          <div className="rounded-2xl border border-[var(--glass-border)] overflow-hidden shadow-2xl">
            <Editor
              height="300px"
              language={(d.language as string) || "javascript"}
              value={(d.code as string) || ""}
              onChange={(val) => update("code", val || "")}
              theme="vs-dark"
              options={{ 
                minimap: { enabled: false }, 
                fontSize: 11, 
                lineNumbers: "off", 
                scrollBeyondLastLine: false,
                padding: { top: 16, bottom: 16 },
                fontFamily: "'Geist Mono', monospace"
              }}
            />
          </div>
        </div>
      );

    case "http":
      return (
        <div className="space-y-6">
          <Field label="Request Methodology">
            <select className={inputClass} value={(d.method as string) || "GET"} onChange={(e) => update("method", e.target.value)}>
              {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Endpoint URI">
            <input className={inputClass} value={(d.url as string) || ""} onChange={(e) => update("url", e.target.value)} placeholder="https://api.external.service/v1" />
          </Field>
          <Field label="Header Manifest (JSON)">
            <textarea className={`${inputClass} h-24 font-mono scrollbar-custom resize-none`} value={typeof d.headers === 'object' ? JSON.stringify(d.headers, null, 2) : (d.headers as string) || "{}"} onChange={(e) => { try { const parsed = JSON.parse(e.target.value); update("headers", parsed); } catch { /* allow intermediate invalid JSON while typing */ } }} />
          </Field>
          <Field label="Payload Vector">
            <textarea className={`${inputClass} h-24 scrollbar-custom resize-none`} value={(d.body as string) || ""} onChange={(e) => update("body", e.target.value)} placeholder="Request body data..." />
          </Field>
        </div>
      );

    default:
      return (
        <div className="flex flex-col items-center justify-center p-8 border border-dashed border-[var(--glass-border)] rounded-3xl opacity-30 mt-4">
          <AlertCircle size={20} className="mb-2" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-center">Protocol Not Configurable</span>
        </div>
      );
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group">
      <span className={labelClass}>{label}</span>
      <div className="relative">{children}</div>
    </div>
  );
}
