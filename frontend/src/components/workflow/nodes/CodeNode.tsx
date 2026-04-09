import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Code } from "lucide-react";

function CodeNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-gray-300'} min-w-[200px]`}>
      <div className="bg-gray-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <Code size={16} className="text-gray-600" />
        <span className="text-sm font-semibold text-gray-700">Code</span>
      </div>
      <div className="p-3 text-xs text-gray-600">
        {(data.language as string) || 'javascript'}
      </div>
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3 !h-3" />
    </div>
  );
}
export const CodeNode = memo(CodeNodeComponent);
