import { Link } from "react-router";
import { useGsapStagger } from "~/hooks/useGsapStagger";
import {
  MessageSquare,
  Brain,
  Database,
  DollarSign,
  Plus,
  Settings,
  GitFork,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  mockConversations,
  mockAnalytics,
  INITIAL_CONNECTED_PROVIDERS,
  AVAILABLE_PROVIDERS,
} from "~/lib/mock-data";

import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "AIBYAI - Mission Control" },
    { name: "description", content: "AI-powered deliberation platform" },
  ];
}

function timeAgo(dateStr: string) {
  const now = new Date("2026-04-22T15:00:00Z");
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const modeBadgeVariant = {
  auto: "default",
  manual: "secondary",
  direct: "outline",
} as const;

export default function Home() {
  const statsRef = useGsapStagger<HTMLDivElement>();
  const stats = [
    {
      label: "Total Conversations",
      value: mockAnalytics.totalConversations.toLocaleString(),
      icon: MessageSquare,
    },
    {
      label: "Active Providers",
      value: mockAnalytics.activeProviders,
      icon: Brain,
    },
    {
      label: "Knowledge Bases",
      value: mockAnalytics.knowledgeBases,
      icon: Database,
    },
    {
      label: "Cost This Month",
      value: `$${mockAnalytics.costThisMonth.toFixed(2)}`,
      icon: DollarSign,
    },
  ];

  const recentConversations = mockConversations.slice(0, 6);

  const connectedProviderIds = INITIAL_CONNECTED_PROVIDERS.map(
    (cp) => cp.providerId
  );
  const connectedProviders = AVAILABLE_PROVIDERS.filter((p) =>
    connectedProviderIds.includes(p.id)
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          AIBYAI Mission Control
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Multi-perspective AI deliberation platform
        </p>
      </div>

      {/* Stat Cards */}
      <div ref={statsRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Conversations */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                Recent Deliberations
              </CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/chat">View all</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-1">
              {recentConversations.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/chat/${conv.id}`}
                  className="flex items-center justify-between rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {conv.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {conv.messageCount} messages
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={
                        modeBadgeVariant[
                          conv.mode as keyof typeof modeBadgeVariant
                        ] ?? "outline"
                      }
                    >
                      {conv.mode}
                    </Badge>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {timeAgo(conv.updatedAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full justify-start" asChild>
                <Link to="/chat">
                  <Plus className="mr-2 h-4 w-4" />
                  New Deliberation
                </Link>
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start"
                asChild
              >
                <Link to="/language-models">
                  <Settings className="mr-2 h-4 w-4" />
                  Configure Providers
                </Link>
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-start"
                asChild
              >
                <Link to="/workflows">
                  <GitFork className="mr-2 h-4 w-4" />
                  New Workflow
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Provider Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                Provider Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {connectedProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="text-sm">{provider.name}</span>
                  </div>
                  <Badge variant="outline">
                    {provider.models.length} models
                  </Badge>
                </div>
              ))}
              {AVAILABLE_PROVIDERS.filter(
                (p) => !connectedProviderIds.includes(p.id)
              )
                .slice(0, 3)
                .map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{provider.name}</span>
                    </div>
                    <Badge variant="outline">Not connected</Badge>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
