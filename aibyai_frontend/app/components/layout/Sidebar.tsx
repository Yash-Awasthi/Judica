import { useNavigate, useLocation } from "react-router";
import {
  LayoutDashboard,
  MessageSquare,
  FolderOpen,
  GitBranch,
  Code2,
  Database,
  Zap,
  GitBranch as Github,
  Store,
  BarChart2,
  Shield,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useAuth } from "~/context/AuthContext";
import { useSidebar } from "~/context/SidebarContext";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Chat", icon: MessageSquare, path: "/chat" },
  { label: "Projects", icon: FolderOpen, path: "/projects" },
  { label: "Workflows", icon: GitBranch, path: "/workflows" },
  { label: "Prompts IDE", icon: Code2, path: "/prompts" },
  { label: "Knowledge Base", icon: Database, path: "/knowledge-base" },
  { label: "Skills", icon: Zap, path: "/skills" },
  { label: "Repositories", icon: GitBranch as Github, path: "/repos" },
  { label: "Marketplace", icon: Store, path: "/marketplace" },
  { label: "Analytics", icon: BarChart2, path: "/analytics", adminOnly: true },
  { label: "Admin", icon: Shield, path: "/admin", adminOnly: true },
  { label: "Settings", icon: Settings, path: "/settings" },
];

export function Sidebar() {
  const { collapsed, toggle } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  const isAdmin = user?.role === "admin";

  const visibleItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin
  );

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <aside
      className={cn(
        "flex flex-col h-screen border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-14 px-4 gap-3">
        <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
          <span className="text-sm font-bold text-primary">ai</span>
          <div className="absolute inset-0 rounded-lg bg-primary/20 blur-sm animate-[glow-pulse_3s_ease-in-out_infinite]" />
        </div>
        {!collapsed && (
          <span className="font-display text-lg font-semibold tracking-tight text-sidebar-foreground">
            aibyai
          </span>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {visibleItems.map((item) => {
          const isActive = location.pathname === item.path ||
            location.pathname.startsWith(item.path + "/");
          const Icon = item.icon;

          const button = (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.path} delayDuration={0}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return button;
        })}
      </nav>

      <Separator className="bg-sidebar-border" />

      {/* User section */}
      <div className="p-2 space-y-1">
        {user && (
          <div
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md",
              collapsed && "justify-center"
            )}
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-semibold shrink-0">
              {user.username.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user.username}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user.role}
                </p>
              </div>
            )}
          </div>
        )}

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={handleLogout}
              className={cn(
                "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive",
                collapsed && "justify-center"
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Logout</span>}
            </button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right" sideOffset={8}>
              Logout
            </TooltipContent>
          )}
        </Tooltip>
      </div>

      {/* Collapse toggle */}
      <div className="p-2 border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center text-muted-foreground"
          onClick={toggle}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
