import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Merge, Combine } from "lucide-react";

function MergeNodeComponent({ selected }: NodeProps) {
  return (
    <div className={`relative group transition-all duration-500 ${selected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
      {/* Outer Glow */}
      <div className={`absolute -inset-1 rounded-[1.5rem] blur-xl opacity-20 transition-opacity duration-500 ${selected ? 'bg-slate-500' : 'bg-transparent group-hover:bg-slate-900/40'}`} />
      
      <div className={`relative flex flex-col min-w-[200px] bg-[rgba(15,15,15,0.85)] backdrop-blur-2xl border-2 rounded-[1.5rem] overflow-hidden transition-all duration-300 ${selected ? 'border-slate-500/80 shadow-[0_0_25px_rgba(148,163,184,0.3)]' : 'border-[var(--glass-border)]'}`}>
        {/* Diagnostic Bar */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-slate-500/50 to-transparent" />
        
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-b from-slate-500/10 to-transparent flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-slate-500/20 text-slate-400 border border-slate-500/30">
              <Merge size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-200">Integrator</span>
              <span className="text-[9px] font-mono text-slate-500/60 uppercase tracking-widest leading-none">STREAM_SYNC</span>
            </div>
          </div>
          <Combine size={14} className="text-slate-500/30" />
        </div>

        {/* Handles */}
        <Handle 
          type="target" 
          position={Position.Left} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-slate-500/50 !border-2 !shadow-[0_0_10px_rgba(148,163,184,0.4)] hover:!scale-125 transition-transform" 
        />
        <Handle 
          type="source" 
          position={Position.Right} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-slate-500/50 !border-2 !shadow-[0_0_10px_rgba(148,163,184,0.4)] hover:!scale-125 transition-transform" 
        />
      </div>
    </div>
  );
}

export const MergeNode = memo(MergeNodeComponent);
