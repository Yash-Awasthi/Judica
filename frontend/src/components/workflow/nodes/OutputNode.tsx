import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowLeftCircle, LogOut } from "lucide-react";

function OutputNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`relative group transition-all duration-500 ${selected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
      {/* Outer Glow */}
      <div className={`absolute -inset-1 rounded-[1.5rem] blur-xl opacity-20 transition-opacity duration-500 ${selected ? 'bg-red-500' : 'bg-transparent group-hover:bg-red-900/40'}`} />
      
      <div className={`relative flex flex-col min-w-[220px] bg-[rgba(15,15,15,0.85)] backdrop-blur-2xl border-2 rounded-[1.5rem] overflow-hidden transition-all duration-300 ${selected ? 'border-red-500/80 shadow-[0_0_25px_rgba(239,68,68,0.3)]' : 'border-[var(--glass-border)]'}`}>
        {/* Diagnostic Bar */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />
        
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-b from-red-500/10 to-transparent flex items-center justify-between gap-4 border-b border-red-500/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30">
              <LogOut size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-red-200">Egress Port</span>
              <span className="text-[9px] font-mono text-red-500/60 uppercase tracking-widest leading-none">SYSTEM_OUTPUT</span>
            </div>
          </div>
          <ArrowLeftCircle size={14} className="text-red-500/30" />
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-widest text-red-500/40 mb-1">Vector ID</span>
            <span className="text-[10px] font-mono font-bold text-gray-100 italic truncate">
              {(data.name as string) || 'UNDEFINED_OUTPUT'}
            </span>
          </div>
        </div>

        {/* Handles */}
        <Handle 
          type="target" 
          position={Position.Left} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-red-500/50 !border-2 !shadow-[0_0_10px_rgba(239,68,68,0.4)] hover:!scale-125 transition-transform" 
        />
      </div>
    </div>
  );
}

export const OutputNode = memo(OutputNodeComponent);
