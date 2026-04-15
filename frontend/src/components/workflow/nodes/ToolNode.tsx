import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench, Terminal } from "lucide-react";

function ToolNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`relative group transition-all duration-500 ${selected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
      {/* Outer Glow */}
      <div className={`absolute -inset-1 rounded-[1.5rem] blur-xl opacity-20 transition-opacity duration-500 ${selected ? 'bg-orange-500' : 'bg-transparent group-hover:bg-orange-900/40'}`} />
      
      <div className={`relative flex flex-col min-w-[220px] bg-[rgba(15,15,15,0.85)] backdrop-blur-2xl border-2 rounded-[1.5rem] overflow-hidden transition-all duration-300 ${selected ? 'border-orange-500/80 shadow-[0_0_25px_rgba(249,115,22,0.3)]' : 'border-[var(--glass-border)]'}`}>
        {/* Diagnostic Bar */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-orange-500/50 to-transparent" />
        
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-b from-orange-500/10 to-transparent flex items-center justify-between gap-4 border-b border-orange-500/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-orange-500/20 text-orange-400 border border-orange-500/30">
              <Wrench size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-orange-200">Subroutine</span>
              <span className="text-[9px] font-mono text-orange-500/60 uppercase tracking-widest leading-none">SUB_PROCESS</span>
            </div>
          </div>
          <Terminal size={14} className="text-orange-500/30" />
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-widest text-orange-500/40 mb-1">Module ID</span>
            <span className="text-[10px] font-mono font-bold text-gray-100 italic truncate">
              {(data.tool_name as string) || 'SELECT_MODULE_01'}
            </span>
          </div>
        </div>

        {/* Handles */}
        <Handle 
          type="target" 
          position={Position.Left} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-orange-500/50 !border-2 !shadow-[0_0_10px_rgba(249,115,22,0.4)] hover:!scale-125 transition-transform" 
        />
        <Handle 
          type="source" 
          position={Position.Right} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-orange-500/50 !border-2 !shadow-[0_0_10px_rgba(249,115,22,0.4)] hover:!scale-125 transition-transform" 
        />
      </div>
    </div>
  );
}

export const ToolNode = memo(ToolNodeComponent);
