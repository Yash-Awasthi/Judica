import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { ArrowRightCircle, LogIn } from "lucide-react";

interface InputNodeData extends Record<string, unknown> {
  name?: string;
  type?: string;
}

function InputNodeComponent({ data, selected }: NodeProps<Node<InputNodeData>>) {
  return (
    <div className={`relative group transition-all duration-500 ${selected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
      {/* Outer Glow */}
      <div className={`absolute -inset-1 rounded-[1.5rem] blur-xl opacity-20 transition-opacity duration-500 ${selected ? 'bg-[var(--accent-mint)]' : 'bg-transparent group-hover:bg-[var(--accent-mint)]/20'}`} />
      
      <div className={`relative flex flex-col min-w-[220px] bg-[rgba(15,15,15,0.85)] backdrop-blur-2xl border-2 rounded-[1.5rem] overflow-hidden transition-all duration-300 ${selected ? 'border-[var(--accent-mint)]/80 shadow-[0_0_25px_rgba(110,231,183,0.3)]' : 'border-[var(--glass-border)]'}`}>
        {/* Diagnostic Bar */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--accent-mint)]/50 to-transparent" />
        
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-b from-[var(--accent-mint)]/10 to-transparent flex items-center justify-between gap-4 border-b border-[var(--accent-mint)]/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[var(--accent-mint)]/20 text-[var(--accent-mint)] border border-[var(--accent-mint)]/30">
              <LogIn size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--accent-mint)]">Ingestion Port</span>
              <span className="text-[9px] font-mono text-[var(--accent-mint)]/60 uppercase tracking-widest leading-none">SYSTEM_INPUT</span>
            </div>
          </div>
          <ArrowRightCircle size={14} className="text-[var(--accent-mint)]/30" />
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase tracking-widest text-[var(--accent-mint)]/40 mb-1">Vector ID</span>
            <span className="text-[10px] font-mono font-bold text-gray-100 italic truncate">
              {(data.name as string) || 'UNDEFINED_INPUT'}
            </span>
          </div>
          
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-[9px] font-black uppercase tracking-widest text-[var(--accent-mint)]/40">Data Spec</span>
            <span className="text-[9px] font-mono font-bold text-[var(--accent-blue)] uppercase">
              {(data.type as string) || 'STRING'}
            </span>
          </div>
        </div>

        {/* Handles */}
        <Handle 
          type="source" 
          position={Position.Right} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-[var(--accent-mint)]/50 !border-2 !shadow-[0_0_10px_rgba(110,231,183,0.4)] hover:!scale-125 transition-transform" 
        />
      </div>
    </div>
  );
}

export const InputNode = memo(InputNodeComponent);
