import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Brain } from "lucide-react";

function LLMNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-purple-300'} min-w-[200px]`}>
      <div className="bg-purple-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <Brain size={16} className="text-purple-600" />
        <span className="text-sm font-semibold text-purple-700">LLM</span>
      </div>
      <div className="p-3 text-xs text-gray-600">
        <div>Model: {(data.model as string) || 'auto'}</div>
        <div>Temp: {(data.temperature as number) ?? 0.7}</div>
      </div>
      <Handle type="target" position={Position.Left} className="!bg-purple-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-purple-400 !w-3 !h-3" />
    </div>
  );
}
export const LLMNode = memo(LLMNodeComponent);
