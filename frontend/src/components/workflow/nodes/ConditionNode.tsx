import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch, Fingerprint } from "lucide-react";

function ConditionNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`relative group transition-all duration-500 ${selected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
      {/* Outer Glow */}
      <div className={`absolute -inset-1 rounded-[1.5rem] blur-xl opacity-20 transition-opacity duration-500 ${selected ? 'bg-amber-500' : 'bg-transparent group-hover:bg-amber-900/40'}`} />
      
      <div className={`relative flex flex-col min-w-[220px] bg-[rgba(15,15,15,0.85)] backdrop-blur-2xl border-2 rounded-[1.5rem] overflow-hidden transition-all duration-300 ${selected ? 'border-amber-500/80 shadow-[0_0_25px_rgba(245,158,11,0.3)]' : 'border-[var(--glass-border)]'}`}>
        {/* Diagnostic Bar */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
        
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-b from-amber-500/10 to-transparent flex items-center justify-between gap-4 border-b border-amber-500/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <GitBranch size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-200">Decision Matrix</span>
              <span className="text-[9px] font-mono text-amber-500/60 uppercase tracking-widest leading-none">BINARY_GATE</span>
            </div>
          </div>
          <Fingerprint size={14} className="text-amber-500/30" />
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/40 mb-1">Logic Operator</span>
            <span className="text-[10px] font-mono font-bold text-gray-100 italic truncate">
              {(data.operator as string)?.toUpperCase() || 'EQUALS'}
            </span>
          </div>
        </div>

        {/* Handles */}
        <Handle 
          type="target" 
          position={Position.Left} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-amber-500/50 !border-2 !shadow-[0_0_10px_rgba(245,158,11,0.4)] hover:!scale-125 transition-transform" 
        />
        
        {/* True Output */}
        <div className="absolute right-[-8px] top-[35%] flex items-center gap-2">
          <span className="text-[8px] font-black text-emerald-500 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">True</span>
          <Handle 
            type="source" 
            position={Position.Right} 
            id="true"
            className="!w-4 !h-4 !static !bg-[#0a0a0a] !border-emerald-500/50 !border-2 !shadow-[0_0_10px_rgba(16,185,129,0.4)] hover:!scale-125 transition-transform" 
          />
        </div>

        {/* False Output */}
        <div className="absolute right-[-8px] top-[65%] flex items-center gap-2">
          <span className="text-[8px] font-black text-rose-500 uppercase tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">False</span>
          <Handle 
            type="source" 
            position={Position.Right} 
            id="false"
            className="!w-4 !h-4 !static !bg-[#0a0a0a] !border-rose-500/50 !border-2 !shadow-[0_0_10px_rgba(244,63,94,0.4)] hover:!scale-125 transition-transform" 
          />
        </div>
      </div>
    </div>
  );
}

export const ConditionNode = memo(ConditionNodeComponent);
