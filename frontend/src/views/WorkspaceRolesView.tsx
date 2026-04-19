import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Download, Shield, ChevronDown } from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface Member {
  id: number;
  username: string;
  email: string;
  role: string;
  createdAt: string;
}

const ROLE_ORDER = ["owner", "admin", "member", "viewer"];

const ROLE_COLORS: Record<string, string> = {
  owner: "text-[var(--accent-gold)] bg-[var(--accent-gold)]/10 border-[var(--accent-gold)]/30",
  admin: "text-[var(--accent-coral)] bg-[var(--accent-coral)]/10 border-[var(--accent-coral)]/30",
  member: "text-[var(--accent-mint)] bg-[var(--accent-mint)]/10 border-[var(--accent-mint)]/30",
  viewer: "text-[var(--text-muted)] bg-[var(--glass-bg)] border-[var(--border-subtle)]",
};

function RoleSelect({
  memberId,
  current,
  selfId,
  onChange,
}: {
  memberId: number;
  current: string;
  selfId?: number;
  onChange: (id: number, role: string) => void;
}) {
  const isSelf = memberId === selfId;

  return (
    <div className="relative inline-flex items-center">
      <select
        value={current}
        disabled={isSelf}
        onChange={(e) => onChange(memberId, e.target.value)}
        aria-label="Change role"
        className={`
          appearance-none pr-7 pl-3 py-1 text-xs rounded-full border font-medium transition-colors cursor-pointer
          disabled:cursor-not-allowed disabled:opacity-60
          bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--accent-mint)]
          ${ROLE_COLORS[current] || ROLE_COLORS.member}
        `}
      >
        {ROLE_ORDER.map((r) => (
          <option key={r} value={r} className="bg-[var(--bg-surface-2)] text-[var(--text-primary)]">
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </option>
        ))}
      </select>
      <ChevronDown size={11} className="absolute right-2 pointer-events-none opacity-60" />
    </div>
  );
}

export function WorkspaceRolesView() {
  const { fetchWithAuth, user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [selfId, setSelfId] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, meRes] = await Promise.all([
        fetchWithAuth("/api/admin/workspace/members"),
        fetchWithAuth("/api/auth/me").catch(() => null),
      ]);
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members);
      }
      if (meRes?.ok) {
        const me = await meRes.json();
        setSelfId(me.id);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { load(); }, [load]);

  const handleRoleChange = async (id: number, role: string) => {
    setSaving(id);
    try {
      const res = await fetchWithAuth(`/api/admin/workspace/members/${id}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)));
      }
    } finally {
      setSaving(null);
    }
  };

  const handleExportAudit = async () => {
    const res = await fetchWithAuth("/api/admin/audit/export");
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-export-${new Date().toISOString().split("T")[0]}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const grouped = ROLE_ORDER.reduce<Record<string, Member[]>>((acc, r) => {
    acc[r] = members.filter((m) => m.role === r);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto scrollbar-custom p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Shield size={20} className="text-[var(--accent-mint)]" aria-hidden="true" />
            Workspace Roles
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Manage member access levels — Owner &gt; Admin &gt; Member &gt; Viewer
          </p>
        </div>
        <button
          onClick={handleExportAudit}
          className="btn-pill border border-[var(--border-medium)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
          title="Download full audit log as JSONL"
        >
          <Download size={14} aria-hidden="true" />
          Export Audit Log
        </button>
      </div>

      {/* Role legend */}
      <div className="glass-panel p-4">
        <p className="text-xs text-[var(--text-muted)] mb-3 font-medium uppercase tracking-wider">
          Permission Matrix
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {[
            { role: "owner", perms: "Full control, billing, delete workspace" },
            { role: "admin", perms: "Manage members, export data, all features" },
            { role: "member", perms: "Create councils, upload files, full chat" },
            { role: "viewer", perms: "Read-only access to shared deliberations" },
          ].map(({ role, perms }) => (
            <div key={role} className="space-y-1">
              <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${ROLE_COLORS[role]}`}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </span>
              <p className="text-[var(--text-muted)] leading-snug">{perms}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Members table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="surface-card h-14 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm" role="table" aria-label="Workspace members">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="text-left px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Member</th>
                <th className="text-left px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Email</th>
                <th className="text-left px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Joined</th>
                <th className="text-right px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <motion.tr
                  key={m.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--glass-bg)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-black shrink-0"
                        style={{ background: ROLE_COLORS[m.role]?.includes("gold") ? "var(--accent-gold)" : "var(--accent-mint)" }}
                      >
                        {m.username.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="font-medium text-[var(--text-primary)]">
                        {m.username}
                        {m.id === selfId && (
                          <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">(you)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{m.email}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {saving === m.id ? (
                      <span className="inline-block w-4 h-4 border-2 border-[var(--accent-mint)] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <RoleSelect
                        memberId={m.id}
                        current={m.role}
                        selfId={selfId}
                        onChange={handleRoleChange}
                      />
                    )}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
