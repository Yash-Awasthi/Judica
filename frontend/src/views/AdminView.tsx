import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Shield, Trash2, MessageSquare, Terminal,
  Cpu, Search, Settings, Activity, Globe, History,
  Lock, CheckCircle2, XCircle, RotateCcw,
  LayoutGrid, ChevronRight, Zap, ChevronUp, ChevronDown,
  ChevronLeft, User, Mail, Calendar, X
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter } from "../components/AnimatedCounter";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";
import ReactECharts from "echarts-for-react";

// ─── TYPES ──────────────────────────────────────────────────────────────────

interface UserRow {
  id: number;
  email: string;
  username: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface AuditLogRow {
  id: number;
  adminId: number;
  username: string;
  actionType: string;
  resourceType: string;
  resourceId: string;
  details: any;
  status: string;
  createdAt: string;
}

interface UsagePoint {
  date: string;
  promptTokens: number;
  completionTokens: number;
  count: number;
}

interface Stats {
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
  totalTokens: number;
}

type AdminSection = "users" | "groups" | "config" | "providers" | "analytics" | "security";

// ─── UTILS ──────────────────────────────────────────────────────────────────

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.05 } } },
  item: { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, scale: 0.98 } },
};

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────

function UserDetailModal({ user, onClose }: { user: any, onClose: () => void }) {
  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl"
        onClick={onClose}
      >
        <motion.div 
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="w-full max-w-4xl glass-panel border border-white/10 rounded-[2.5rem] bg-[#050505] overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.8)]"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="relative h-40 bg-gradient-to-br from-[var(--accent-blue)]/20 to-transparent p-10 flex items-end justify-between">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
                <User size={40} className="text-white/20" />
              </div>
              <div>
                <h2 className="text-3xl font-black text-white italic tracking-tighter">{user.username}</h2>
                <div className="flex items-center gap-3 mt-2">
                  <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-lg text-[8px] font-black uppercase tracking-widest text-white/40">ID_{user.id}</span>
                  <span className={`px-2 py-0.5 border rounded-lg text-[8px] font-black uppercase tracking-widest ${user.isActive ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                    {user.isActive ? 'UNIT_ACTIVE' : 'UNIT_SUPENDED'}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all">
              <X size={20} className="text-white/40" />
            </button>
          </div>

          <div className="p-10 grid grid-cols-12 gap-8">
            {/* Stats Column */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl">
                <div className="flex items-center gap-3 mb-6">
                  <Activity size={16} className="text-[var(--accent-blue)]" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 italic">Unit_Performance</span>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center px-4 py-3 bg-white/5 rounded-2xl">
                    <span className="text-[10px] font-diag text-white/40">TOTAL_TOKENS</span>
                    <span className="text-sm font-black text-[var(--accent-blue)] font-mono">{(user.stats?.tokens || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-3 bg-white/5 rounded-2xl">
                    <span className="text-[10px] font-diag text-white/40">CONVERSATIONS</span>
                    <span className="text-sm font-black text-white font-mono">{user.stats?.conversations || 0}</span>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-white/[0.02] border border-white/5 rounded-3xl">
                <div className="flex items-center gap-3 mb-6">
                  <Shield size={16} className="text-[var(--accent-mint)]" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 italic">Identity_Verify</span>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-[10px]">
                    <Mail size={12} className="text-white/20" />
                    <span className="text-white/60 truncate">{user.email}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <Calendar size={12} className="text-white/20" />
                    <span className="text-white/60">Joined {new Date(user.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Content Column */}
            <div className="col-span-12 lg:col-span-8 space-y-6">
              <div className="p-8 bg-white/[0.02] border border-white/5 rounded-3xl h-full">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <Terminal size={16} className="text-[#a78bfa]" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 italic">Configured_Api_Interfaces</span>
                  </div>
                  <span className="text-[8px] font-mono text-white/20 font-black">REGISTRY_COUNT: {user.apiKeys?.length || 0}</span>
                </div>

                <div className="space-y-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-4">
                  {user.apiKeys?.length > 0 ? (
                    user.apiKeys.map((key: any, idx: number) => (
                      <div key={idx} className="p-5 bg-black/40 border border-white/5 rounded-2xl flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/20 group-hover:text-[#a78bfa] transition-colors">
                            <Cpu size={18} />
                          </div>
                          <div>
                            <div className="text-[11px] font-black text-white tracking-widest uppercase">{key.name}</div>
                            <div className="text-[8px] font-mono text-white/20 mt-1">{key.baseUrl}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[8px] font-black text-[#a78bfa] uppercase italic">VERIFIED</div>
                          <div className="text-[7px] font-mono text-white/10 mt-1">{new Date(key.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 opacity-20">
                      <Zap size={40} className="mb-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest italic">NO_CUSTOM_INTERFACES_FOUND</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function AdminView() {
  const { fetchWithAuth } = useAuth();
  const [activeSection, setActiveSection] = useState<AdminSection>("analytics");
  
  // Data State
  const [users, setUsers] = useState<UserRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [providers, setProviders] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [usageData, setUsageData] = useState<UsagePoint[]>([]);
  const [providerBreakdown, setProviderBreakdown] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<"email" | "username" | "createdAt">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [userPage, setUserPage] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  
  const [auditPage, setAuditPage] = useState(1);
  const [totalAuditLogs, setTotalAuditLogs] = useState(0);
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditDateStart, setAuditDateStart] = useState("");
  const [auditDateEnd, setAuditDateEnd] = useState("");
  const [activeUserDetail, setActiveUserDetail] = useState<any>(null);
  
  const USERS_PER_PAGE = 20;
  const AUDIT_PER_PAGE = 50;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const uParams = new URLSearchParams({
        page: userPage.toString(),
        limit: USERS_PER_PAGE.toString(),
        search: debouncedSearch,
        sortBy,
        sortOrder
      });

      const aParams = new URLSearchParams({
        page: auditPage.toString(),
        limit: AUDIT_PER_PAGE.toString(),
        actionType: auditActionFilter,
        startDate: auditDateStart,
        endDate: auditDateEnd
      });

      const [uRes, gRes, sRes, cRes, pRes, aRes, bRes, uLRes] = await Promise.all([
        fetchWithAuth(`/api/admin/users?${uParams}`),
        fetchWithAuth("/api/admin/groups"),
        fetchWithAuth("/api/admin/analytics/metrics"),
        fetchWithAuth("/api/admin/config"),
        fetchWithAuth("/api/admin/providers"),
        fetchWithAuth("/api/admin/analytics/daily-volume?days=30"),
        fetchWithAuth("/api/admin/analytics/provider-breakdown"),
        fetchWithAuth(`/api/admin/audit-log?${aParams}`)
      ]);

      if (uRes.ok) {
        const uData = await uRes.json();
        setUsers(uData.users);
        setTotalUsers(uData.total);
      }
      if (gRes.ok) {
        setGroups((await gRes.json()).groups);
      }
      if (sRes.ok) setStats(await sRes.json());
      if (cRes.ok) setConfig(await cRes.json());
      if (pRes.ok) setProviders((await pRes.json()).providers);
      if (aRes.ok) setUsageData((await aRes.json()).data);
      if (bRes.ok) setProviderBreakdown((await bRes.json()).providers);
      if (uLRes.ok) {
        const aData = await uLRes.json();
        setAuditLogs(aData.logs);
        setTotalAuditLogs(aData.total);
      }
    } catch (err) {
      console.error("Admin dashboard data sync failure", err);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, userPage, auditPage]);

  useEffect(() => { loadAllData(); }, [loadAllData, userPage, auditPage, debouncedSearch, sortBy, sortOrder, auditActionFilter, auditDateStart, auditDateEnd]);

  // Actions
  const toggleUserStatus = async (user: UserRow) => {
    const action = user.isActive ? "suspend" : "activate";
    try {
      const res = await fetchWithAuth(`/api/admin/users/${user.id}/${action}`, { method: "POST" });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isActive: !user.isActive } : u));
      }
    } catch (err) { console.error("Status toggle failed", err); }
  };

  const fetchUserDetail = async (userId: number) => {
    try {
      const res = await fetchWithAuth(`/api/admin/users/${userId}`);
      if (res.ok) {
        setActiveUserDetail((await res.json()).user);
      }
    } catch (err) { console.error("Failed to fetch user detail", err); }
  };

  const updateRole = async (userId: number, role: string) => {
    try {
      await fetchWithAuth(`/api/admin/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      loadAllData();
    } catch (err) { console.error("Role change failure", err); }
  };

  const updateConfigValue = async (key: string, value: any) => {
    try {
      await fetchWithAuth("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      setConfig(prev => ({ ...prev, [key]: value }));
    } catch (err) { console.error("Config update failure", err); }
  };
  const rotateKeys = async () => {
    if (!confirm("This will re-encrypt ALL system secrets. Highly sensitive operation. Proceed?")) return;
    try {
      const res = await fetchWithAuth("/api/admin/security/key-rotation", { method: "POST" });
      if (res.ok) {
        alert("Rotation sequence initialized successfully.");
        loadAllData();
      }
    } catch (err) { console.error("Rotation failure", err); }
  };

  const deleteUser = async (userId: number) => {
    if (!confirm("WARNING: This will permanently delete this unit and all its traces. Proceed?")) return;
    try {
      const res = await fetchWithAuth(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (res.ok) {
        setUsers(prev => prev.filter(u => u.id !== userId));
      }
    } catch (err) { console.error("Deletion failure", err); }
  };

  const setProviderDefault = async (providerId: number) => {
    try {
      const res = await fetchWithAuth(`/api/admin/providers/${providerId}/default`, { method: "POST" });
      if (res.ok) {
        setProviders(prev => prev.map(p => ({ ...p, isDefault: p.id === providerId })));
      }
    } catch (err) { console.error("Failed to set default provider", err); }
  };

  // ─── SECTION: ANALYTICS ───────────────────────────────────────────────────

  const AnalyticsSection = () => {
    const chartOptions = useMemo(() => ({
      backgroundColor: "transparent",
      tooltip: { 
        trigger: "axis", 
        backgroundColor: "rgba(0,0,0,0.8)", 
        borderColor: "#1a1a1a", 
        textStyle: { color: "#fff", fontSize: 10, fontFamily: "serif" }
      },
      grid: { left: "3%", right: "4%", bottom: "3%", containLabel: true },
      xAxis: { 
        type: "category", 
        data: usageData.map(d => d.date),
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
        axisLabel: { color: "rgba(255,255,255,0.4)", fontSize: 8 }
      },
      yAxis: { 
        type: "value",
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
        axisLabel: { color: "rgba(255,255,255,0.4)", fontSize: 8 }
      },
      series: [
        {
          name: "Prompt Tokens",
          type: "bar",
          stack: "total",
          data: usageData.map(d => d.promptTokens),
          itemStyle: { color: "rgba(34, 211, 238, 0.6)" }
        },
        {
          name: "Completion Tokens",
          type: "bar",
          stack: "total",
          data: usageData.map(d => d.completionTokens),
          itemStyle: { color: "rgba(16, 185, 129, 0.6)" }
        }
      ]
    }), [usageData]);

    return (
      <motion.div variants={stagger.container} initial="initial" animate="animate" className="space-y-8">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <MetricCard title="System_Uptime" value="99.99%" label="Reliability_Score" icon={<Zap size={14} />} color="var(--accent-mint)" />
          <MetricCard title="Token_Velocity" value={stats?.totalTokens?.toLocaleString() || "0"} label="Cumulative_Throughput" icon={<Activity size={14} />} color="var(--accent-blue)" />
          <MetricCard title="Trace_Count" value={stats?.totalConversations?.toLocaleString() || "0"} label="Active_Sessions" icon={<MessageSquare size={14} />} color="var(--accent-gold)" />
          <MetricCard title="Unit_Registry" value={stats?.totalUsers?.toLocaleString() || "0"} label="Authorized_Entities" icon={<Users size={14} />} color="#a78bfa" />
        </div>

        {/* Usage Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 glass-panel p-8 border border-white/5 rounded-3xl bg-white/[0.01]">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <div className="w-1.5 h-6 bg-[var(--accent-mint)] rounded-full" />
                        <div>
                            <h3 className="text-sm font-black text-white italic tracking-tight">INFERENCE_VOLUME_TELEMETRY</h3>
                            <p className="text-[7px] font-diag uppercase tracking-[0.3em] text-white/20">Temporal_Token_Distribution // 30_Day_Window</p>
                        </div>
                    </div>
                </div>
                <div className="h-[350px]">
                    <ReactECharts option={chartOptions} style={{ height: "100%", width: "100%" }} />
                </div>
            </div>

            <div className="glass-panel p-8 border border-white/5 rounded-3xl bg-white/[0.01]">
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-1.5 h-6 bg-[var(--accent-blue)] rounded-full" />
                    <div>
                        <h3 className="text-sm font-black text-white italic tracking-tight">PROVIDER_DISTRIBUTION</h3>
                        <p className="text-[7px] font-diag uppercase tracking-[0.3em] text-white/20">Market_Share // 7_Day_Trends</p>
                    </div>
                </div>
                
                <div className="space-y-6">
                    {providerBreakdown.map(p => (
                        <div key={p.name} className="space-y-2">
                            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest italic">
                                <div className="flex items-center gap-2">
                                    <span className="text-white/40">{p.name}</span>
                                    {p.trend === "up" && <ChevronUp size={10} className="text-[var(--accent-mint)]" />}
                                    {p.trend === "down" && <ChevronDown size={10} className="text-red-400" />}
                                </div>
                                <span className="text-[var(--accent-blue)]">{p.percentage.toFixed(1)}%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: `${p.percentage}%` }}
                                    className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-cyan-400"
                                />
                            </div>
                            <div className="text-[8px] font-mono text-white/10 text-right">
                                {p.tokens.toLocaleString()} TOKENS
                            </div>
                        </div>
                    ))}
                    {providerBreakdown.length === 0 && (
                        <div className="h-64 flex items-center justify-center border border-dashed border-white/5 rounded-2xl">
                            <p className="text-[8px] font-diag uppercase tracking-[0.3em] text-white/10 text-center px-12 leading-relaxed">
                                No_Provider_Data_Detected // Intelligence_Nodes_Inactive
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </motion.div>
    );
  };

  // ─── SECTION: USERS ───────────────────────────────────────────────────────

  const UsersSection = () => (
    <motion.div variants={stagger.item} className="glass-panel overflow-hidden border border-white/5 rounded-3xl bg-white/[0.01]">
        <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
            <div className="flex items-center gap-4">
                <div className="w-2 h-8 bg-[var(--accent-mint)] rounded-full" />
                <div>
                    <h2 className="text-lg font-black text-white italic tracking-tight">BIO_UNIT_AUTHORIZATION</h2>
                    <p className="text-[8px] font-diag uppercase tracking-[0.3em] text-white/20">Access_Control_List // Security_Status</p>
                </div>
            </div>
            <div className="relative group">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--accent-mint)] opacity-40 group-focus-within:opacity-100 transition-all" />
                <input 
                  className="bg-black/40 border border-white/10 rounded-2xl py-2.5 pl-12 pr-6 text-[10px] font-diag uppercase tracking-widest text-white focus:outline-none focus:border-[var(--accent-mint)]/40 w-80 transition-all" 
                  placeholder="FILTER_UNITS..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
        </div>
        
        <div className="overflow-x-auto overflow-y-auto max-h-[650px] scrollbar-custom">
            <table className="w-full text-left">
                <thead className="sticky top-0 bg-[#080808] z-20 border-b border-white/5">
                    <tr>
                        <th 
                          className="px-8 py-5 text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag cursor-pointer hover:text-white transition-colors"
                          onClick={() => { setSortBy("username"); setSortOrder(sortBy === "username" && sortOrder === "asc" ? "desc" : "asc"); }}
                        >
                          Designation {sortBy === "username" && (sortOrder === "asc" ? "↑" : "↓")}
                        </th>
                        <th className="px-8 py-5 text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag">Clearance</th>
                        <th className="px-8 py-5 text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag">Status</th>
                        <th 
                          className="px-8 py-5 text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag cursor-pointer hover:text-white transition-colors text-right"
                          onClick={() => { setSortBy("createdAt"); setSortOrder(sortBy === "createdAt" && sortOrder === "asc" ? "desc" : "asc"); }}
                        >
                          Actions {sortBy === "createdAt" && (sortOrder === "asc" ? "↑" : "↓")}
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {users.map((u) => (
                        <tr key={u.id} className="hover:bg-white/[0.01] transition-colors group relative">
                            <td className="px-8 py-5">
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br transition-all flex items-center justify-center text-xs font-black
                                      ${u.isActive ? "from-white/10 to-transparent text-white/40 group-hover:from-[var(--accent-mint)]/20 group-hover:to-emerald-600/20 group-hover:text-[var(--accent-mint)]" : "from-red-500/20 to-transparent text-red-400 opacity-50"}
                                    `}>
                                        {u.username[0].toUpperCase()}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className={`text-sm font-black italic tracking-tight ${u.isActive ? "text-white" : "text-white/30 line-through"}`}>{u.username}</span>
                                        <span className="text-[9px] font-diag text-white/20 uppercase tracking-widest">{u.email}</span>
                                    </div>
                                </div>
                            </td>
                            <td className="px-8 py-5">
                                <select
                                    className="bg-black/40 border border-white/5 rounded-xl px-4 py-1.5 text-[9px] font-black uppercase tracking-widest text-[var(--accent-mint)]/60 focus:outline-none focus:border-[var(--accent-mint)]/40 hover:bg-black/60 transition-all appearance-none cursor-pointer"
                                    value={u.role}
                                    onChange={(e) => updateRole(u.id, e.target.value)}
                                >
                                    <option value="admin">LVL_4_ROOT</option>
                                    <option value="member">LVL_2_CORE</option>
                                    <option value="viewer">LVL_1_SENSE</option>
                                </select>
                            </td>
                            <td className="px-8 py-5">
                                <div className="flex items-center gap-2">
                                    <div className={`w-1.5 h-1.5 rounded-full ${u.isActive ? "bg-[var(--accent-mint)] shadow-[0_0_8px_var(--accent-mint)]" : "bg-red-500 shadow-[0_0_8px_red]"}`} />
                                    <span className={`text-[9px] font-diag uppercase tracking-widest ${u.isActive ? "text-[var(--accent-mint)]/60" : "text-red-500/60"}`}>
                                      {u.isActive ? "Online" : "Terminated"}
                                    </span>
                                </div>
                            </td>
                            <td className="px-8 py-5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                      onClick={() => { fetchUserDetail(u.id); }}
                                      aria-label="View user details"
                                      className="p-2 hover:bg-white/10 rounded-xl transition-all"
                                    >
                                      <User size={14} className="text-white/40 group-hover:text-white" />
                                    </button>
                                    <button 
                                      onClick={() => toggleUserStatus(u)}
                                      className={`p-2 rounded-xl border transition-all ${
                                        u.isActive 
                                        ? "bg-red-500/5 text-red-400/40 border-red-500/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20" 
                                        : "bg-emerald-500/5 text-emerald-400/40 border-emerald-500/10 hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/20"
                                      }`}
                                      title={u.isActive ? "Suspend Unit" : "Activate Unit"}
                                    >
                                        {u.isActive ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                                    </button>
                                    <button 
                                      onClick={() => deleteUser(u.id)}
                                      className="p-2 rounded-xl border bg-red-950/20 text-red-600/40 border-red-900/10 hover:bg-red-600/10 hover:text-red-600 hover:border-red-600/20 transition-all"
                                      title="Delete Unit"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        <div className="flex items-center justify-between mt-8 p-6 glass-panel border border-white/5 rounded-2xl bg-white/[0.01]">
            <div className="text-[9px] font-black uppercase tracking-widest text-white/20">
              Displaying <span className="text-white">{users.length}</span> of <span className="text-white">{totalUsers}</span> Unit_Registry_Entries
            </div>
            <div className="flex items-center gap-4">
                <button
                  disabled={userPage === 1}
                  onClick={() => setUserPage(p => Math.max(1, p - 1))}
                  aria-label="Previous page"
                  className="p-3 bg-white/5 rounded-xl border border-white/10 text-white/40 hover:text-white disabled:opacity-20 transition-all"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-[10px] font-black text-white italic">PAGE_{userPage}</span>
                <button
                  disabled={userPage * USERS_PER_PAGE >= totalUsers}
                  onClick={() => setUserPage(p => p + 1)}
                  aria-label="Next page"
                  className="p-3 bg-white/5 rounded-xl border border-white/10 text-white/40 hover:text-white disabled:opacity-20 transition-all"
                >
                  <ChevronRight size={16} />
                </button>
            </div>
        </div>

        {activeUserDetail && (
          <UserDetailModal 
            user={activeUserDetail} 
            onClose={() => setActiveUserDetail(null)} 
          />
        )}
    </motion.div>
  );

  // ─── SECTION: CONFIG ──────────────────────────────────────────────────────

  const ConfigSection = () => (
    <motion.div variants={stagger.item} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="glass-panel p-8 border border-white/5 rounded-3xl bg-white/[0.01] space-y-8">
          <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-2xl bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] flex items-center justify-center">
                  <Settings size={18} />
              </div>
              <div>
                  <h2 className="text-sm font-black text-white uppercase italic tracking-tighter">GLOBAL_CORE_PARAMETERS</h2>
                  <p className="text-[8px] font-diag uppercase tracking-[0.2em] text-white/20">System_Wide_Behavior_Overrides</p>
              </div>
          </div>

          <div className="space-y-6">
              <ConfigInput 
                title="Default LLM Engine" 
                desc="Global default model for primary deliberations" 
                value={config.default_model || "gemini-2.0-flash"} 
                onSave={(v: string) => updateConfigValue("default_model", v)}
              />
              <ConfigInput 
                title="Max Agents Per Council" 
                desc="Concurrency ceiling for specialized bio-unit clustering" 
                value={config.max_agents || "5"} 
                onSave={(v: string) => updateConfigValue("max_agents", v)}
              />
              <ConfigInput 
                title="Maintenance Mode" 
                desc="Restrict access to root governance only" 
                value={config.maintenance_mode || "false"} 
                onSave={(v: string) => updateConfigValue("maintenance_mode", v)}
              />
          </div>

          <div className="pt-8 border-t border-white/5 space-y-6">
              <div className="flex items-center gap-3">
                <LayoutGrid size={14} className="text-[var(--accent-mint)]" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 italic">Feature_Flag_Toggles</span>
              </div>
              <div className="space-y-4">
                <FeatureToggle 
                  label="Advanced Reasoning (Beta)" 
                  active={config.feature_reasoning === "true"} 
                  onToggle={(v: boolean) => updateConfigValue("feature_reasoning", v ? "true" : "false")} 
                />
                <FeatureToggle 
                  label="Multi-Step Research" 
                  active={config.feature_research === "true"} 
                  onToggle={(v: boolean) => updateConfigValue("feature_research", v ? "true" : "false")} 
                />
              </div>
          </div>
      </div>

      <div className="glass-panel p-8 border border-white/5 rounded-3xl bg-white/[0.01]">
          <div className="flex items-center gap-4 mb-8">
              <div className="w-10 h-10 rounded-2xl bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] flex items-center justify-center">
                  <Terminal size={18} />
              </div>
              <div>
                  <h2 className="text-sm font-black text-white uppercase italic tracking-tighter">ENVIRONMENT_TELEMETRY</h2>
                  <p className="text-[8px] font-diag uppercase tracking-[0.2em] text-white/20">Active_Node_Status</p>
              </div>
          </div>
          <div className="space-y-4">
              <TelemetryRow label="Node_Version" value="v22.0.0" />
              <TelemetryRow label="Runtime" value="Bun_1.2.0" />
              <TelemetryRow label="Environment" value="Production" />
              <TelemetryRow label="Worker_Count" value="8_Cluster_Nodes" />
          </div>

          <div className="mt-12 p-8 bg-gradient-to-br from-white/[0.02] to-transparent border border-white/5 rounded-3xl">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] flex items-center justify-center">
                    <Lock size={18} />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-black text-white italic tracking-tighter uppercase">Vault_Encryption</h4>
                    <p className="text-[7px] font-diag text-white/20 uppercase tracking-widest mt-1">AES_256_GCM // Active</p>
                  </div>
                </div>
                <div className="px-3 py-1 bg-[var(--accent-mint)]/10 border border-[var(--accent-mint)]/20 rounded-lg text-[7px] font-black text-[var(--accent-mint)] tracking-widest uppercase">
                  SECURE
                </div>
              </div>

              <div className="p-4 bg-black/40 rounded-2xl border border-white/5 mb-8">
                <div className="flex justify-between text-[8px] font-mono text-white/20 mb-2 uppercase">
                  <span>Last_Rotation</span>
                  <span>Sentinel_Node_01</span>
                </div>
                <div className="text-[10px] font-mono text-white/60">
                  {new Date().toLocaleDateString()} // 04:20:00_UTC
                </div>
              </div>

              <button 
                onClick={rotateKeys}
                className="w-full py-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 text-[9px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all flex items-center justify-center gap-3"
              >
                  <RotateCcw size={14} />
                  FORCE_KEY_ROTATION
              </button>
          </div>
      </div>
    </motion.div>
  );

  function FeatureToggle({ label, active, onToggle }: any) {
    return (
      <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
        <span className="text-[10px] font-black uppercase tracking-widest text-white/60">{label}</span>
        <button 
          onClick={() => onToggle(!active)}
          className={`w-10 h-5 rounded-full relative transition-all duration-300 ${active ? 'bg-[var(--accent-mint)]' : 'bg-white/10'}`}
        >
          <motion.div 
            animate={{ x: active ? 22 : 2 }}
            className="w-4 h-4 bg-white rounded-full absolute top-0.5"
          />
        </button>
      </div>
    );
  }

  // ─── SECTION: GROUPS ─────────────────────────────────────────────────────

  const GroupsSection = () => (
    <motion.div variants={stagger.item} className="glass-panel overflow-hidden border border-white/5 rounded-3xl bg-white/[0.01]">
      <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-4">
          <div className="w-2 h-8 bg-[#a78bfa] rounded-full" />
          <div>
            <h2 className="text-lg font-black text-white italic tracking-tight">ORG_GROUP_REGISTRY</h2>
            <p className="text-[8px] font-diag uppercase tracking-[0.3em] text-white/20">Organizational_Clustering // Access_Tiers</p>
          </div>
        </div>
      </div>
      <div className="p-8">
        {groups.length > 0 ? (
          <div className="space-y-4">
            {groups.map((g: any) => (
              <div key={g.id} className="p-6 bg-black/40 border border-white/5 rounded-2xl flex items-center justify-between hover:bg-white/[0.02] transition-all">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-[#a78bfa]/10 text-[#a78bfa] flex items-center justify-center">
                    <LayoutGrid size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-black text-white italic tracking-tight">{g.name}</div>
                    {g.description && <div className="text-[9px] font-diag text-white/30 mt-1">{g.description}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[9px] font-diag text-white/20 uppercase tracking-widest">
                    {g.memberCount || 0} members
                  </span>
                  <span className="text-[8px] font-mono text-white/10">
                    {new Date(g.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 opacity-20">
            <LayoutGrid size={40} className="mb-4" />
            <span className="text-[10px] font-black uppercase tracking-widest italic">NO_GROUPS_CONFIGURED</span>
          </div>
        )}
      </div>
    </motion.div>
  );

  // ─── SECTION: SECURITY ────────────────────────────────────────────────────

  const SecuritySection = () => (
    <motion.div variants={stagger.item} className="space-y-10">
      <div className="glass-panel p-8 border border-white/5 rounded-3xl bg-white/[0.01] border-l-4 border-l-red-500/40 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 text-red-500/10">
              <Lock size={120} strokeWidth={0.5} />
          </div>
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="space-y-4">
                  <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-400 flex items-center justify-center">
                          <RotateCcw size={24} />
                      </div>
                      <div>
                          <h2 className="text-xl font-black text-white italic italic tracking-tight">CRYPTO_KEY_ROTATION_PROTOCOL</h2>
                          <p className="text-[9px] font-diag uppercase tracking-[0.3em] text-red-400/40 mt-1">Status: Level_5_Security_Clearance_Required</p>
                      </div>
                  </div>
                  <p className="text-xs text-white/40 max-w-lg font-serif">
                    Initiating key rotation will re-encrypt all stored secrets (API keys, credentials, memory configs) 
                    using a new 32-character master entropy string. This action is atomic and irreversible.
                  </p>
              </div>
              <button 
                onClick={rotateKeys}
                className="px-10 py-5 bg-red-500 text-black font-black text-[10px] uppercase tracking-[0.4em] rounded-2xl hover:scale-[1.05] active:scale-[0.95] transition-all shadow-[0_0_30px_rgba(239,68,68,0.2)]"
              >
                  INITIALIZE_ROTATION
              </button>
          </div>
      </div>

      <div className="glass-panel border border-white/5 rounded-3xl overflow-hidden bg-white/[0.01]">
          <div className="px-8 py-6 border-b border-white/5 flex flex-wrap items-center gap-6 bg-white/[0.02]">
              <div className="flex items-center gap-4 mr-auto">
                <History size={16} className="text-white/40" />
                <h3 className="text-xs font-black text-white uppercase italic tracking-tighter">AUDIT_PROTOCOL_LEDGER</h3>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">Type:</span>
                <select 
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-1.5 text-[8px] font-black text-white/60 focus:outline-none focus:border-[var(--accent-blue)]/40 hover:bg-black/60 transition-all appearance-none cursor-pointer"
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                >
                  <option value="">ALL_EVENTS</option>
                  <option value="user_suspended">SUSPEND</option>
                  <option value="user_activated">ACTIVATE</option>
                  <option value="role_assigned">ROLE_CHANGE</option>
                  <option value="config_update">CONFIG_UPDATE</option>
                  <option value="key_rotated">KEY_ROTATION</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">Window:</span>
                <input 
                  type="date"
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-1.5 text-[8px] font-black text-white/60 focus:outline-none focus:border-[var(--accent-blue)]/40 [color-scheme:dark]"
                  value={auditDateStart}
                  onChange={(e) => setAuditDateStart(e.target.value)}
                />
                <span className="text-[8px] font-black text-white/10 italic">TO</span>
                <input 
                  type="date"
                  className="bg-black/40 border border-white/10 rounded-xl px-4 py-1.5 text-[8px] font-black text-white/60 focus:outline-none focus:border-[var(--accent-blue)]/40 [color-scheme:dark]"
                  value={auditDateEnd}
                  onChange={(e) => setAuditDateEnd(e.target.value)}
                />
              </div>
          </div>
          <div className="overflow-x-auto overflow-y-auto max-h-[500px] scrollbar-custom">
              <table className="w-full text-left text-[10px]">
                  <thead className="bg-[#080808] sticky top-0 border-b border-white/5">
                      <tr>
                        <th className="px-8 py-4 font-diag uppercase tracking-widest text-white/20">Timestamp</th>
                        <th className="px-8 py-4 font-diag uppercase tracking-widest text-white/20">Admin</th>
                        <th className="px-8 py-4 font-diag uppercase tracking-widest text-white/20">Action</th>
                        <th className="px-8 py-4 font-diag uppercase tracking-widest text-white/20">Resource</th>
                        <th className="px-8 py-4 font-diag uppercase tracking-widest text-white/20">Status</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                      {auditLogs.map(log => (
                        <tr key={log.id} className="hover:bg-white/[0.01]">
                            <td className="px-8 py-4 font-mono text-white/30">{new Date(log.createdAt).toLocaleString()}</td>
                            <td className="px-8 py-4 text-white/60 font-black italic">{log.username}</td>
                            <td className="px-8 py-4"><span className="px-2 py-1 bg-white/5 rounded-lg border border-white/5 uppercase font-diag text-[9px] text-[var(--accent-blue)]">{log.actionType}</span></td>
                            <td className="px-8 py-4 font-mono text-white/40">{log.resourceType}:{log.resourceId}</td>
                            <td className="px-8 py-4">
                              <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase ${log.status === "success" ? "text-[var(--accent-mint)] bg-[var(--accent-mint)]/5" : "text-red-400 bg-red-400/5"}`}>
                                {log.status}
                              </span>
                            </td>
                        </tr>
                      ))}
                  </tbody>
              </table>
          </div>

          <div className="flex items-center justify-between mt-8 p-6 glass-panel border border-white/5 rounded-2xl bg-white/[0.01]">
              <div className="text-[9px] font-black uppercase tracking-widest text-white/20">
                Displaying <span className="text-white">{auditLogs.length}</span> of <span className="text-white">{totalAuditLogs}</span> Sentinel_Events
              </div>
              <div className="flex items-center gap-4">
                  <button
                    disabled={auditPage === 1}
                    onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                    aria-label="Previous page"
                    className="p-3 bg-white/5 rounded-xl border border-white/10 text-white/40 hover:text-white disabled:opacity-20 transition-all"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-[10px] font-black text-white italic">PAGE_{auditPage}</span>
                  <button
                    disabled={auditPage * AUDIT_PER_PAGE >= totalAuditLogs}
                    onClick={() => setAuditPage(p => p + 1)}
                    aria-label="Next page"
                    className="p-3 bg-white/5 rounded-xl border border-white/10 text-white/40 hover:text-white disabled:opacity-20 transition-all"
                  >
                    <ChevronRight size={16} />
                  </button>
              </div>
          </div>
      </div>
    </motion.div>
  );

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen bg-[#000000] overflow-hidden selection:bg-[var(--accent-mint)]/30 font-sans">
      <TechnicalGrid />
      
      <div className="relative z-10 h-full overflow-y-auto scrollbar-custom p-4 lg:p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-[1400px] mx-auto space-y-12 pb-24"
        >
          {/* Main Layout Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
            
            {/* Sidebar Navigation */}
            <div className="lg:col-span-1 space-y-8">
              <SectorHUD 
                sectorId="ROOT" 
                title="GOVERNANCE" 
                subtitle="Root Override Console"
                accentColor="var(--accent-mint)"
              />
              
              <div className="space-y-2">
                  <NavButton active={activeSection === "analytics"} icon={<Activity size={16} />} title="Analytics_Telemetry" desc="Usage data & inference metrics" onClick={() => setActiveSection("analytics")} />
                  <NavButton active={activeSection === "users"} icon={<Users size={16} />} title="Unit_Authorization" desc="Registry access control" onClick={() => setActiveSection("users")} />
                  <NavButton active={activeSection === "groups"} icon={<LayoutGrid size={16} />} title="Groups_Registry" desc="Organizational clustering" onClick={() => setActiveSection("groups")} />
                  <NavButton active={activeSection === "config"} icon={<Settings size={16} />} title="Global_Parameters" desc="Core system overrides" onClick={() => setActiveSection("config")} />
                  <NavButton active={activeSection === "providers"} icon={<Globe size={16} />} title="API_Oversight" desc="External provider integrity" onClick={() => setActiveSection("providers")} />
                  <NavButton active={activeSection === "security"} icon={<Shield size={16} />} title="Security_Audit" desc="Ledger & Key rotation" onClick={() => setActiveSection("security")} />
              </div>
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-3">
              <AnimatePresence mode="wait">
                  {activeSection === "analytics" && <AnalyticsSection key="analytics" />}
                  {activeSection === "users" && <UsersSection key="users" />}
                  {activeSection === "groups" && <GroupsSection key="groups" />}
                  {activeSection === "config" && <ConfigSection key="config" />}
                  {activeSection === "providers" && <ProvidersSection key="providers" providers={providers} onSetDefault={setProviderDefault} />}
                  {activeSection === "security" && <SecuritySection key="security" />}
              </AnimatePresence>
            </div>

          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ─── HELPER COMPONENTS ──────────────────────────────────────────────────────

function NavButton({ active, icon, title, desc, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-full group relative flex items-center gap-4 p-5 rounded-3xl transition-all duration-500 overflow-hidden
        ${active ? 'bg-white/[0.03] border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.5)]' : 'hover:bg-white/[0.01] border border-transparent'}
      `}
    >
      {active && <motion.div layoutId="nav-glow" className="absolute inset-0 bg-gradient-to-r from-[var(--accent-mint)]/5 to-transparent z-0" />}
      <div className={`relative z-10 p-3 rounded-2xl transition-all duration-500
        ${active ? 'bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'bg-white/5 text-white/20 group-hover:text-white/40'}
      `}>
        {icon}
      </div>
      <div className="relative z-10 text-left">
        <div className={`text-[11px] font-black italic tracking-tight transition-colors duration-500 ${active ? 'text-white' : 'text-white/40'}`}>
          {title}
        </div>
        <div className="text-[7px] font-diag uppercase tracking-widest text-white/20 mt-1">
          {desc}
        </div>
      </div>
      {active && <ChevronRight size={12} className="ml-auto text-[var(--accent-mint)]/40" />}
    </button>
  );
}

function MetricCard({ title, value, label, icon, color }: any) {
  return (
    <div className="surface-card p-6 border-l-2 bg-white/[0.01] relative transition-all hover:bg-white/[0.02]" style={{ borderColor: color }}>
        <div className="flex items-center gap-3 mb-4 overflow-hidden" style={{ color }}>
            {icon}
            <span className="text-[9px] font-black uppercase tracking-[0.3em] truncate">{title}</span>
        </div>
        <div className="text-3xl font-black text-white font-mono tracking-tighter">
            <AnimatedCounter value={parseInt(value.toString().replace(/,/g, ''))} />
            {value.toString().includes('%') && <span className="text-xs ml-0.5">%</span>}
        </div>
        <p className="text-[7px] font-diag uppercase text-white/20 mt-3 tracking-widest">{label}</p>
    </div>
  );
}

function ConfigInput({ title, desc, value, onSave }: any) {
  const [val, setVal] = useState(value);
  useEffect(() => setVal(value), [value]);

  return (
    <div className="space-y-2 group">
        <div className="flex justify-between items-end">
          <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20 ml-1 group-hover:text-white/40 transition-colors">{title}</label>
          <button 
            onClick={() => onSave(val)}
            className="text-[8px] font-bold text-[var(--accent-mint)] opacity-0 group-hover:opacity-100 transition-all hover:underline"
          >
            SAVE_MOD
          </button>
        </div>
        <input
            className="w-full bg-black/60 border border-white/5 rounded-2xl px-6 py-4 text-xs font-diag tracking-widest text-[#a78bfa] focus:outline-none focus:border-[var(--accent-mint)]/40 transition-all"
            value={val}
            onChange={(e) => setVal(e.target.value)}
        />
        <p className="text-[7px] italic text-white/10 ml-1">{desc}</p>
    </div>
  );
}

function TelemetryRow({ label, value }: any) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.02] last:border-0">
      <span className="text-[9px] font-diag text-white/20 uppercase tracking-widest">{label}</span>
      <span className="text-[10px] font-mono text-[var(--accent-blue)]">{value}</span>
    </div>
  );
}

function ProvidersSection({ providers, onSetDefault }: { providers: any[], onSetDefault: (id: number) => void }) {
  return (
    <motion.div variants={stagger.item} className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {providers.map((p: any) => (
        <div key={p.id} className="surface-card p-6 border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] transition-all group relative overflow-hidden">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-white/5 flex items-center justify-center text-white/60">
                    <Globe size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white tracking-tight">{p.name}</h3>
                    <p className="text-[8px] font-mono text-white/20 truncate w-40">{p.baseUrl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                    {p.isDefault && (
                        <div className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[7px] font-black uppercase tracking-widest rounded-lg">
                            GLOBAL_DEFAULT
                        </div>
                    )}
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-[var(--accent-mint)]/5 border border-[var(--accent-mint)]/10 rounded-full">
                      <div className="w-1 h-1 bg-[var(--accent-mint)] rounded-full animate-pulse" />
                      <span className="text-[8px] font-black uppercase text-[var(--accent-mint)] tracking-tighter">OPERATIONAL</span>
                    </div>
                </div>
            </div>
            
            <div className="flex justify-between items-center text-[9px] font-diag text-white/20 uppercase tracking-widest mb-6">
              <span>Latency: <span className="text-[var(--accent-mint)]/40 font-mono">24ms</span></span>
              <span>Uptime: <span className="text-[var(--accent-mint)]/40 font-mono">100%</span></span>
            </div>

            {!p.isDefault && (
                <button 
                  onClick={() => onSetDefault(p.id)}
                  className="w-full py-2.5 bg-white/5 border border-white/10 rounded-xl text-[8px] font-black uppercase tracking-[0.2em] text-white/40 hover:bg-white/10 hover:text-white transition-all"
                >
                    SET_AS_GLOBAL_DEFAULT
                </button>
            )}
        </div>
      ))}
    </motion.div>
  );
}
