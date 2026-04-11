import { useState, useEffect, useCallback } from "react";
import { Users, Shield, BarChart3, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

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

export function AdminView() {
  const { fetchWithAuth } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const res = await fetchWithAuth("/api/admin/users");
    if (res.ok) { const d = await res.json(); setUsers(d.users); }
  }, [fetchWithAuth]);

  const loadGroups = useCallback(async () => {
    const res = await fetchWithAuth("/api/admin/groups");
    if (res.ok) { const d = await res.json(); setGroups(d.groups); }
  }, [fetchWithAuth]);

  const loadStats = useCallback(async () => {
    const res = await fetchWithAuth("/api/admin/stats");
    if (res.ok) { const d = await res.json(); setStats(d); }
  }, [fetchWithAuth]);

  useEffect(() => { loadUsers(); loadGroups(); loadStats(); }, [loadUsers, loadGroups, loadStats]);

  const changeRole = async (userId: number, role: string) => {
    await fetchWithAuth(`/api/admin/users/${userId}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    loadUsers();
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    await fetchWithAuth("/api/admin/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newGroupName.trim() }),
    });
    setNewGroupName("");
    loadGroups();
  };

  const addMember = async (groupId: string) => {
    if (!addUserId) return;
    await fetchWithAuth(`/api/admin/groups/${groupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: addUserId }),
    });
    setAddUserId("");
    loadGroups();
  };

  const removeMember = async (groupId: string, userId: number) => {
    await fetchWithAuth(`/api/admin/groups/${groupId}/members/${userId}`, { method: "DELETE" });
    loadGroups();
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Admin Panel</h1>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-1"><Users size={16} /> Users</div>
            <div className="text-3xl font-bold text-blue-600">{stats.totalUsers}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-1"><BarChart3 size={16} /> Conversations</div>
            <div className="text-3xl font-bold text-green-600">{stats.totalConversations}</div>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center gap-2 text-gray-500 mb-1"><BarChart3 size={16} /> Messages</div>
            <div className="text-3xl font-bold text-purple-600">{stats.totalMessages}</div>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Shield size={16} className="text-gray-500" />
          <h2 className="font-semibold text-gray-700">Users</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2 text-gray-500 font-medium">Email</th>
              <th className="text-left px-4 py-2 text-gray-500 font-medium">Username</th>
              <th className="text-left px-4 py-2 text-gray-500 font-medium">Role</th>
              <th className="text-left px-4 py-2 text-gray-500 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.username}</td>
                <td className="px-4 py-2">
                  <select
                    className="px-2 py-1 border rounded text-sm"
                    value={u.role}
                    onChange={(e) => changeRole(u.id, e.target.value)}
                  >
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                  </select>
                </td>
                <td className="px-4 py-2 text-gray-400">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Groups */}
      <div className="bg-white rounded-lg border">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">Groups</h2>
          <div className="flex gap-2">
            <input className="px-2 py-1 border rounded text-sm" placeholder="Group name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
            <button onClick={createGroup} className="flex items-center gap-1 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"><Plus size={14} /> Create</button>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {groups.map((g) => (
            <div key={g.id} className="border rounded p-3">
              <div className="font-medium text-gray-700 mb-2">{g.name}</div>
              <div className="flex flex-wrap gap-2 mb-2">
                {g.members.map((m) => (
                  <span key={m.user.id} className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded text-xs">
                    {m.user.email}
                    <button onClick={() => removeMember(g.id, m.user.id)} className="text-red-400 hover:text-red-600"><Trash2 size={10} /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input className="px-2 py-1 border rounded text-xs" placeholder="User ID" value={selectedGroup === g.id ? addUserId : ""} onChange={(e) => { setSelectedGroup(g.id); setAddUserId(e.target.value); }} />
                <button onClick={() => addMember(g.id)} className="px-2 py-1 text-xs bg-green-600 text-white rounded">Add</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
