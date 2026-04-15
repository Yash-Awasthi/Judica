import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Brain, Cpu } from "lucide-react";

function LLMNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`relative group transition-all duration-500 ${selected ? 'scale-[1.02]' : 'hover:scale-[1.01]'}`}>
      {/* Outer Glow */}
      <div className={`absolute -inset-1 rounded-[1.5rem] blur-xl opacity-20 transition-opacity duration-500 ${selected ? 'bg-purple-500' : 'bg-transparent group-hover:bg-purple-900/40'}`} />
      
      <div className={`relative flex flex-col min-w-[240px] bg-[rgba(15,15,15,0.85)] backdrop-blur-2xl border-2 rounded-[1.5rem] overflow-hidden transition-all duration-300 ${selected ? 'border-purple-500/80 shadow-[0_0_25px_rgba(168,85,247,0.3)]' : 'border-[var(--glass-border)]'}`}>
        {/* Diagnostic Bar */}
        <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
        
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-b from-purple-500/10 to-transparent flex items-center justify-between gap-4 border-b border-purple-500/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Brain size={18} strokeWidth={2.5} />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-black uppercase tracking-[0.2em] text-purple-200">Neural Core</span>
              <span className="text-[9px] font-mono text-purple-500/60 uppercase tracking-widest leading-none">LLM_PROCESSOR</span>
            </div>
          </div>
          <Cpu size={14} className="text-purple-500/30" />
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4">
          <div className="space-y-3">
            <div className="flex flex-col">
              <span className="text-[9px] font-black uppercase tracking-widest text-purple-500/40 mb-1">Inference Engine</span>
              <span className="text-[10px] font-mono font-bold text-gray-100 bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                {(data.model as string) || 'AUTO_OPTIMIZED'}
              </span>
            </div>
            
            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <span className="text-[9px] font-black uppercase tracking-widest text-purple-500/40">Thermal Vector</span>
              <span className="text-[10px] font-mono font-bold text-purple-400">
                {(data.temperature as number) ?? 0.7}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Metrics */}
        <div className="px-5 py-3 bg-black/40 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-purple-500/50">Active Sync</span>
          </div>
          <span className="text-[8px] font-mono text-white/20">v3.0.Neural</span>
        </div>

        {/* Handles */}
        <Handle 
          type="target" 
          position={Position.Left} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-purple-500/50 !border-2 !shadow-[0_0_10px_rgba(168,85,247,0.4)] hover:!scale-125 transition-transform" 
        />
        <Handle 
          type="source" 
          position={Position.Right} 
          className="!w-4 !h-4 !bg-[#0a0a0a] !border-purple-500/50 !border-2 !shadow-[0_0_10px_rgba(168,85,247,0.4)] hover:!scale-125 transition-transform" 
        />
      </div>
    </div>
  );
}

export const LLMNode = memo(LLMNodeComponent);
