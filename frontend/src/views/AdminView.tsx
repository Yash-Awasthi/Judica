import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Users, Shield, Plus, Trash2, MessageSquare, Terminal, Cpu, Search } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter } from "../components/AnimatedCounter";
import { SectorHUD } from "../components/SectorHUD";
import { TechnicalGrid } from "../components/TechnicalGrid";

interface UserRow {
  id: number;
  email: string;
  username: string;
  role: string;
  createdAt: string;
}

interface Group {
  id: string;
  name: string;
  members: Array<{ user: { id: number; email: string; username: string } }>;
}

interface Stats {
  totalUsers: number;
  totalConversations: number;
  totalMessages: number;
}

const stagger = {
  container: { animate: { transition: { staggerChildren: 0.08 } } },
  item: { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3 } } },
};

export function AdminView() {
  const { fetchWithAuth } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/users");
      if (res.ok) { const d = await res.json(); setUsers(d.users); }
    } catch (err) { console.error("Failed to load users", err); }
  }, [fetchWithAuth]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/groups");
      if (res.ok) { const d = await res.json(); setGroups(d.groups); }
    } catch (err) { console.error("Failed to load groups", err); }
  }, [fetchWithAuth]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/stats");
      if (res.ok) { const d = await res.json(); setStats(d); }
    } catch (err) { console.error("Failed to load stats", err); }
  }, [fetchWithAuth]);

  useEffect(() => { loadUsers(); loadGroups(); loadStats(); }, [loadUsers, loadGroups, loadStats]);

  const changeRole = async (userId: number, role: string) => {
    try {
      await fetchWithAuth(`/api/admin/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      loadUsers();
    } catch (err) { console.error("Failed to change role", err); }
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await fetchWithAuth("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGroupName.trim() }),
      });
      setNewGroupName("");
      loadGroups();
    } catch (err) { console.error("Failed to create group", err); }
  };

  const addMember = async (groupId: string) => {
    if (!addUserId) return;
    try {
      await fetchWithAuth(`/api/admin/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: addUserId }),
      });
      setAddUserId("");
      loadGroups();
    } catch (err) { console.error("Failed to add member", err); }
  };

  const removeMember = async (groupId: string, userId: number) => {
    try {
      await fetchWithAuth(`/api/admin/groups/${groupId}/members/${userId}`, { method: "DELETE" });
      loadGroups();
    } catch (err) { console.error("Failed to remove member", err); }
  };

  return (
    <div className="relative min-h-screen bg-[#000000] overflow-hidden selection:bg-[var(--accent-mint)]/30 font-sans">
      <TechnicalGrid />
      
      <div className="relative z-10 h-full overflow-y-auto scrollbar-custom p-4 lg:p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-[1400px] mx-auto space-y-12 pb-24"
        >
          {/* Sector Header */}
          <SectorHUD 
            sectorId="SYS-AD" 
            title="Root_Governance_Terminal" 
            subtitle="Global administrative override // Macro-system telemetry"
            accentColor="var(--accent-mint)"
            telemetry={[
              { label: "UPTIME", value: "99.98%", status: "optimal" },
              { label: "DB_LAT", value: "12ms", status: "online" },
              { label: "UPLINK", value: "SECURE", status: "optimal" }
            ]}
          />

        {/* Macro Telemetry Board */}
        {stats && (
          <motion.div variants={stagger.item} className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="surface-card p-6 border-l-2 border-[var(--accent-mint)] bg-white/[0.01]">
                <div className="flex items-center gap-3 text-[var(--accent-mint)] mb-4">
                    <Users size={18} />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em]">Authorized Units</span>
                </div>
                <div className="text-4xl font-black text-white font-mono tracking-tighter">
                    <AnimatedCounter value={stats.totalUsers} />
                </div>
                <p className="text-[8px] font-diag uppercase text-white/20 mt-3 tracking-widest">Active_Registry_Count</p>
            </div>
            <div className="surface-card p-6 border-l-2 border-[var(--accent-blue)] bg-white/[0.01]">
                <div className="flex items-center gap-3 text-[var(--accent-blue)] mb-4">
                    <MessageSquare size={18} />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em]">Trace Records</span>
                </div>
                <div className="text-4xl font-black text-white font-mono tracking-tighter">
                    <AnimatedCounter value={stats.totalConversations} />
                </div>
                <p className="text-[8px] font-diag uppercase text-white/20 mt-3 tracking-widest">Total_Session_History</p>
            </div>
            <div className="surface-card p-6 border-l-2 border-[var(--accent-gold)] bg-white/[0.01]">
                <div className="flex items-center gap-3 text-[var(--accent-gold)] mb-4">
                    <Terminal size={18} />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em]">Inference Flow</span>
                </div>
                <div className="text-4xl font-black text-white font-mono tracking-tighter">
                    <AnimatedCounter value={stats.totalMessages} />
                </div>
                <p className="text-[8px] font-diag uppercase text-white/20 mt-3 tracking-widest">Global_Message_Vol</p>
            </div>
            <div className="surface-card p-6 border-l-2 border-[#a78bfa] bg-white/[0.01]">
                <div className="flex items-center gap-3 text-[#a78bfa] mb-4">
                    <Cpu size={18} />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em]">System Load</span>
                </div>
                <div className="text-4xl font-black text-white font-mono tracking-tighter">
                    24<span className="text-xs ml-1">%</span>
                </div>
                <p className="text-[8px] font-diag uppercase text-white/20 mt-3 tracking-widest">Neural_Forge_Pressure</p>
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
            {/* Left Col: Master Control Group */}
            <div className="xl:col-span-2 space-y-10">
                {/* Registrants Table */}
                <motion.div variants={stagger.item} className="glass-panel overflow-hidden border border-white/5 rounded-3xl">
                    <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                        <div className="flex items-center gap-4">
                            <div className="w-2 h-8 bg-[var(--accent-mint)] rounded-full" />
                            <div>
                                <h2 className="text-lg font-black text-white italic tracking-tight">BIO_UNIT_AUTHORIZATION</h2>
                                <p className="text-[8px] font-diag uppercase tracking-[0.3em] text-white/20">Access_Control_List</p>
                            </div>
                        </div>
                        <div className="relative group">
                            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--accent-mint)] opacity-40 group-focus-within:opacity-100 transition-all" />
                            <input className="bg-black/40 border border-white/10 rounded-2xl py-2 pl-12 pr-6 text-[10px] font-diag uppercase tracking-widest text-white focus:outline-none focus:border-[var(--accent-mint)]/40 w-64 transition-all" placeholder="FILTER_UNITS..." />
                        </div>
                    </div>
                    
                    <div className="overflow-x-auto overflow-y-auto max-h-[600px] scrollbar-custom">
                        <table className="w-full text-left">
                            <thead className="sticky top-0 bg-[#080808] z-20">
                                <tr>
                                    <th className="px-8 py-5 text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag">Designation</th>
                                    <th className="px-8 py-5 text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag">Digital_Sig</th>
                                    <th className="px-8 py-5 text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag">Clearance</th>
                                    <th className="px-8 py-5 text-[8px] font-black text-white/20 uppercase tracking-[0.4em] font-diag">Sync_Date</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {users.map((u) => (
                                    <tr key={u.id} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="px-8 py-5">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-white/10 to-transparent flex items-center justify-center text-white/40 text-xs font-black group-hover:from-[var(--accent-mint)] group-hover:to-emerald-600 group-hover:text-black transition-all">
                                                    {u.username[0].toUpperCase()}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-white tracking-tight">{u.username}</span>
                                                    <span className="text-[9px] font-diag text-white/20 uppercase tracking-widest">ID: {u.id}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5 text-[11px] font-mono text-white/40 group-hover:text-white/80 transition-colors uppercase tracking-tight">{u.email}</td>
                                        <td className="px-8 py-5">
                                            <div className="relative group/select">
                                                <select
                                                    className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[var(--accent-mint)] focus:outline-none focus:border-[var(--accent-mint)]/40 hover:bg-black/80 transition-all appearance-none cursor-pointer"
                                                    value={u.role}
                                                    onChange={(e) => changeRole(u.id, e.target.value)}
                                                >
                                                    <option value="admin">LVL_4_ROOT</option>
                                                    <option value="member">LVL_2_CORE</option>
                                                    <option value="viewer">LVL_1_SENSE</option>
                                                </select>
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-20 group-hover/select:opacity-100 transition-opacity">
                                                    <Shield size={10} className="text-[var(--accent-mint)]" />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-5">
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] font-mono text-white/30 uppercase tracking-widest">{new Date(u.createdAt).toLocaleDateString()}</span>
                                                <span className="text-[7px] font-diag text-[var(--accent-mint)]/40 uppercase tracking-[0.2em] mt-1 italic">Verified_Unit</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </motion.div>
            </div>

            {/* Right Col: Units & Protocols */}
            <div className="space-y-10">
                {/* Create Group */}
                <motion.div variants={stagger.item} className="glass-panel p-8 border border-white/5 rounded-3xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--accent-gold)] opacity-[0.02] blur-3xl rounded-full" />
                    <div className="flex items-center gap-4 mb-8">
                        <div className="w-10 h-10 rounded-2xl bg-[var(--accent-gold)]/10 text-[var(--accent-gold)] flex items-center justify-center shadow-[0_0_20px_rgba(250,204,21,0.1)]">
                            <Plus size={20} />
                        </div>
                        <div>
                            <h2 className="text-sm font-black text-white uppercase italic tracking-tighter">INIT_COMMAND_UNIT</h2>
                            <p className="text-[8px] font-diag uppercase tracking-[0.2em] text-white/20">Operational_Clustering</p>
                        </div>
                    </div>
                    
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <label className="text-[8px] font-black uppercase tracking-[0.3em] text-white/20 ml-1">Unit Designation</label>
                            <input
                                className="w-full bg-black/60 border border-white/10 rounded-2xl px-6 py-4 text-xs font-diag uppercase tracking-widest text-white placeholder:text-white/5 focus:outline-none focus:border-[var(--accent-gold)]/40 transition-all font-diag"
                                placeholder="ALPHA_CLUSTER..."
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                            />
                        </div>
                        <button
                            onClick={createGroup}
                            disabled={!newGroupName.trim()}
                            className="w-full py-4 text-[10px] font-black uppercase tracking-[0.3em] bg-[var(--accent-gold)] text-black rounded-2xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-[var(--accent-gold)]/10 disabled:opacity-20 disabled:grayscale"
                        >
                            COMMIT_AUTHORIZATION
                        </button>
                    </div>
                </motion.div>

                {/* Groups Registry */}
                <motion.div variants={stagger.item} className="glass-panel border border-white/5 rounded-3xl overflow-hidden flex flex-col h-[500px]">
                    <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                        <h2 className="text-xs font-black text-white uppercase italic tracking-tighter">OPERATIONAL_CLUSTERS</h2>
                        <span className="text-[10px] font-mono text-[var(--accent-mint)] shadow-glow-sm">{groups.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto scrollbar-custom p-6 space-y-4">
                        {groups.map((g) => (
                            <div key={g.id} className="surface-card p-5 border border-white/5 bg-white/[0.01] hover:bg-white/[0.03] transition-all group/unit">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex flex-col">
                                        <span className="text-[12px] font-black text-white italic tracking-tight">{g.name}</span>
                                        <span className="text-[8px] font-diag text-white/20 uppercase tracking-widest mt-1">SIG: 0x{g.id.substring(0, 4)}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            className="w-24 bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-[9px] font-diag uppercase tracking-widest text-white focus:outline-none focus:border-[var(--accent-mint)]/40"
                                            placeholder="BIO_ID"
                                            value={selectedGroup === g.id ? addUserId : ""}
                                            onChange={(e) => { setSelectedGroup(g.id); setAddUserId(e.target.value); }}
                                        />
                                        <button onClick={() => addMember(g.id)} className="p-1.5 bg-[var(--accent-mint)]/10 text-[var(--accent-mint)] border border-[var(--accent-mint)]/20 rounded-lg hover:bg-[var(--accent-mint)]/20 transition-all"><Plus size={14} /></button>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {g.members.map((m) => (
                                        <div key={m.user.id} className="flex items-center gap-2 bg-white/[0.05] border border-white/10 px-3 py-1.5 rounded-xl text-[10px] font-medium text-white/60 hover:text-white hover:border-[var(--accent-mint)]/40 transition-all group/p">
                                            <span className="font-mono">{m.user.username}</span>
                                            <button onClick={() => removeMember(g.id, m.user.id)} className="text-white/20 hover:text-red-400 transition-colors"><Trash2 size={10} /></button>
                                        </div>
                                    ))}
                                    {g.members.length === 0 && <span className="text-[8px] font-diag uppercase text-white/10 tracking-widest italic pt-2">NO_UNIT_ASSIGNED</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>
            </div>
        </div>

        </motion.div>
      </div>
    </div>
  );
}
