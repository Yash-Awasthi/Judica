import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Wrench } from "lucide-react";

function ToolNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-orange-300'} min-w-[200px]`}>
      <div className="bg-orange-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <Wrench size={16} className="text-orange-600" />
        <span className="text-sm font-semibold text-orange-700">Tool</span>
      </div>
      <div className="p-3 text-xs text-gray-600">
        {(data.tool_name as string) || 'Select tool...'}
      </div>
      <Handle type="target" position={Position.Left} className="!bg-orange-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-orange-400 !w-3 !h-3" />
    </div>
  );
}
export const ToolNode = memo(ToolNodeComponent);
