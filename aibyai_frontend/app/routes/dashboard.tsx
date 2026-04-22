import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import gsap from "gsap";
import {
  MessageSquare,
  GitBranch,
  Store,
  Users,
  FolderOpen,
  Coins,
  Activity,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/context/AuthContext";
import { api } from "~/lib/api";

// Lazy-load Three.js canvas — it uses browser APIs that break SSR
const ParticleBackground = lazy(() => import("~/components/ParticleBackground"));

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  createdAt?: string;
}

interface StatsData {
  conversations: number;
  projects: number;
  councilMembers: number;
  tokenUsage: string;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const cardsRef = useRef<HTMLDivElement>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [stats, setStats] = useState<StatsData>({
    conversations: 0,
    projects: 0,
    councilMembers: 0,
    tokenUsage: "0",
  });

  // Fetch data
  useEffect(() => {
    api
      .get<Conversation[]>("/conversations")
      .then((data) => {
        setConversations(Array.isArray(data) ? data.slice(0, 5) : []);
        setStats((s) => ({
          ...s,
          conversations: Array.isArray(data) ? data.length : 0,
        }));
      })
      .catch(() => {
        // API not available yet - use empty state
      });
  }, []);

  // GSAP stagger animation on cards
  useEffect(() => {
    if (!cardsRef.current) return;
    const cards = cardsRef.current.querySelectorAll("[data-animate-card]");
    const ctx = gsap.context(() => {
      gsap.from(cards, {
        opacity: 0,
        y: 20,
        duration: 0.5,
        stagger: 0.08,
        ease: "power2.out",
      });
    });
    return () => ctx.revert();
  }, []);

  const statCards = [
    {
      label: "Total Conversations",
      value: stats.conversations,
      icon: MessageSquare,
      color: "text-chart-1",
    },
    {
      label: "Active Projects",
      value: stats.projects,
      icon: FolderOpen,
      color: "text-chart-2",
    },
    {
      label: "Council Members",
      value: stats.councilMembers,
      icon: Users,
      color: "text-chart-3",
    },
    {
      label: "Token Usage",
      value: stats.tokenUsage,
      icon: Coins,
      color: "text-chart-4",
    },
  ];

  return (
    <div className="relative min-h-full">
      <Suspense fallback={null}>
        <ParticleBackground />
      </Suspense>

      <div className="relative z-10 p-6 space-y-6 max-w-7xl mx-auto" ref={cardsRef}>
        {/* Welcome */}
        <div data-animate-card>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, {user?.username ?? "User"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Here's an overview of your AI deliberation platform.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card
                key={stat.label}
                data-animate-card
                className="bg-card/60 backdrop-blur-sm border-border/50"
              >
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

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3" data-animate-card>
          <Button onClick={() => navigate("/chat")} className="gap-2">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/workflows")}
            className="gap-2"
          >
            <GitBranch className="h-4 w-4" />
            New Workflow
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/marketplace")}
            className="gap-2"
          >
            <Store className="h-4 w-4" />
            Browse Marketplace
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent conversations */}
          <Card
            data-animate-card
            className="bg-card/60 backdrop-blur-sm border-border/50"
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">
                Recent Conversations
              </CardTitle>
            </CardHeader>
            <CardContent>
              {conversations.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No conversations yet. Start a new chat to begin.
                </p>
              ) : (
                <div className="space-y-2">
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => navigate(`/chat/${conv.id}`)}
                      className="flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
                    >
                      <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{conv.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(conv.updated_at).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity feed */}
          <Card
            data-animate-card
            className="bg-card/60 backdrop-blur-sm border-border/50"
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">
                Activity Feed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { text: "Platform initialized", time: "Just now", icon: Activity },
                  {
                    text: "Welcome to aibyai",
                    time: "Today",
                    icon: Users,
                  },
                ].map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 text-sm"
                    >
                      <div className="flex items-center justify-center h-7 w-7 rounded-full bg-muted shrink-0">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <span className="flex-1 text-foreground/80">
                        {item.text}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.time}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
