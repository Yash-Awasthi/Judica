import type { Conversation } from "../types/index.js";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  username: string;
  isOpen: boolean;
  onSelect: (id: string, title: string) => void;
  onHome: () => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  onShowMetrics: () => void;
  width: number;
  onWidthChange: (width: number) => void;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Sidebar({
  conversations,
  activeId,
  username,
  isOpen,
  onSelect,
  onHome,
  onNew,
  onDelete,
  onLogout,
  onShowMetrics,
  width,
  onWidthChange
}: SidebarProps) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(220, Math.min(480, startWidth + (moveEvent.clientX - startX)));
      onWidthChange(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "default";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
  };

  const userInitial = (username?.[0] || "U").toUpperCase();

  return (
    <aside
      style={{ width: isOpen ? `${width}px` : undefined }}
      className={`
        fixed md:relative z-40 h-full
        bg-[#030303] border-r border-white/[0.04]
        flex flex-col
        transition-transform duration-300 ease-in-out
        ${isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full md:translate-x-0"}
        ${!isOpen ? "w-64" : ""}
      `}
    >
      {/* Resize handle */}
      <div
        className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-accent/30 transition-colors z-50 hidden md:block group"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-16 bg-accent/0 group-hover:bg-accent/20 rounded-full transition-colors" />
      </div>

      {/* Header */}
      <div className="px-5 pt-6 pb-4 shrink-0">
        <button
          onClick={onHome}
          className="flex items-center gap-3 w-full px-2 py-1.5 rounded-xl hover:bg-white/[0.03] transition-colors group"
        >
          <div className="w-8 h-8 rounded-xl bg-accent/8 border border-accent/15 flex items-center justify-center shrink-0 group-hover:bg-accent/12 transition-colors">
            <span
              className="material-symbols-outlined text-accent"
              style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}
            >
              gavel
            </span>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold tracking-tight text-text">AI Council</p>
            <p className="text-[9px] uppercase tracking-[0.2em] text-text-dim font-bold">Digital Magistrate</p>
          </div>
        </button>
      </div>

      {/* Nav actions */}
      <nav className="px-3 space-y-0.5 shrink-0">
        <button
          onClick={onHome}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 ${
            !activeId
              ? "nav-item-active font-semibold"
              : "text-text-muted hover:bg-white/[0.04] hover:text-text"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">home</span>
          <span>Home</span>
        </button>

        <button
          onClick={onNew}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-muted hover:bg-white/[0.04] hover:text-text transition-all duration-150"
        >
          <span className="material-symbols-outlined text-[18px]">add_comment</span>
          <span>New Deliberation</span>
        </button>
      </nav>

      {/* Divider */}
      <div className="mx-4 my-3 border-t border-white/[0.04]" />

      {/* History */}
      <div className="flex-1 overflow-hidden flex flex-col px-3 min-h-0">
        <div className="text-[9px] font-black text-text-dim uppercase tracking-[0.2em] px-3 mb-2 shrink-0">
          Recent Sessions
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-custom space-y-0.5 pr-0.5">
          {conversations.length === 0 ? (
            <div className="px-3 py-4 text-xs text-text-dim italic text-center">
              No sessions yet
            </div>
          ) : (
            conversations.slice(0, 20).map(c => (
              <div
                key={c.id}
                onClick={() => onSelect(c.id, c.title)}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all text-sm relative
                  ${activeId === c.id
                    ? "bg-accent/5 text-text border border-accent/10"
                    : "text-text-muted hover:bg-white/[0.04] hover:text-text"
                  }`}
              >
                <span
                  className={`material-symbols-outlined text-[14px] shrink-0 transition-colors ${
                    activeId === c.id ? "text-accent/60" : "opacity-30"
                  }`}
                >
                  history
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs font-medium leading-tight">{c.title}</p>
                  {c.updatedAt && (
                    <p className="text-[9px] text-text-dim mt-0.5">{timeAgo(c.updatedAt)}</p>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-danger transition-all p-0.5 shrink-0"
                  title="Delete conversation"
                >
                  <span className="material-symbols-outlined text-[14px]">delete</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 mt-2 mb-0 border-t border-white/[0.04]" />

      {/* Footer */}
      <div className="px-3 py-3 space-y-0.5 shrink-0">
        {/* Status */}
        <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-text-dim">
          <span
            className="status-dot bg-success text-success"
          />
          <span className="uppercase tracking-widest font-bold">System Online</span>
        </div>

        {/* Metrics */}
        <button
          onClick={onShowMetrics}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-text-muted hover:bg-white/[0.04] hover:text-accent transition-all duration-150"
        >
          <span className="material-symbols-outlined text-[18px]">bar_chart</span>
          <span>Usage Stats</span>
        </button>

        {/* User row */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
          <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/15 flex items-center justify-center text-accent text-xs font-black uppercase shrink-0">
            {userInitial}
          </div>
          <span className="text-sm font-medium text-text truncate flex-1">{username || "User"}</span>
          <button
            onClick={onLogout}
            className="p-1 text-text-dim hover:text-danger transition-colors shrink-0"
            title="Logout"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
