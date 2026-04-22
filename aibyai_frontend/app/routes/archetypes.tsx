import { useState, useEffect } from "react";
import { api } from "~/lib/api";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { Brain, Plus, Trash2, Edit2, Cpu } from "lucide-react";

interface Archetype {
  id: string; name: string; description: string;
  systemPrompt: string; model: string; temperature: number;
}

const MODELS = ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307", "gemini-1.5-pro"];
const modelColors: Record<string, string> = { "gpt-4o": "text-emerald-400", "claude-3-5-sonnet-20241022": "text-violet-400", "gemini-1.5-pro": "text-blue-400" };

export default function ArchetypesPage() {
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Archetype | null>(null);
  const [form, setForm] = useState({ name: "", description: "", systemPrompt: "", model: "gpt-4o", temperature: 0.7 });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    api.get<Archetype[]>("/archetypes").then(setArchetypes).catch(() => setArchetypes([])).finally(() => setLoading(false));
  }, []);

  function openCreate() { setEditing(null); setForm({ name: "", description: "", systemPrompt: "", model: "gpt-4o", temperature: 0.7 }); setOpen(true); }
  function openEdit(a: Archetype) { setEditing(a); setForm({ name: a.name, description: a.description, systemPrompt: a.systemPrompt, model: a.model, temperature: a.temperature }); setOpen(true); }

  async function handleSave() {
    if (editing) {
      const updated = await api.put<Archetype>(`/archetypes/${editing.id}`, form);
      setArchetypes((prev) => prev.map((a) => (a.id === editing.id ? updated : a)));
    } else {
      const created = await api.post<Archetype>("/archetypes", form);
      setArchetypes((prev) => [...prev, created]);
    }
    setOpen(false);
  }

  async function handleDelete(id: string) {
    await api.del(`/archetypes/${id}`);
    setArchetypes((prev) => prev.filter((a) => a.id !== id));
    setDeleteId(null);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3"><Brain className="w-6 h-6 text-indigo-400" /><h1 className="text-2xl font-semibold">Archetypes</h1></div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> New Archetype</Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({length:4}).map((_,i) => <div key={i} className="h-36 rounded-lg bg-muted animate-pulse" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {archetypes.map((a) => (
            <Card key={a.id} className="hover:border-indigo-500/40 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{a.name}</CardTitle>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => openEdit(a)}><Edit2 className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(a.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Cpu className={`w-3.5 h-3.5 ${modelColors[a.model] ?? "text-muted-foreground"}`} />
                  <Badge variant="secondary" className="text-xs">{a.model}</Badge>
                  <span className="text-xs text-muted-foreground">temp: {a.temperature}</span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-2">{a.description}</p>
                {a.systemPrompt && <p className="text-xs text-muted-foreground/60 mt-2 font-mono line-clamp-2 bg-muted/50 p-2 rounded">{a.systemPrompt}</p>}
              </CardContent>
            </Card>
          ))}
          {archetypes.length === 0 && (
            <div className="col-span-3 text-center py-16 text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No archetypes yet. Create your first AI persona.</p>
            </div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Archetype" : "New Archetype"}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({...f, name: e.target.value}))} placeholder="The Analyst" /></div>
            <div><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({...f, description: e.target.value}))} placeholder="Specializes in data analysis..." /></div>
            <div><Label>System Prompt</Label><Textarea value={form.systemPrompt} onChange={(e) => setForm((f) => ({...f, systemPrompt: e.target.value}))} rows={5} className="font-mono text-sm" placeholder="You are a careful analyst who..." /></div>
            <div><Label>Model</Label>
              <Select value={form.model} onValueChange={(v) => setForm((f) => ({...f, model: v}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Temperature: {form.temperature}</Label><Slider min={0} max={2} step={0.1} value={[form.temperature]} onValueChange={([v]) => setForm((f) => ({...f, temperature: v}))} className="mt-2" /></div>
            <Button onClick={handleSave} className="w-full">{editing ? "Save Changes" : "Create Archetype"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Archetype?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This action cannot be undone.</p>
          <div className="flex gap-3 mt-4"><Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)}>Delete</Button><Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
