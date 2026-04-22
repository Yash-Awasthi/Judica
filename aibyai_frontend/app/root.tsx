import {
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
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
import { mockUser } from "~/lib/mock-data";
import { ThemeProvider, useTheme } from "~/context/ThemeContext";

import type { Route } from "./+types/root";
import "./app.css";

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
      { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
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
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
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
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <NavLink to="/" className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
            A
          </div>
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            AIBYAI
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
            <SidebarMenuButton asChild tooltip={mockUser.name}>
              <NavLink to="/profile" className="flex items-center gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                  {mockUser.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div className="flex flex-col group-data-[collapsible=icon]:hidden">
                  <span className="text-xs font-medium leading-none">
                    {mockUser.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {mockUser.role}
                  </span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <ThemeToggleButton />
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Logout">
              <NavLink to="/login" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
                <LogOut className="size-4" />
                <span className="group-data-[collapsible=icon]:hidden text-xs">Logout</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export default function App() {
  const location = useLocation();
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";

  if (isAuthPage) {
    return (
      <ThemeProvider>
        <Outlet />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <main className="flex-1 overflow-auto">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2 md:hidden">
              <SidebarTrigger />
              <span className="text-sm font-semibold">AIBYAI</span>
            </div>
            <Outlet />
          </main>
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
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

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
