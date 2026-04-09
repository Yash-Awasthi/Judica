import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Split } from "lucide-react";

function SplitNodeComponent({ selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-slate-300'} min-w-[160px]`}>
      <div className="bg-slate-100 px-3 py-2 rounded-md flex items-center gap-2">
        <Split size={16} className="text-slate-600" />
        <span className="text-sm font-semibold text-slate-700">Split</span>
      </div>
      <Handle type="target" position={Position.Left} className="!bg-slate-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400 !w-3 !h-3" />
    </div>
  );
}
export const SplitNode = memo(SplitNodeComponent);
