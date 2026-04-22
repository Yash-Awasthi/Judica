import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  Shield,
  Users,
  Search,
  Plus,
  MoreHorizontal,
  Trash2,
  Server,
  Activity,
  MessageSquare,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "~/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { Label } from "~/components/ui/label";
import { useAuth } from "~/context/AuthContext";
import { api } from "~/lib/api";

// ── Types ──

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: "admin" | "member" | "viewer";
  createdAt: string;
  lastActive: string;
  isActive: boolean;
}

interface Provider {
  id: string;
  name: string;
  type: string;
  model: string;
  isActive: boolean;
  endpoint: string;
}

interface SystemStats {
  totalUsers: number;
  activeUsers: number;
  totalConversations: number;
  avgResponseTime: number;
}

export default function AdminPage() {
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  // Providers state
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    name: "",
    type: "openai",
    apiKey: "",
    model: "",
    endpoint: "",
  });

  // Stats state
  const [stats, setStats] = useState<SystemStats | null>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<AdminUser[]>("/admin/users").catch(() => []),
      api.get<Provider[]>("/providers").catch(() => []),
      api.get<SystemStats>("/admin/stats").catch(() => null),
    ]).then(([u, p, s]) => {
      setUsers(Array.isArray(u) ? u : []);
      setProviders(Array.isArray(p) ? p : []);
      setStats(s);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (loading || !containerRef.current) return;
    const cards = containerRef.current.querySelectorAll("[data-animate-card]");
    const ctx = gsap.context(() => {
      gsap.from(cards, { opacity: 0, y: 20, duration: 0.5, stagger: 0.08, ease: "power2.out" });
    });
    return () => ctx.revert();
  }, [loading]);

  // ── User actions ──

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await api.put(`/admin/users/${userId}`, { role });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: role as AdminUser["role"] } : u)));
    } catch {}
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    try {
      await api.put(`/admin/users/${userId}`, { isActive });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isActive } : u)));
    } catch {}
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    try {
      await api.del(`/admin/users/${deleteTarget.id}`);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
    } catch {}
    setDeleteTarget(null);
  };

  // ── Provider actions ──

  const handleAddProvider = async () => {
    try {
      const created = await api.post<Provider>("/providers", newProvider);
      setProviders((prev) => [...prev, created]);
      setShowAddProvider(false);
      setNewProvider({ name: "", type: "openai", apiKey: "", model: "", endpoint: "" });
    } catch {}
  };

  const handleToggleProvider = async (providerId: string, isActive: boolean) => {
    try {
      await api.put(`/providers/${providerId}`, { isActive });
      setProviders((prev) => prev.map((p) => (p.id === providerId ? { ...p, isActive } : p)));
    } catch {}
  };

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading admin panel...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" ref={containerRef}>
      <div data-animate-card>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-chart-1" />
          <h1 className="text-2xl font-semibold tracking-tight">Admin Panel</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">Manage users, providers, and system settings.</p>
      </div>

      <Tabs defaultValue="users" data-animate-card>
        <TabsList>
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Users
          </TabsTrigger>
          <TabsTrigger value="providers" className="gap-1.5">
            <Server className="h-3.5 w-3.5" />
            Providers
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            System Stats
          </TabsTrigger>
        </TabsList>

        {/* ── Users Tab ── */}
        <TabsContent value="users" className="space-y-4 mt-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <Card className="bg-card/60 backdrop-blur-sm border-border/50">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No users found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.username}</TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            onValueChange={(val) => handleRoleChange(u.id, val)}
                          >
                            <SelectTrigger className="w-28 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={u.isActive}
                              onCheckedChange={(checked) => handleToggleActive(u.id, checked)}
                            />
                            <span className="text-xs text-muted-foreground">
                              {u.isActive ? "Active" : "Suspended"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(u.lastActive).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(u)}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Providers Tab ── */}
        <TabsContent value="providers" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Configure LLM providers and API connections.
            </p>
            <Button onClick={() => setShowAddProvider(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Provider
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.length === 0 ? (
              <Card className="col-span-full bg-card/60 backdrop-blur-sm border-border/50">
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  No providers configured. Add one to get started.
                </CardContent>
              </Card>
            ) : (
              providers.map((p) => (
                <Card key={p.id} className="bg-card/60 backdrop-blur-sm border-border/50">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{p.name}</span>
                      </div>
                      <Switch
                        checked={p.isActive}
                        onCheckedChange={(checked) => handleToggleProvider(p.id, checked)}
                      />
                    </div>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div className="flex gap-2">
                        <Badge variant="secondary">{p.type}</Badge>
                        <Badge variant="outline">{p.model}</Badge>
                      </div>
                      {p.endpoint && (
                        <p className="truncate text-xs mt-2">{p.endpoint}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* ── System Stats Tab ── */}
        <TabsContent value="stats" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Total Users",
                value: stats?.totalUsers ?? "—",
                icon: Users,
                color: "text-chart-1",
              },
              {
                label: "Active Users",
                value: stats?.activeUsers ?? "—",
                icon: Activity,
                color: "text-chart-2",
              },
              {
                label: "Total Conversations",
                value: stats?.totalConversations ?? "—",
                icon: MessageSquare,
                color: "text-chart-3",
              },
              {
                label: "Avg Response Time",
                value: stats ? `${stats.avgResponseTime}ms` : "—",
                icon: Clock,
                color: "text-chart-4",
              },
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label} className="bg-card/60 backdrop-blur-sm border-border/50">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">{stat.label}</span>
                      <Icon className={`h-4 w-4 ${stat.color}`} />
                    </div>
                    <p className="text-2xl font-semibold">{stat.value}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Delete User Dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.username}</strong>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteUser}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Provider Dialog ── */}
      <Dialog open={showAddProvider} onOpenChange={setShowAddProvider}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Provider</DialogTitle>
            <DialogDescription>Configure a new LLM provider connection.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={newProvider.name}
                onChange={(e) => setNewProvider((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. OpenAI Production"
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={newProvider.type}
                onValueChange={(val) => setNewProvider((p) => ({ ...p, type: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                value={newProvider.apiKey}
                onChange={(e) => setNewProvider((p) => ({ ...p, apiKey: e.target.value }))}
                placeholder="sk-..."
              />
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={newProvider.model}
                onChange={(e) => setNewProvider((p) => ({ ...p, model: e.target.value }))}
                placeholder="e.g. gpt-4o"
              />
            </div>
            <div className="space-y-2">
              <Label>Endpoint (optional)</Label>
              <Input
                value={newProvider.endpoint}
                onChange={(e) => setNewProvider((p) => ({ ...p, endpoint: e.target.value }))}
                placeholder="https://api.openai.com/v1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddProvider(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddProvider} disabled={!newProvider.name || !newProvider.model}>
              Add Provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
