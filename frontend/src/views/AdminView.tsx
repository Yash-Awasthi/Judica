import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Users, Shield, BarChart3, Plus, Trash2, MessageSquare } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { AnimatedCounter } from "../components/AnimatedCounter";

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
    <div className="h-full overflow-y-auto scrollbar-custom p-6">
      <motion.div
        variants={stagger.container}
        initial="initial"
        animate="animate"
        className="max-w-6xl mx-auto space-y-6"
      >
        <motion.div variants={stagger.item}>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Admin Panel</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Manage users, groups, and platform settings</p>
        </motion.div>

        {/* Stats */}
        {stats && (
          <motion.div variants={stagger.item} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { icon: <Users size={18} />, label: "Users", value: stats.totalUsers, color: "var(--accent-blue)" },
              { icon: <BarChart3 size={18} />, label: "Conversations", value: stats.totalConversations, color: "var(--accent-mint)" },
              { icon: <MessageSquare size={18} />, label: "Messages", value: stats.totalMessages, color: "#a78bfa" },
            ].map(({ icon, label, value, color }) => (
              <div key={label} className="surface-card p-5">
                <div className="flex items-center gap-2 mb-2" style={{ color }}>
                  {icon}
                  <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">{label}</span>
                </div>
                <div className="text-3xl font-bold text-[var(--text-primary)]">
                  <AnimatedCounter value={value} />
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* Users Table */}
        <motion.div variants={stagger.item} className="surface-card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center gap-2">
            <Shield size={16} className="text-[var(--accent-mint)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Users</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--glass-bg)]">
                  <th className="text-left px-5 py-3 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Email</th>
                  <th className="text-left px-5 py-3 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Username</th>
                  <th className="text-left px-5 py-3 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Role</th>
                  <th className="text-left px-5 py-3 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--glass-bg-hover)] transition-colors">
                    <td className="px-5 py-3 text-[var(--text-primary)]">{u.email}</td>
                    <td className="px-5 py-3 text-[var(--text-secondary)]">{u.username}</td>
                    <td className="px-5 py-3">
                      <select
                        className="input-base text-xs py-1 px-2"
                        value={u.role}
                        onChange={(e) => changeRole(u.id, e.target.value)}
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-muted)] text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Groups */}
        <motion.div variants={stagger.item} className="surface-card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Groups</h2>
            <div className="flex gap-2">
              <input
                className="input-base text-xs py-1.5 w-40"
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
              />
              <button
                onClick={createGroup}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold btn-pill-primary"
              >
                <Plus size={14} /> Create
              </button>
            </div>
          </div>
          <div className="p-5 space-y-3">
            {groups.length === 0 && (
              <p className="text-[var(--text-muted)] text-xs text-center py-4 italic">No groups created yet</p>
            )}
            {groups.map((g) => (
              <div key={g.id} className="glass-panel rounded-card p-4">
                <div className="text-sm font-semibold text-[var(--text-primary)] mb-2">{g.name}</div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {g.members.map((m) => (
                    <span key={m.user.id} className="flex items-center gap-1.5 bg-[var(--glass-bg)] border border-[var(--glass-border)] px-2.5 py-1 rounded-pill text-xs text-[var(--text-secondary)]">
                      {m.user.email}
                      <button onClick={() => removeMember(g.id, m.user.id)} className="text-[var(--text-muted)] hover:text-red-400 transition-colors">
                        <Trash2 size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    className="input-base text-xs py-1 w-32"
                    placeholder="User ID"
                    value={selectedGroup === g.id ? addUserId : ""}
                    onChange={(e) => { setSelectedGroup(g.id); setAddUserId(e.target.value); }}
                  />
                  <button
                    onClick={() => addMember(g.id)}
                    className="px-3 py-1 text-xs font-semibold rounded-button bg-[rgba(110,231,183,0.08)] text-[var(--accent-mint)] border border-[rgba(110,231,183,0.15)] hover:bg-[rgba(110,231,183,0.15)] transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
