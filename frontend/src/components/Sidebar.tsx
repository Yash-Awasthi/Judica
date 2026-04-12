import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, MessageSquarePlus, Swords, Workflow, Code2, Braces,
  GitBranch, Brain, Store, BarChart3, Activity,
  Shield, Settings, ChevronLeft, ChevronRight, LogOut, Trash2,
  MessageCircle, ChevronDown, ChevronUp
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
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

interface NavItemProps {
  to?: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}

function NavItem({ to, icon, label, active, onClick, collapsed }: NavItemProps) {
  const classes = `w-full flex items-center gap-3 px-3 py-2 rounded-button text-sm transition-all duration-150 group ${
    active
      ? "bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] font-semibold"
      : "text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]"
  }`;

  const content = (
    <>
      <span className="shrink-0 w-5 h-5 flex items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} onClick={onClick}>
        {content}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={classes}>
      {content}
    </button>
  );
}

function SectionHeader({ label, collapsed }: { label: string; collapsed?: boolean }) {
  if (collapsed) return null;
  return (
    <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] px-3 mt-4 mb-1.5">
      {label}
    </p>
  );
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
  const [collapsed, setCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const location = useLocation();
  const currentPath = location.pathname;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (collapsed) return;
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
  const sidebarWidth = collapsed ? 64 : width;

  return (
    <aside
      style={{ width: isOpen ? `${sidebarWidth}px` : undefined }}
      className={`
        fixed md:relative z-40 h-full
        bg-[var(--bg-surface-1)] border-r border-[var(--border-subtle)]
        flex flex-col
        transition-all duration-300 ease-in-out
        ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        ${!isOpen ? "w-64" : ""}
      `}
    >
      {/* Resize handle */}
      {!collapsed && (
        <div
          className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-[var(--accent-mint)]/30 transition-colors z-50 hidden md:block group"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-16 rounded-full transition-colors group-hover:bg-[var(--accent-mint)]/20" />
        </div>
      )}

      {/* Header — Logo + Collapse */}
      <div className={`shrink-0 ${collapsed ? "px-2 pt-4 pb-3" : "px-4 pt-5 pb-3"} flex items-center justify-between`}>
        <button
          onClick={onHome}
          className={`flex items-center gap-2.5 rounded-button hover:bg-[var(--glass-bg-hover)] transition-colors ${collapsed ? "p-2" : "px-2 py-1.5"}`}
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--accent-mint)] to-emerald-500 flex items-center justify-center shrink-0 shadow-glow-sm">
            <span className="text-black text-sm font-black">A</span>
          </div>
          {!collapsed && (
            <div className="text-left">
              <p className="text-sm font-bold tracking-tight text-[var(--text-primary)]">
                AIBY<span className="text-[var(--accent-mint)]">AI</span>
              </p>
              <p className="text-[9px] uppercase tracking-[0.15em] text-[var(--text-muted)] font-semibold">
                Multi-Agent Council
              </p>
            </div>
          )}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-bg-hover)] transition-colors hidden md:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className={`${collapsed ? "px-1.5" : "px-2"} space-y-0.5 shrink-0`}>
        {/* Main */}
        <SectionHeader label="Main" collapsed={collapsed} />
        <NavItem to="/" icon={<Home size={16} />} label="Home" active={currentPath === "/"} collapsed={collapsed} onClick={onHome} />
        <NavItem icon={<MessageSquarePlus size={16} />} label="New Chat" onClick={onNew} collapsed={collapsed} />
        <NavItem to="/debate" icon={<Swords size={16} />} label="Debate Arena" active={currentPath === "/debate"} collapsed={collapsed} />

        {/* Build */}
        <SectionHeader label="Build" collapsed={collapsed} />
        <NavItem to="/workflows" icon={<Workflow size={16} />} label="Workflows" active={currentPath.startsWith("/workflow")} collapsed={collapsed} />
        <NavItem to="/prompts" icon={<Code2 size={16} />} label="Prompt IDE" active={currentPath === "/prompts"} collapsed={collapsed} />
        <NavItem to="/skills" icon={<Braces size={16} />} label="Skills" active={currentPath === "/skills"} collapsed={collapsed} />

        {/* Knowledge */}
        <SectionHeader label="Knowledge" collapsed={collapsed} />
        <NavItem to="/repos" icon={<GitBranch size={16} />} label="Repos" active={currentPath === "/repos"} collapsed={collapsed} />
        <NavItem to="/memory" icon={<Brain size={16} />} label="Memory" active={currentPath === "/memory"} collapsed={collapsed} />

        {/* Community */}
        <SectionHeader label="Community" collapsed={collapsed} />
        <NavItem to="/marketplace" icon={<Store size={16} />} label="Marketplace" active={currentPath === "/marketplace"} collapsed={collapsed} />

        {/* System */}
        <SectionHeader label="System" collapsed={collapsed} />
        <NavItem to="/analytics" icon={<BarChart3 size={16} />} label="Analytics" active={currentPath === "/analytics"} collapsed={collapsed} />
        <NavItem icon={<Activity size={16} />} label="Metrics" onClick={onShowMetrics} collapsed={collapsed} />
        <NavItem to="/admin" icon={<Shield size={16} />} label="Admin" active={currentPath === "/admin"} collapsed={collapsed} />
        <NavItem to="/settings" icon={<Settings size={16} />} label="Settings" active={currentPath === "/settings"} collapsed={collapsed} />
      </nav>

      {/* Divider */}
      <div className="mx-3 my-3 border-t border-[var(--border-subtle)]" />

      {/* Recent Sessions */}
      {!collapsed && (
        <div className="flex-1 overflow-hidden flex flex-col px-2 min-h-0">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center justify-between px-3 mb-1.5 w-full text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-[0.15em] hover:text-[var(--text-secondary)] transition-colors"
          >
            <span>Recent Sessions</span>
            {historyOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
          <AnimatePresence>
            {historyOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex-1 overflow-y-auto scrollbar-custom space-y-0.5 pr-0.5"
              >
                {conversations.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-[var(--text-muted)] italic text-center">
                    No sessions yet
                  </div>
                ) : (
                  conversations.slice(0, 15).map(c => (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(c.id, c.title)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(c.id, c.title);
                        }
                      }}
                      className={`group flex items-center gap-2 px-3 py-2 rounded-button cursor-pointer transition-all text-sm relative
                        ${activeId === c.id
                          ? "bg-[rgba(110,231,183,0.06)] text-[var(--text-primary)] border border-[rgba(110,231,183,0.12)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--text-primary)]"
                        }`}
                    >
                      <MessageCircle size={13} className={`shrink-0 ${activeId === c.id ? "text-[var(--accent-mint)]" : "opacity-30"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-xs font-medium leading-tight">{c.title}</p>
                        {c.updatedAt && (
                          <p className="text-[9px] text-[var(--text-muted)] mt-0.5">{timeAgo(c.updatedAt)}</p>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[var(--accent-coral)] transition-all p-0.5 shrink-0"
                        title="Delete conversation"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Footer — User + Theme */}
      <div className={`${collapsed ? "px-1.5" : "px-2"} py-3 shrink-0 border-t border-[var(--border-subtle)] mt-auto`}>
        {/* System Status */}
        <div className={`flex items-center gap-2 ${collapsed ? "justify-center py-2" : "px-3 py-1.5"} text-[10px] text-[var(--text-muted)]`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-mint)]" style={{ boxShadow: '0 0 6px var(--accent-mint)' }} />
          {!collapsed && <span className="uppercase tracking-widest font-semibold">Online</span>}
        </div>

        {/* User row */}
        <div className={`flex items-center ${collapsed ? "flex-col gap-2 py-2" : "gap-2 px-3 py-2"} rounded-button bg-[var(--glass-bg)] border border-[var(--glass-border)]`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent-mint)] to-emerald-500 flex items-center justify-center text-black text-xs font-bold uppercase shrink-0">
            {userInitial}
          </div>
          {!collapsed && (
            <>
              <span className="text-sm font-medium text-[var(--text-primary)] truncate flex-1">
                {username || "User"}
              </span>
              <ThemeToggle />
              <button
                onClick={onLogout}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-coral)] transition-colors shrink-0 rounded-lg hover:bg-[var(--glass-bg-hover)]"
                title="Logout"
              >
                <LogOut size={14} />
              </button>
            </>
          )}
          {collapsed && (
            <div className="flex flex-col gap-1.5">
              <ThemeToggle />
              <button
                onClick={onLogout}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-coral)] transition-colors rounded-lg hover:bg-[var(--glass-bg-hover)]"
                title="Logout"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
