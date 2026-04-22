import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Settings, Pencil, Check, X } from "lucide-react";

const initialConfigs = [
  { key: "default_llm_model", value: "gpt-4o", type: "string" },
  { key: "rate_limit_max", value: "100", type: "number" },
  { key: "rate_limit_window_ms", value: "60000", type: "number" },
  { key: "maintenance_mode", value: "false", type: "boolean" },
  { key: "feature_flags", value: '{"council_v2":true,"memory_compaction":false}', type: "json" },
];

export default function AdminSystemPage() {
  const [configs, setConfigs] = useState(initialConfigs);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (key: string, value: string) => {
    setEditingKey(key);
    setEditValue(value);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue("");
  };

  const saveEdit = (key: string) => {
    setConfigs((prev) =>
      prev.map((c) => (c.key === key ? { ...c, value: editValue } : c))
    );
    setEditingKey(null);
    setEditValue("");
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Settings className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">System Configuration</h1>
            <p className="text-sm text-muted-foreground">
              Manage system-wide configuration values and feature flags
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configuration Keys</CardTitle>
            <CardDescription>Edit system configuration values. Changes take effect immediately.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Key</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Value</th>
                    <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Type</th>
                    <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((config) => (
                    <tr key={config.key} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <code className="text-sm font-mono text-primary">{config.key}</code>
                      </td>
                      <td className="px-4 py-3">
                        {editingKey === config.key ? (
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="h-7 font-mono text-sm max-w-md"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(config.key);
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                        ) : (
                          <code className="text-sm font-mono text-muted-foreground break-all">
                            {config.value}
                          </code>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-[10px]">
                          {config.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editingKey === config.key ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => saveEdit(config.key)}
                            >
                              <Check className="size-3 text-green-400" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={cancelEdit}
                            >
                              <X className="size-3 text-red-400" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => startEdit(config.key, config.value)}
                          >
                            <Pencil className="size-3" />
                          </Button>
                        )}
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
