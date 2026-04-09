import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Globe } from "lucide-react";

function HTTPNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-blue-300'} min-w-[200px]`}>
      <div className="bg-blue-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <Globe size={16} className="text-blue-600" />
        <span className="text-sm font-semibold text-blue-700">HTTP</span>
      </div>
      <div className="p-3 text-xs text-gray-600 truncate max-w-[180px]">
        {(data.method as string) || 'GET'} {(data.url as string) || '...'}
      </div>
      <Handle type="target" position={Position.Left} className="!bg-blue-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-blue-400 !w-3 !h-3" />
    </div>
  );
}
export const HTTPNode = memo(HTTPNodeComponent);
