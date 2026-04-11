import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { UserCheck } from "lucide-react";

function HumanGateNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-pink-300'} min-w-[200px]`}>
      <div className="bg-pink-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <UserCheck size={16} className="text-pink-600" />
        <span className="text-sm font-semibold text-pink-700">Human Gate</span>
      </div>
      <div className="p-3 text-xs text-gray-600">
        {(data.prompt as string) || 'Awaiting input...'}
      </div>
      <Handle type="target" position={Position.Left} className="!bg-pink-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-pink-400 !w-3 !h-3" />
    </div>
  );
}
export const HumanGateNode = memo(HumanGateNodeComponent);
