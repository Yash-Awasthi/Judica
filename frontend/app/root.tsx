import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import {
  MessageSquare,
  LayoutDashboard,
  Brain,
  GitFork,
  FileText,
  Database,
  Store,
  Users as UsersIcon,
  Settings,
  UserCircle,
  BarChart3,
  Server,
  ScrollText,
  Hexagon,
  BookOpen,
  Wrench,
  GitBranch,
  FolderOpen,
  ClipboardCheck,
  LogOut,
  Sun,
  Moon,
  Eye,
  Hammer,
} from "lucide-react";

import { TooltipProvider } from "~/components/ui/tooltip";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { ThemeProvider, useTheme } from "~/context/ThemeContext";
import { StoreProvider } from "~/context/StoreContext";
import { AuthProvider, useAuth } from "~/context/AuthContext";

import type { Route } from "./+types/root";
import "./app.css";

const PUBLIC_PATHS = new Set([
  "/", "/login", "/setup",
]);

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith("/product/");
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

const navGroups = [
  {
    label: "Intelligence",
    items: [
      { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", end: true },
      { to: "/chat", icon: MessageSquare, label: "Deliberations" },
      { to: "/archetypes", icon: Hexagon, label: "Archetypes" },
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/workflows", icon: GitFork, label: "Workflows" },
      { to: "/prompts", icon: FileText, label: "Prompts" },
      { to: "/skills", icon: Wrench, label: "Skills" },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { to: "/knowledge-bases", icon: Database, label: "Knowledge Bases" },
      { to: "/repos", icon: GitBranch, label: "Repositories" },
      { to: "/memory", icon: BookOpen, label: "Memory" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { to: "/projects", icon: FolderOpen, label: "Projects" },
      { to: "/evaluation", icon: ClipboardCheck, label: "Evaluation" },
      { to: "/marketplace", icon: Store, label: "Marketplace" },
      { to: "/build", icon: Hammer, label: "Build" },
      { to: "/god-mode", icon: Eye, label: "God Mode" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { to: "/language-models", icon: Brain, label: "Language Models" },
      { to: "/settings", icon: Settings, label: "Settings" },
      { to: "/profile", icon: UserCircle, label: "Profile" },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/admin/users", icon: UsersIcon, label: "Users" },
      { to: "/admin/analytics", icon: BarChart3, label: "Analytics" },
      { to: "/admin/system", icon: Server, label: "System" },
      { to: "/admin/audit", icon: ScrollText, label: "Audit Log" },
    ],
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationMismatch>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Phase 3.15 — PWA manifest */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#09090b" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Judica" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var theme = localStorage.getItem('judica_theme') || 'dark';
              document.documentElement.classList.toggle('dark', theme === 'dark');
            } catch(e) {}
          })();
        `}} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function NavItem({
  item,
}: {
  item: { to: string; icon: React.ElementType; label: string; end?: boolean };
}) {
  const location = useLocation();
  const isActive = item.end
    ? location.pathname === item.to
    : location.pathname.startsWith(item.to);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
        <NavLink to={item.to} end={item.end}>
          <item.icon className="size-4" />
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={toggleTheme}
        tooltip={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground cursor-pointer"
      >
        {theme === "dark" ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )}
        <span className="group-data-[collapsible=icon]:hidden text-xs">
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AppSidebar() {
  const { user, logout } = useAuth();
  const displayName = user?.username ?? "Guest";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <NavLink to="/dashboard" className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
            J
          </div>
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            JUDICA
          </span>
        </NavLink>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavItem key={item.to} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={displayName}>
              <NavLink to="/profile" className="flex items-center gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                  {initials}
                </div>
                <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                  <span className="text-xs font-medium leading-none">
                    {displayName}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {user?.role ?? ""}
                  </span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <ThemeToggleButton />
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Logout">
              <button
                onClick={() => logout()}
                className="flex w-full items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <LogOut className="size-4" />
                <span className="group-data-[collapsible=icon]:hidden text-xs">Logout</span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // In Electron, skip landing page and go straight to /chat
  useEffect(() => {
    if (location.pathname === "/" && typeof window !== "undefined" && (window as any).molecule) {
      navigate("/chat", { replace: true });
      return;
    }
    // Client-side auth guard — redirect to /setup if no user profile exists
    if (isPublicPath(location.pathname)) return;
    const profile = localStorage.getItem("judica_user");
    if (!profile) {
      navigate("/setup", { replace: true });
    }
  }, [location.pathname]);

  if (isPublicPath(location.pathname)) {
    return (
      <AuthProvider>
        <ThemeProvider>
          <Outlet />
        </ThemeProvider>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <ThemeProvider>
        <StoreProvider>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <main className="flex-1 overflow-auto">
                <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:hidden">
                  <SidebarTrigger />
                  <span className="text-sm font-semibold">JUDICA</span>
                </div>
                <Outlet />
              </main>
            </SidebarProvider>
          </TooltipProvider>
        </StoreProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (error && error instanceof Error) {
    details = error.message;
    stack = import.meta.env.DEV ? error.stack : undefined;
  }

  const is404 = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto size-20 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <span className="text-4xl font-bold text-destructive">{is404 ? "404" : "!"}</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{message}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">{details}</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go Home
          </a>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            Go Back
          </button>
        </div>
        {stack && (
          <details className="text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
              Stack Trace
            </summary>
            <pre className="mt-2 w-full p-3 rounded-md bg-muted text-xs overflow-x-auto">
              <code className="text-muted-foreground">{stack}</code>
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}
