import { Star, Download, User } from "lucide-react";

interface MarketplaceCardProps {
  item: {
    id: string;
    type: string;
    name: string;
    description: string;
    authorName: string;
    tags: string[];
    stars: number;
    downloads: number;
    version: string;
  };
  onClick: (id: string) => void;
  onInstall: (id: string) => void;
}

const typeIcons: Record<string, string> = {
  prompt: "edit_note",
  workflow: "account_tree",
  persona: "person",
  tool: "build",
};

const typeColors: Record<string, string> = {
  prompt: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  workflow: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  persona: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  tool: "text-amber-400 bg-amber-400/10 border-amber-400/20",
};

export function MarketplaceCard({ item, onClick, onInstall }: MarketplaceCardProps) {
  return (
    <div
      onClick={() => onClick(item.id)}
      className="group bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 hover:bg-white/[0.04] hover:border-white/[0.1] transition-all cursor-pointer flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${typeColors[item.type] || "text-text-muted bg-white/5 border-white/10"}`}>
          <span className="material-symbols-outlined text-[20px]">
            {typeIcons[item.type] || "extension"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text truncate group-hover:text-accent transition-colors">
            {item.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <User size={11} className="text-text-dim" />
            <span className="text-[11px] text-text-dim">{item.authorName}</span>
            <span className="text-[10px] text-text-dim/50 ml-1">v{item.version}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-text-muted leading-relaxed mb-3 line-clamp-2 flex-1">
        {item.description}
      </p>

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {item.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-white/[0.04] border border-white/[0.06] text-text-dim"
            >
              {tag}
            </span>
          ))}
          {item.tags.length > 4 && (
            <span className="text-[10px] text-text-dim">+{item.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/[0.04]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-[11px] text-text-dim">
            <Star size={12} className="text-amber-400/70" />
            {item.stars}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-text-dim">
            <Download size={12} />
            {item.downloads}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInstall(item.id);
          }}
          className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
        >
          Install
        </button>
      </div>
    </div>
  );
}
