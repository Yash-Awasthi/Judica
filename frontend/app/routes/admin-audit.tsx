import { useState } from "react";
import { Card, CardContent } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Shield, Search } from "lucide-react";

const mockAuditEntries = [
  { id: "1", timestamp: "2026-04-22 14:32:01", user: "alice@example.com", action: "user.login", resource: "auth/session", ip: "192.168.1.42" },
  { id: "2", timestamp: "2026-04-22 14:28:15", user: "bob@example.com", action: "config.update", resource: "system/rate_limit_max", ip: "10.0.0.15" },
  { id: "3", timestamp: "2026-04-22 14:15:33", user: "alice@example.com", action: "chat.create", resource: "chat/session-847", ip: "192.168.1.42" },
  { id: "4", timestamp: "2026-04-22 13:55:10", user: "carol@example.com", action: "kb.upload", resource: "kb/eng-docs/file-291", ip: "172.16.0.8" },
  { id: "5", timestamp: "2026-04-22 13:42:00", user: "david@example.com", action: "workflow.run", resource: "workflow/code-review", ip: "10.0.0.22" },
  { id: "6", timestamp: "2026-04-22 13:30:45", user: "elena@example.com", action: "user.role_change", resource: "user/frank-weber", ip: "192.168.1.100" },
  { id: "7", timestamp: "2026-04-22 12:58:22", user: "bob@example.com", action: "memory.compact", resource: "memory/local", ip: "10.0.0.15" },
  { id: "8", timestamp: "2026-04-22 12:45:11", user: "grace@example.com", action: "prompt.update", resource: "prompt/code-review-v7", ip: "172.16.0.3" },
  { id: "9", timestamp: "2026-04-22 12:30:00", user: "alice@example.com", action: "chat.delete", resource: "chat/session-812", ip: "192.168.1.42" },
  { id: "10", timestamp: "2026-04-22 11:15:33", user: "hassan@example.com", action: "user.login", resource: "auth/session", ip: "10.0.0.44" },
  { id: "11", timestamp: "2026-04-22 10:48:19", user: "david@example.com", action: "workflow.create", resource: "workflow/security-audit", ip: "10.0.0.22" },
  { id: "12", timestamp: "2026-04-22 09:22:07", user: "elena@example.com", action: "config.update", resource: "system/maintenance_mode", ip: "192.168.1.100" },
];

const actionColors: Record<string, string> = {
  "user.login": "text-green-400",
  "user.role_change": "text-amber-400",
  "config.update": "text-purple-400",
  "chat.create": "text-blue-400",
  "chat.delete": "text-red-400",
  "kb.upload": "text-cyan-400",
  "workflow.run": "text-emerald-400",
  "workflow.create": "text-emerald-400",
  "memory.compact": "text-orange-400",
  "prompt.update": "text-indigo-400",
};

export default function AdminAuditPage() {
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = mockAuditEntries.filter((entry) => {
    if (search) {
      const q = search.toLowerCase();
      return (
        entry.user.toLowerCase().includes(q) ||
        entry.action.toLowerCase().includes(q) ||
        entry.resource.toLowerCase().includes(q) ||
        entry.ip.includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Audit Log</h1>
            <p className="text-sm text-muted-foreground">
              Review all system events, user actions, and configuration changes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by user, action, resource, or IP..."
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>From:</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36 h-7"
            />
            <span>To:</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-36 h-7"
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Timestamp</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">User</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Action</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Resource</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <code className="text-xs font-mono text-muted-foreground">
                          {entry.timestamp}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-sm">{entry.user}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-mono ${actionColors[entry.action] ?? ""}`}
                        >
                          {entry.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs font-mono text-muted-foreground">
                          {entry.resource}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs font-mono text-muted-foreground">
                          {entry.ip}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
