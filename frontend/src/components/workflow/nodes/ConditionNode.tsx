import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

function ConditionNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-yellow-300'} min-w-[200px]`}>
      <div className="bg-yellow-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <GitBranch size={16} className="text-yellow-600" />
        <span className="text-sm font-semibold text-yellow-700">Condition</span>
      </div>
      <div className="p-3 text-xs text-gray-600">
        {(data.operator as string) || 'equals'}
      </div>
      <Handle type="target" position={Position.Left} className="!bg-yellow-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} id="true" style={{ top: '35%' }} className="!bg-green-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} id="false" style={{ top: '65%' }} className="!bg-red-400 !w-3 !h-3" />
    </div>
  );
}
export const ConditionNode = memo(ConditionNodeComponent);
