import { useState } from "react";
import { useAuth } from "~/context/AuthContext";
import { api } from "~/lib/api";
import { useTheme } from "~/context/ThemeContext";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Switch } from "~/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Settings, User, Database, Palette, Key, Save, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [profileForm, setProfileForm] = useState({ username: user?.username ?? "", email: user?.email ?? "", currentPassword: "", newPassword: "" });
  const [memoryForm, setMemoryForm] = useState({ type: "local", connectionString: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saveProfile() {
    setSaving(true);
    try {
      await api.put("/auth/profile", { username: profileForm.username, email: profileForm.email });
      toast.success("Profile updated");
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function changePassword() {
    if (!profileForm.newPassword) return;
    setSaving(true);
    try {
      await api.post("/auth/change-password", { currentPassword: profileForm.currentPassword, newPassword: profileForm.newPassword });
      toast.success("Password changed");
      setProfileForm((f) => ({...f, currentPassword: "", newPassword: ""}));
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-3"><Settings className="w-6 h-6 text-indigo-400" /><h1 className="text-2xl font-semibold">Settings</h1></div>

      <Tabs defaultValue="profile">
        <TabsList><TabsTrigger value="profile"><User className="w-3.5 h-3.5 mr-1.5" />Profile</TabsTrigger><TabsTrigger value="memory"><Database className="w-3.5 h-3.5 mr-1.5" />Memory</TabsTrigger><TabsTrigger value="appearance"><Palette className="w-3.5 h-3.5 mr-1.5" />Appearance</TabsTrigger><TabsTrigger value="keys"><Key className="w-3.5 h-3.5 mr-1.5" />API Keys</TabsTrigger></TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Username</Label><Input value={profileForm.username} onChange={(e) => setProfileForm((f) => ({...f, username: e.target.value}))} /></div>
              <div><Label>Email</Label><Input type="email" value={profileForm.email} onChange={(e) => setProfileForm((f) => ({...f, email: e.target.value}))} /></div>
              <Button onClick={saveProfile} disabled={saving} className="gap-2"><Save className="w-4 h-4"/>Save Profile</Button>
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium">Change Password</p>
                <div><Label>Current Password</Label><div className="relative"><Input type={showPassword ? "text" : "password"} value={profileForm.currentPassword} onChange={(e) => setProfileForm((f) => ({...f, currentPassword: e.target.value}))} /><Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}</Button></div></div>
                <div><Label>New Password</Label><Input type="password" value={profileForm.newPassword} onChange={(e) => setProfileForm((f) => ({...f, newPassword: e.target.value}))} /></div>
                <Button variant="outline" onClick={changePassword} disabled={saving}>Change Password</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Memory Backend</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div><Label>Backend Type</Label>
                <Select value={memoryForm.type} onValueChange={(v) => setMemoryForm((f) => ({...f, type: v}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="local">Local (in-process)</SelectItem><SelectItem value="redis">Redis</SelectItem><SelectItem value="none">Disabled</SelectItem></SelectContent>
                </Select>
              </div>
              {memoryForm.type === "redis" && <div><Label>Connection String</Label><Input value={memoryForm.connectionString} onChange={(e) => setMemoryForm((f) => ({...f, connectionString: e.target.value}))} placeholder="redis://localhost:6379" /></div>}
              <Button className="gap-2"><Save className="w-4 h-4"/>Save Memory Settings</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Appearance</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between"><div><p className="text-sm font-medium">Dark Mode</p><p className="text-xs text-muted-foreground">Toggle between dark and light theme</p></div><Switch checked={theme === "dark"} onCheckedChange={toggleTheme} /></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keys" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">API Keys</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">API keys are managed by administrators. Contact your admin to obtain or rotate keys.</p>
              {["OpenAI", "Anthropic", "Google"].map((provider) => (
                <div key={provider} className="flex items-center justify-between p-3 rounded-lg border">
                  <div><p className="text-sm font-medium">{provider}</p><p className="text-xs text-muted-foreground font-mono">••••••••••••••••</p></div>
                  <Badge variant="outline" className="text-xs">Configured</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
