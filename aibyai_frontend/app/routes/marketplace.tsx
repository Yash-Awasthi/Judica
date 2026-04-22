import { useState, useEffect } from "react";
import { api } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Store, Search, Star, Download, Plus, Package, BookOpen, GitBranch, Zap } from "lucide-react";

interface MarketplaceAsset {
  id: string;
  title: string;
  type: "prompt" | "workflow" | "persona" | "tool";
  author: string;
  downloads: number;
  rating: number;
  description: string;
  tags: string[];
}

const typeIcons = { prompt: BookOpen, workflow: GitBranch, persona: Package, tool: Zap };
const typeColors: Record<string, string> = {
  prompt: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  workflow: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  persona: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  tool: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

export default function MarketplacePage() {
  const [assets, setAssets] = useState<MarketplaceAsset[]>([]);
  const [myAssets, setMyAssets] = useState<MarketplaceAsset[]>([]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishForm, setPublishForm] = useState({ title: "", description: "", type: "prompt", content: "", tags: "" });

  useEffect(() => {
    setLoading(true);
    api.get<MarketplaceAsset[]>("/marketplace").then(setAssets).catch(() => setAssets([])).finally(() => setLoading(false));
    api.get<MarketplaceAsset[]>("/marketplace?mine=true").then(setMyAssets).catch(() => setMyAssets([]));
  }, []);

  const filtered = assets.filter((a) => {
    const matchSearch = a.title.toLowerCase().includes(search.toLowerCase()) || a.description.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === "all" || a.type === filterType;
    return matchSearch && matchType;
  });

  async function handlePublish() {
    try {
      await api.post("/marketplace", { ...publishForm, tags: publishForm.tags.split(",").map((t) => t.trim()) });
      setPublishOpen(false);
      const updated = await api.get<MarketplaceAsset[]>("/marketplace");
      setAssets(updated);
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Store className="w-6 h-6 text-indigo-400" />
          <h1 className="text-2xl font-semibold">Marketplace</h1>
        </div>
        <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="w-4 h-4" /> Publish Asset</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Publish Asset</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div><Label>Title</Label><Input value={publishForm.title} onChange={(e) => setPublishForm((f) => ({ ...f, title: e.target.value }))} placeholder="My awesome prompt" /></div>
              <div><Label>Type</Label>
                <Select value={publishForm.type} onValueChange={(v) => setPublishForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prompt">Prompt</SelectItem>
                    <SelectItem value="workflow">Workflow</SelectItem>
                    <SelectItem value="persona">Persona</SelectItem>
                    <SelectItem value="tool">Tool</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Description</Label><Textarea value={publishForm.description} onChange={(e) => setPublishForm((f) => ({ ...f, description: e.target.value }))} rows={3} /></div>
              <div><Label>Content (JSON or text)</Label><Textarea value={publishForm.content} onChange={(e) => setPublishForm((f) => ({ ...f, content: e.target.value }))} rows={4} className="font-mono text-sm" /></div>
              <div><Label>Tags (comma separated)</Label><Input value={publishForm.tags} onChange={(e) => setPublishForm((f) => ({ ...f, tags: e.target.value }))} placeholder="analysis, research, debate" /></div>
              <Button onClick={handlePublish} className="w-full">Publish</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="browse">
        <TabsList><TabsTrigger value="browse">Browse</TabsTrigger><TabsTrigger value="mine">My Assets</TabsTrigger></TabsList>
        <TabsContent value="browse" className="mt-4 space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search assets..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="prompt">Prompts</SelectItem>
                <SelectItem value="workflow">Workflows</SelectItem>
                <SelectItem value="persona">Personas</SelectItem>
                <SelectItem value="tool">Tools</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({length:6}).map((_,i) => <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />)}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((asset) => {
                const Icon = typeIcons[asset.type] ?? Package;
                return (
                  <Card key={asset.id} className="hover:border-indigo-500/40 transition-colors">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <Badge className={`text-xs border ${typeColors[asset.type]}`}><Icon className="w-3 h-3 mr-1" />{asset.type}</Badge>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{asset.rating.toFixed(1)}</div>
                      </div>
                      <CardTitle className="text-base mt-2">{asset.title}</CardTitle>
                      <CardDescription className="text-xs">by {asset.author}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{asset.description}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap gap-1">{asset.tags.slice(0,3).map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}</div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground"><Download className="w-3 h-3" />{asset.downloads}</div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {filtered.length === 0 && <div className="col-span-3 text-center py-12 text-muted-foreground">No assets found</div>}
            </div>
          )}
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myAssets.map((asset) => {
              const Icon = typeIcons[asset.type] ?? Package;
              return (
                <Card key={asset.id}>
                  <CardHeader className="pb-2">
                    <Badge className={`text-xs border w-fit ${typeColors[asset.type]}`}><Icon className="w-3 h-3 mr-1" />{asset.type}</Badge>
                    <CardTitle className="text-base">{asset.title}</CardTitle>
                  </CardHeader>
                  <CardContent><p className="text-sm text-muted-foreground">{asset.description}</p></CardContent>
                </Card>
              );
            })}
            {myAssets.length === 0 && <div className="col-span-3 text-center py-12 text-muted-foreground">You haven't published anything yet</div>}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
