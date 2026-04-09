import { Star, Download, User, Code2, Workflow, UserCircle, Wrench, Package } from "lucide-react";

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

const typeIcons: Record<string, React.ReactNode> = {
  prompt: <Code2 size={18} />,
  workflow: <Workflow size={18} />,
  persona: <UserCircle size={18} />,
  tool: <Wrench size={18} />,
};

const typeColors: Record<string, { bg: string; text: string; border: string }> = {
  prompt: { bg: "rgba(96,165,250,0.08)", text: "var(--accent-blue)", border: "rgba(96,165,250,0.15)" },
  workflow: { bg: "rgba(110,231,183,0.08)", text: "var(--accent-mint)", border: "rgba(110,231,183,0.15)" },
  persona: { bg: "rgba(167,139,250,0.08)", text: "#a78bfa", border: "rgba(167,139,250,0.15)" },
  tool: { bg: "rgba(251,191,36,0.08)", text: "var(--accent-gold)", border: "rgba(251,191,36,0.15)" },
};

const defaultTypeColor = { bg: "var(--glass-bg)", text: "var(--text-muted)", border: "var(--glass-border)" };

export function MarketplaceCard({ item, onClick, onInstall }: MarketplaceCardProps) {
  const typeColor = typeColors[item.type] || defaultTypeColor;

  return (
    <div
      onClick={() => onClick(item.id)}
      className="group surface-card p-5 hover:border-[var(--accent-mint)]/30 transition-all cursor-pointer flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0"
          style={{ backgroundColor: typeColor.bg, color: typeColor.text, borderColor: typeColor.border }}
        >
          {typeIcons[item.type] || <Package size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--accent-mint)] transition-colors">
            {item.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <User size={11} className="text-[var(--text-muted)]" />
            <span className="text-[11px] text-[var(--text-muted)]">{item.authorName}</span>
            <span className="text-[10px] text-[var(--text-muted)] opacity-50 ml-1">v{item.version}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3 line-clamp-2 flex-1">
        {item.description}
      </p>

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {item.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-[10px] font-medium rounded-pill bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[var(--text-muted)]"
            >
              {tag}
            </span>
          ))}
          {item.tags.length > 4 && (
            <span className="text-[10px] text-[var(--text-muted)]">+{item.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <Star size={12} className="text-[var(--accent-gold)] opacity-70" />
            {item.stars}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <Download size={12} />
            {item.downloads}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInstall(item.id);
          }}
          className="px-3 py-1.5 text-[11px] font-semibold rounded-button bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)] hover:bg-[rgba(110,231,183,0.15)] transition-colors"
        >
          Install
        </button>
      </div>
    </div>
  );
}
