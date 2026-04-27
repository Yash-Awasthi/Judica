import { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  MessageSquare,
  Plus,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/context/AuthContext";

import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "AIBYAI - Dashboard" },
    { name: "description", content: "AI-powered deliberation platform" },
  ];
}

export function clientLoader() {
  return {};
}

interface StoredConv {
  id: string;
  title: string;
  date: string;
  mode: string;
}

export default function Home() {
  const { user } = useAuth();
  const [recentConvs, setRecentConvs] = useState<StoredConv[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const raw = localStorage.getItem(`aibyai-chats-${user.id}`);
      const all: StoredConv[] = raw ? JSON.parse(raw) : [];
      setRecentConvs(all.slice(0, 6));
    } catch {
      setRecentConvs([]);
    }
  }, [user?.id]);

  const displayName = user?.username ?? "there";

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back, {displayName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your private AI deliberation workspace
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Conversations */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Recent Deliberations</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/chat">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {recentConvs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No deliberations yet.</p>
                  <Button size="sm" asChild>
                    <Link to="/chat">
                      <Plus className="mr-2 h-4 w-4" />
                      Start your first deliberation
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {recentConvs.map((conv) => (
                    <Link
                      key={conv.id}
                      to="/chat"
                      className="flex items-center justify-between rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <p className="text-sm font-medium truncate">{conv.title}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                        <span>{conv.date}</span>
                        <ArrowRight className="h-3 w-3" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full justify-start" asChild>
                <Link to="/chat">
                  <Plus className="mr-2 h-4 w-4" />
                  New Deliberation
                </Link>
              </Button>
              <Button variant="secondary" className="w-full justify-start" asChild>
                <Link to="/archetypes">
                  Configure Council
                </Link>
              </Button>
              <Button variant="secondary" className="w-full justify-start" asChild>
                <Link to="/settings">
                  Settings
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
