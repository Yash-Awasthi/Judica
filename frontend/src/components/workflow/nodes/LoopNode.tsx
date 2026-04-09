import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Repeat } from "lucide-react";

function LoopNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-indigo-300'} min-w-[200px]`}>
      <div className="bg-indigo-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <Repeat size={16} className="text-indigo-600" />
        <span className="text-sm font-semibold text-indigo-700">Loop</span>
      </div>
      <div className="p-3 text-xs text-gray-600">
        Max: {(data.max_iterations as number) || 100}
      </div>
      <Handle type="target" position={Position.Left} className="!bg-indigo-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-400 !w-3 !h-3" />
    </div>
  );
}
export const LoopNode = memo(LoopNodeComponent);
