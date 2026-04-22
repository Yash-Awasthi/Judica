import { useState, useCallback } from "react";
import { Button } from "~/components/ui/button";
import { MessageSquare, Trash2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { formatDistanceToNow } from "date-fns";

export interface ConversationData {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

interface ConversationItemProps {
  conversation: ConversationData;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: ConversationItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirmDelete) {
        onDelete(conversation.id);
        setConfirmDelete(false);
      } else {
        setConfirmDelete(true);
        setTimeout(() => setConfirmDelete(false), 3000);
      }
    },
    [confirmDelete, conversation.id, onDelete]
  );

  const timeAgo = (() => {
    try {
      return formatDistanceToNow(new Date(conversation.createdAt), { addSuffix: true });
    } catch {
      return "";
    }
  })();

  return (
    <button
      onClick={() => onSelect(conversation.id)}
      className={cn(
        "w-full group flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        isActive
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <MessageSquare className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{conversation.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-muted-foreground">{timeAgo}</span>
          {conversation.messageCount > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {conversation.messageCount} msg{conversation.messageCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      <Button
        variant={confirmDelete ? "destructive" : "ghost"}
        size="icon-xs"
        onClick={handleDelete}
        className={cn(
          "shrink-0 mt-0.5",
          !confirmDelete && "opacity-0 group-hover:opacity-100 transition-opacity"
        )}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </button>
  );
}
