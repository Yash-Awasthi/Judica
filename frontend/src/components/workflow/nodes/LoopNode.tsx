import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Repeat, RefreshCw } from "lucide-react";

function LoopNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`relative group transition-all duration-500 ${selected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
      {/* Outer Glow */}
      <div className={`absolute -inset-1 rounded-[1.5rem] blur-xl opacity-20 transition-opacity duration-500 ${selected ? 'bg-indigo-500' : 'bg-transparent group-hover:bg-indigo-900/40'}`} />
      
      <div className={`relative flex flex-col min-w-[220px] bg-[rgba(15,15,15,0.85)] backdrop-blur-2xl border-2 rounded-[1.5rem] overflow-hidden transition-all duration-300 ${selected ? 'border-indigo-500/80 shadow-[0_0_25px_rgba(99,102,241,0.3)]' : 'border-[var(--glass-border)]'}`}>
        {/* Diagnostic Bar */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />
        
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-b from-indigo-500/10 to-transparent flex items-center justify-between gap-4 border-b border-indigo-500/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Repeat size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-200">Neural Loop</span>
              <span className="text-[9px] font-mono text-indigo-500/60 uppercase tracking-widest leading-none">RECURSIVE_CORE</span>
            </div>
          </div>
          <RefreshCw size={14} className="animate-spin-slow text-indigo-500/30" />
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-500/40 mb-1">Iteration Threshold</span>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-black text-gray-100 italic tracking-tighter">
                {(data.max_iterations as number) || 100}
              </span>
              <span className="text-[9px] font-mono text-indigo-500/60 uppercase tracking-widest leading-none mt-2">CYCLES</span>
            </div>
          </div>
        </div>

        {/* Handles */}
        <Handle 
          type="target" 
          position={Position.Left} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-indigo-500/50 !border-2 !shadow-[0_0_10px_rgba(99,102,241,0.4)] hover:!scale-125 transition-transform" 
        />
        <Handle 
          type="source" 
          position={Position.Right} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-indigo-500/50 !border-2 !shadow-[0_0_10px_rgba(99,102,241,0.4)] hover:!scale-125 transition-transform" 
        />
      </div>
    </div>
  );
}

export const LoopNode = memo(LoopNodeComponent);
