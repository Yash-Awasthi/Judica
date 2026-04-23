import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Brain, Database, HardDrive, Clock, Trash2, Minimize2 } from "lucide-react";
import { useState } from "react";

const mockMemoryEntries = [
  { id: "1", topic: "User authentication preferences", chunks: 23, date: "2 hours ago", source: "chat" },
  { id: "2", topic: "React performance optimization patterns", chunks: 45, date: "Yesterday", source: "chat" },
  { id: "3", topic: "Database indexing strategies for PostgreSQL", chunks: 18, date: "2 days ago", source: "document" },
  { id: "4", topic: "CI/CD pipeline configuration best practices", chunks: 31, date: "3 days ago", source: "chat" },
  { id: "5", topic: "API rate limiting implementation details", chunks: 12, date: "1 week ago", source: "document" },
];

export default function MemoryPage() {
  const [backend, setBackend] = useState("local");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Brain className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Memory</h1>
            <p className="text-sm text-muted-foreground">
              Manage long-term memory storage, retrieval, and compaction
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Database className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">1,247</p>
                <p className="text-xs text-muted-foreground">Chunks</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <HardDrive className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">~4.8 MB</p>
                <p className="text-xs text-muted-foreground">Storage</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Clock className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold">2 days ago</p>
                <p className="text-xs text-muted-foreground">Last Compacted</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Backend Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Backend Configuration</CardTitle>
            <CardDescription>Select and configure the memory storage engine</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Current Backend</p>
                <p className="text-xs text-muted-foreground">
                  Controls where memory chunks are stored and indexed
                </p>
              </div>
              <Select value={backend} onValueChange={setBackend}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="qdrant">Qdrant</SelectItem>
                  <SelectItem value="getzep">GetZep</SelectItem>
                  <SelectItem value="google_drive">Google Drive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Minimize2 className="size-3" />
                Compact Memory
              </Button>
              <Button variant="destructive" size="sm" className="gap-1.5">
                <Trash2 className="size-3" />
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recent Memory Entries */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Memory Entries</CardTitle>
            <CardDescription>Latest topics stored in long-term memory</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-0 divide-y divide-border">
              {mockMemoryEntries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <Brain className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{entry.topic}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {entry.chunks} chunks
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {entry.source}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{entry.date}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
