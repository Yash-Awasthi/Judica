import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowRightCircle } from "lucide-react";

function InputNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-green-300'} min-w-[180px]`}>
      <div className="bg-green-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <ArrowRightCircle size={16} className="text-green-600" />
        <span className="text-sm font-semibold text-green-700">Input</span>
      </div>
      <div className="p-3 text-xs text-gray-600">
        {(data.name as string) || 'input'}: {(data.type as string) || 'string'}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-green-400 !w-3 !h-3" />
    </div>
  );
}
export const InputNode = memo(InputNodeComponent);
