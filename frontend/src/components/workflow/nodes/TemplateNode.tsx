import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";

function TemplateNodeComponent({ data, selected }: NodeProps) {
  return (
    <div className={`bg-white rounded-lg shadow-md border-2 ${selected ? 'border-blue-500' : 'border-teal-300'} min-w-[200px]`}>
      <div className="bg-teal-100 px-3 py-2 rounded-t-md flex items-center gap-2">
        <FileText size={16} className="text-teal-600" />
        <span className="text-sm font-semibold text-teal-700">Template</span>
      </div>
      <div className="p-3 text-xs text-gray-600 truncate max-w-[180px]">
        {(data.template as string)?.substring(0, 50) || 'Enter template...'}
      </div>
      <Handle type="target" position={Position.Left} className="!bg-teal-400 !w-3 !h-3" />
      <Handle type="source" position={Position.Right} className="!bg-teal-400 !w-3 !h-3" />
    </div>
  );
}
export const TemplateNode = memo(TemplateNodeComponent);
