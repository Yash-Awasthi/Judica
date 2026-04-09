import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowLeftCircle } from "lucide-react";

function OutputNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-red-300'} min-w-[180px]`}>
      <div className="bg-red-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <ArrowLeftCircle size={16} className="text-red-600" />
        <span className="text-sm font-semibold text-red-700">Output</span>
      </div>
      <div className="p-3 text-xs text-gray-600">
        {(data.name as string) || 'output'}: {(data.type as string) || 'string'}
      </div>
      <Handle type="target" position={Position.Left} className="!bg-red-400 !w-3 !h-3" />
    </div>
  );
}
export const OutputNode = memo(OutputNodeComponent);
