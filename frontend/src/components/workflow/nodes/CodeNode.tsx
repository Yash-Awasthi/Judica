import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Code, Binary } from "lucide-react";

function CodeNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`relative group transition-all duration-500 ${selected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
      {/* Outer Glow */}
      <div className={`absolute -inset-1 rounded-[1.5rem] blur-xl opacity-20 transition-opacity duration-500 ${selected ? 'bg-slate-400' : 'bg-transparent group-hover:bg-slate-900/40'}`} />
      
      <div className={`relative flex flex-col min-w-[220px] bg-[rgba(15,15,15,0.85)] backdrop-blur-2xl border-2 rounded-[1.5rem] overflow-hidden transition-all duration-300 ${selected ? 'border-slate-400/80 shadow-[0_0_25px_rgba(148,163,184,0.3)]' : 'border-[var(--glass-border)]'}`}>
        {/* Diagnostic Bar */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-slate-400/50 to-transparent" />
        
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-b from-slate-400/10 to-transparent flex items-center justify-between gap-4 border-b border-slate-400/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-slate-400/20 text-slate-300 border border-slate-400/30">
              <Code size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-200">Logic Core</span>
              <span className="text-[9px] font-mono text-slate-400/60 uppercase tracking-widest leading-none">KERNEL_EXEC</span>
            </div>
          </div>
          <Binary size={14} className="text-slate-500/30" />
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400/40 mb-1">Environment</span>
            <span className="text-[10px] font-mono font-bold text-gray-100 bg-white/5 px-2 py-1 rounded-lg border border-white/5 capitalize">
              {(data.language as string) || 'JAVASCRIPT'}
            </span>
          </div>
          
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400/40">Instructions</span>
            <span className="text-[9px] font-mono font-bold text-gray-100 italic">
              {((data.code as string)?.length || 0)} BYTES
            </span>
          </div>
        </div>

        {/* Handles */}
        <Handle 
          type="target" 
          position={Position.Left} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-slate-400/50 !border-2 !shadow-[0_0_10px_rgba(148,163,184,0.4)] hover:!scale-125 transition-transform" 
        />
        <Handle 
          type="source" 
          position={Position.Right} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-slate-400/50 !border-2 !shadow-[0_0_10px_rgba(148,163,184,0.4)] hover:!scale-125 transition-transform" 
        />
      </div>
    </div>
  );
}

export const CodeNode = memo(CodeNodeComponent);
