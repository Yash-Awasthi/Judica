import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, MessageSquarePlus, Swords, Workflow,
  Brain, Store, BarChart3, Activity, Terminal,
  Shield, Settings, ChevronLeft, ChevronRight, LogOut, Trash2,
  MessageCircle, ChevronDown, ChevronUp, Search, Loader2, Zap,
  Cpu, Database, Network, Folder, FolderPlus, Users
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import type { Conversation, Project, SearchResult } from "../types/index";

function IntelligencePulse() {
  return (
    <div className="px-5 py-5 mt-2 border-t border-white/5 bg-white/[0.01]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity size={10} className="text-[var(--accent-mint)] animate-pulse" />
          <span className="text-[8px] font-black uppercase tracking-[0.3em] text-[var(--accent-mint)] opacity-70 font-diag">Sector_Telemetry</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-1 rounded-full bg-[var(--accent-mint)] shadow-[0_0_8px_var(--accent-mint)]" />
          <span className="text-[8px] font-mono text-white opacity-40 uppercase">Safe</span>
        </div>
      </div>
      <div className="flex items-end gap-[2px] h-10 overflow-hidden px-1">
        {Array.from({ length: 28 }).map((_, i) => (
          <motion.div 
            key={i}
            className={`w-[2.5px] rounded-t-sm ${i % 6 === 0 ? "bg-[var(--accent-mint)]" : "bg-[var(--accent-mint)]/10"}`}
            animate={{ 
              height: [`${20 + Math.random() * 40}%`, `${60 + Math.random() * 40}%`, `${20 + Math.random() * 40}%`],
              opacity: [0.2, 0.5, 0.2]
            }}
            transition={{ repeat: Infinity, duration: 1.2 + Math.random(), ease: "easeInOut" }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between mt-4 text-[8px] font-diag uppercase tracking-[0.2em] text-[var(--text-muted)]">
        <div className="flex items-center gap-2">
          <Zap size={10} className="text-[var(--accent-gold)]" />
          <span className="opacity-40">Lag</span>
        </div>
        <span className="text-white/60 font-black tracking-tight italic">0.002s</span>
      </div>
    </div>
  );
}

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
  onSearch: (query: string, projectId?: string, after?: string, before?: string) => void;
  searchResults?: SearchResult[] | null;
  isSearching?: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  projects?: Project[];
  role?: string;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getDateRange(filter: string): { after?: string; before?: string } {
  const now = new Date();
  if (filter === "24h") {
    const after = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { after: after.toISOString() };
  }
  if (filter === "7d") {
    const after = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { after: after.toISOString() };
  }
  if (filter === "30d") {
    const after = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { after: after.toISOString() };
  }
  return {};
}

interface NavItemProps {
  to?: string;
  icon: React.ReactNode;
  label: string;
  sector?: string;
  active?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}

function NavItem({ to, icon, label, sector, active, onClick, collapsed }: NavItemProps) {
  const classes = `w-full relative flex items-center gap-3.5 px-3 py-2.5 rounded-2xl text-[13px] transition-all duration-500 group overflow-hidden ${
    active
      ? "text-white font-black bg-white/[0.04] shadow-inner"
      : "text-white/40 hover:bg-white/[0.04] hover:text-white"
  }`;

  const content = (
    <>
      {active && (
        <motion.div 
          layoutId="activeTabGlow"
          className="absolute left-0 top-0 bottom-0 w-[4px] bg-[var(--accent-mint)] rounded-r-full shadow-[0_0_20px_var(--accent-mint)] z-10" 
        />
      )}
      <span className={`shrink-0 w-5 h-5 flex items-center justify-center transition-all duration-500 group-hover:scale-110 ${active ? "text-[var(--accent-mint)]" : "opacity-40 group-hover:opacity-100 group-hover:text-[var(--accent-mint)]"}`}>
        {icon}
      </span>
      {!collapsed && (
        <div className="flex flex-col items-start min-w-0">
          {sector && <span className="text-[7px] font-diag opacity-30 group-hover:opacity-60 transition-opacity uppercase tracking-[0.2em] mb-0.5">{sector}</span>}
          <span className="truncate tracking-tight uppercase font-black text-[10px] tracking-[0.1em]">{label}</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.01] to-transparent opacity-0 group-hover:opacity-100 transition-opacity translate-x-[-100%] group-hover:translate-x-[100%] duration-1000 pointer-events-none" />
    </>
  );

  if (to) {
    return <Link to={to} className={classes} onClick={onClick} aria-current={active ? "page" : undefined}>{content}</Link>;
  }
  return <button onClick={onClick} className={classes} aria-current={active ? "page" : undefined}>{content}</button>;
}

function SectionHeader({ label, collapsed }: { label: string; collapsed?: boolean }) {
  if (collapsed) return <div className="h-4" />;
  return (
    <div className="px-3 mt-8 mb-3 flex items-center gap-3">
      <p className="text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag">
        {label}
      </p>
      <div className="h-[1px] flex-1 bg-white/5" />
    </div>
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
  onShowMetrics: _onShowMetrics,
  onSearch,
  searchResults: _searchResults,
  isSearching,
  width,
  onWidthChange,
  projects = [],
  role = "viewer"
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchProjectId, setSelectedSearchProjectId] = useState<string>("");
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>("all");
  const location = useLocation();
  const currentPath = location.pathname;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (collapsed) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMouseMove = (moveEvent: MouseEvent) => {
      onWidthChange(Math.max(240, Math.min(480, startWidth + (moveEvent.clientX - startX))));
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
  const sidebarWidth = collapsed ? 80 : width;

  return (
    <aside
      style={{ width: isOpen ? `${sidebarWidth}px` : undefined }}
      className={`
        fixed md:relative z-[60] h-full
        bg-black border-r border-white/5
        flex flex-col
        transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1)
        ${isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        shadow-2xl overflow-hidden
      `}
    >
      <div className="absolute inset-0 bg-[#050505] noise opacity-50 z-0 pointer-events-none" />
      
      {/* Resize handle */}
      {!collapsed && (
        <div
          className="absolute right-0 top-0 w-1.5 h-full cursor-col-resize hover:bg-[var(--accent-mint)]/20 transition-colors z-[100] hidden md:block group"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-32 rounded-full opacity-0 group-hover:opacity-100 transition-opacity bg-[var(--accent-mint)]/40" />
        </div>
      )}

      {/* Header — Logo + Collapse */}
      <div className={`shrink-0 z-10 ${collapsed ? "px-2 pt-6 pb-4" : "px-5 pt-7 pb-4"} flex items-center justify-between`}>
        <button
          onClick={onHome}
          className={`group flex items-center gap-3 transition-all ${collapsed ? "mx-auto" : ""}`}
        >
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[var(--accent-mint)] to-emerald-600 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(110,231,183,0.3)] group-hover:rotate-12 transition-transform duration-500">
            <span className="text-black text-lg font-black italic">A</span>
          </div>
          {!collapsed && (
            <div className="text-left">
              <p className="text-sm font-black tracking-tighter text-white italic">
                AIBY<span className="text-[var(--accent-mint)]">AI</span>
              </p>
              <p className="text-[8px] font-diag uppercase tracking-[0.3em] text-white/20 font-black">
                Mission_Control
              </p>
            </div>
          )}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-2 rounded-xl text-white/10 hover:text-white hover:bg-white/5 transition-all hidden md:flex"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className={`flex-1 overflow-y-auto scrollbar-custom z-10 ${collapsed ? "px-2" : "px-4"} space-y-1 pb-10`} role="navigation">
        <SectionHeader label="Intelligence" collapsed={collapsed} />
        <NavItem to="/" icon={<Home size={18} />} label="Operational_Hub" sector="SEC-00" active={currentPath === "/"} collapsed={collapsed} onClick={onHome} />
        <NavItem icon={<MessageSquarePlus size={18} />} label="Init_Deliberation" sector="COMM-01" onClick={onNew} collapsed={collapsed} active={currentPath.startsWith("/chat") && !activeId} />
        <NavItem to="/debate" icon={<Network size={18} />} label="Debate_Arena" sector="COMBAT-07" active={currentPath === "/debate"} collapsed={collapsed} />

        <SectionHeader label="Automation" collapsed={collapsed} />
        <NavItem to="/workflows" icon={<Workflow size={18} />} label="Flow_Control" sector="PROT-04" active={currentPath.startsWith("/workflow")} collapsed={collapsed} />
        <NavItem to="/prompts" icon={<Terminal size={18} />} label="Prompt_IDE" sector="CODE-09" active={currentPath === "/prompts"} collapsed={collapsed} />
        <NavItem to="/skills" icon={<Zap size={18} />} label="Unit_Skills" sector="UNIT-11" active={currentPath === "/skills"} collapsed={collapsed} />
        <NavItem to="/archetypes" icon={<Users size={18} />} label="Archetypes" sector="ARCH-03" active={currentPath === "/archetypes"} collapsed={collapsed} />

        <SectionHeader label="Knowledge" collapsed={collapsed} />
        <NavItem to="/repos" icon={<Database size={18} />} label="Data_Vaults" sector="INTEL-12" active={currentPath === "/repos"} collapsed={collapsed} />
        <NavItem to="/memory" icon={<Brain size={18} />} label="Deep_Memory" sector="MEM-06" active={currentPath === "/memory"} collapsed={collapsed} />

        <SectionHeader label="Exchange" collapsed={collapsed} />
        <NavItem to="/marketplace" icon={<Store size={18} />} label="Asset_Exchange" sector="EXCH-02" active={currentPath === "/marketplace"} collapsed={collapsed} />

        <SectionHeader label="Sim_Training" collapsed={collapsed} />
        <NavItem to="/benchmarks" icon={<Swords size={18} />} label="Model_Bench" sector="SIM-05" active={currentPath === "/benchmarks"} collapsed={collapsed} />
        <NavItem to="/training" icon={<Cpu size={18} />} label="Neuro_Forge" sector="GEN-07" active={currentPath === "/training"} collapsed={collapsed} />

        <SectionHeader label="Diagnostics" collapsed={collapsed} />
        {role === "admin" && (
          <>
            <NavItem to="/analytics" icon={<BarChart3 size={18} />} label="Global_Telemetry" sector="TELE-08" active={currentPath === "/analytics"} collapsed={collapsed} />
            <NavItem to="/workspace" icon={<Users size={18} />} label="Workspace_Roles" sector="ACL-13" active={currentPath === "/workspace"} collapsed={collapsed} />
            <NavItem to="/admin" icon={<Shield size={18} />} label="Root_Admin" sector="SYS-AD" active={currentPath === "/admin"} collapsed={collapsed} />
          </>
        )}
        <NavItem to="/settings" icon={<Settings size={18} />} label="Global_Settings" sector="CONF" active={currentPath === "/settings"} collapsed={collapsed} />
      </nav>

      {/* Projects Section */}
      {!collapsed && (
        <div className="shrink-0 flex flex-col px-4 min-h-0 z-10 pb-4 border-t border-white/5 pt-6 bg-black">
          <button
            onClick={() => setProjectsOpen(!projectsOpen)}
            className="flex items-center justify-between px-3 mb-4 w-full text-[9px] font-black text-white/20 uppercase tracking-[0.4em] font-diag hover:text-white transition-all"
          >
            <span>Operational_Projects</span>
            {projectsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          <AnimatePresence>
            {projectsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", maxHeight: 200, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-y-auto scrollbar-custom space-y-1.5 pr-2 mb-4"
              >
                <Link
                  to="/projects"
                  className={`group flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer transition-all border relative overflow-hidden
                    ${currentPath === "/projects"
                      ? "bg-[var(--accent-mint)]/10 text-white border-[var(--accent-mint)]/30"
                      : "bg-white/[0.02] text-white/40 border-transparent hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
                    }`}
                >
                  <FolderPlus size={14} className={`shrink-0 ${currentPath === "/projects" ? "text-[var(--accent-mint)]" : "opacity-20"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[11px] font-black uppercase tracking-tight italic">Manage_Projects</p>
                  </div>
                </Link>

                {projects.slice(0, 5).map(p => (
                  <Link
                    key={p.id}
                    to={`/projects/${p.id}`}
                    className={`group flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer transition-all border relative overflow-hidden
                      ${currentPath === `/projects/${p.id}`
                        ? "bg-[var(--accent-mint)]/10 text-white border-[var(--accent-mint)]/30"
                        : "bg-white/[0.02] text-white/40 border-transparent hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
                      }`}
                  >
                    <Folder size={14} className={`shrink-0 ${currentPath === `/projects/${p.id}` ? "text-[var(--accent-mint)]" : "opacity-20"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-[11px] font-black uppercase tracking-tight italic">{p.name}</p>
                      <p className="text-[7px] font-diag uppercase tracking-widest mt-1 opacity-40">{p.conversationCount || 0} SECTOR_DATA</p>
                    </div>
                  </Link>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Recent Sessions */}
      {!collapsed && (
        <div className="shrink-0 flex flex-col px-4 min-h-0 z-10 pb-4 border-t border-white/5 pt-6 bg-black">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center justify-between px-3 mb-4 w-full text-[9px] font-black text-white/20 uppercase tracking-[0.4em] font-diag hover:text-white transition-all"
          >
            <span>Active_Trace_History</span>
            {historyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {/* Search Bar & Filters */}
          <div className="px-1 mb-4 space-y-2">
            <div className="relative group">
              <Search size={14} className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searchQuery ? "text-[var(--accent-mint)]" : "text-white/20"}`} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { 
                  setSearchQuery(e.target.value); 
                  const dates = getDateRange(selectedDateFilter);
                  onSearch(e.target.value, selectedSearchProjectId || undefined, dates.after, dates.before); 
                }}
                placeholder="TRACE_HISTORY..."
                className="w-full bg-white/[0.02] border border-white/5 focus:border-[var(--accent-mint)]/30 rounded-2xl py-3 pl-12 pr-10 text-[10px] text-white font-diag uppercase tracking-widest placeholder:text-white/5 focus:outline-none transition-all"
              />
              {isSearching && <Loader2 size={12} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[var(--accent-mint)]" />}
            </div>
            
            {!collapsed && (
              <div className="flex gap-2">
                <select 
                  value={selectedSearchProjectId}
                  onChange={(e) => {
                    setSelectedSearchProjectId(e.target.value);
                    const dates = getDateRange(selectedDateFilter);
                    onSearch(searchQuery, e.target.value || undefined, dates.after, dates.before);
                  }}
                  className="flex-1 bg-white/[0.02] border border-white/5 focus:border-[var(--accent-mint)]/30 rounded-xl py-2 px-3 text-[9px] text-white/40 font-diag uppercase tracking-widest focus:outline-none transition-all appearance-none cursor-pointer hover:bg-white/[0.04]"
                >
                  <option value="" className="bg-black text-white italic">ALL_SECTORS</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id} className="bg-black text-white italic">{p.name}</option>
                  ))}
                </select>

                <select 
                  value={selectedDateFilter}
                  onChange={(e) => {
                    setSelectedDateFilter(e.target.value);
                    const dates = getDateRange(e.target.value);
                    onSearch(searchQuery, selectedSearchProjectId || undefined, dates.after, dates.before);
                  }}
                  className="flex-1 bg-white/[0.02] border border-white/5 focus:border-[var(--accent-mint)]/30 rounded-xl py-2 px-3 text-[9px] text-white/40 font-diag uppercase tracking-widest focus:outline-none transition-all appearance-none cursor-pointer hover:bg-white/[0.04]"
                >
                  <option value="all" className="bg-black text-white italic">ALL_TIME</option>
                  <option value="24h" className="bg-black text-white italic">LAST_24H</option>
                  <option value="7d" className="bg-black text-white italic">LAST_7D</option>
                  <option value="30d" className="bg-black text-white italic">LAST_30D</option>
                </select>
              </div>
            )}
          </div>

          <AnimatePresence>
            {historyOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 280, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-y-auto scrollbar-custom space-y-1.5 pr-2"
              >
                {conversations.slice(0, 15).map(c => (
                    <div
                      key={c.id}
                      onClick={() => onSelect(c.id, c.title)}
                      className={`group flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer transition-all border relative overflow-hidden
                        ${activeId === c.id
                          ? "bg-[var(--accent-mint)]/10 text-white border-[var(--accent-mint)]/30"
                          : "bg-white/[0.02] text-white/40 border-transparent hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
                        }`}
                    >
                      <MessageCircle size={14} className={`shrink-0 ${activeId === c.id ? "text-[var(--accent-mint)] animate-pulse" : "opacity-20"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[11px] font-black uppercase tracking-tight italic">{c.title}</p>
                        <p className="text-[8px] font-diag uppercase tracking-widest mt-1 opacity-40">{timeAgo(c.updatedAt)}</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(c.id); }} aria-label="Delete conversation" className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-red-400 p-1">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Pulse Telemetry */}
      {!collapsed && <div className="z-10"><IntelligencePulse /></div>}

      {/* Footer — User */}
      <div className={`shrink-0 z-10 ${collapsed ? "px-2" : "px-4"} py-6 border-t border-white/5 bg-black`}>
        <div className={`flex items-center ${collapsed ? "flex-col gap-4 py-4" : "gap-4 px-4 py-3"} rounded-[2rem] bg-white/[0.02] border border-white/5 shadow-inner group transition-all hover:bg-white/[0.04]`}>
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[var(--accent-mint)] to-emerald-600 flex items-center justify-center text-black text-sm font-black italic shrink-0 shadow-lg">
            {userInitial}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-white uppercase tracking-tight truncate">{username || "Admin_Root"}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                   <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-mint)] animate-pulse" />
                   <span className="text-[7px] font-diag uppercase text-[var(--accent-mint)] tracking-widest font-black">Secure_Session</span>
                </div>
              </div>
              <ThemeToggle />
              <button
                onClick={onLogout}
                aria-label="Log out"
                className="p-2 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
              >
                <LogOut size={16} />
              </button>
            </>
          )}
          {collapsed && (
            <div className="flex flex-col gap-4">
               <ThemeToggle />
               <button onClick={onLogout} className="p-2 text-white/20 hover:text-red-400 transition-colors"><LogOut size={16} /></button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
