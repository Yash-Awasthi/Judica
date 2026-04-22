import { useState, useEffect, useRef, useCallback } from "react";
import { Outlet, useNavigation } from "react-router";
import { TooltipProvider } from "~/components/ui/tooltip";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { CommandPalette } from "./CommandPalette";
import { useAuth } from "~/context/AuthContext";
import { useNavigate } from "react-router";
import { SidebarProvider } from "~/context/SidebarContext";
import gsap from "gsap";

export default function AppLayout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const mainRef = useRef<HTMLDivElement>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Page transition animation
  const prevPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (navigation.state === "idle" && mainRef.current) {
      const currentPath = window.location.pathname;
      if (prevPathRef.current !== currentPath) {
        prevPathRef.current = currentPath;
        gsap.fromTo(
          mainRef.current,
          { opacity: 0, y: 6 },
          { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }
        );
      }
    }
  }, [navigation.state]);

  const handleOpenCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <SidebarProvider>
      <TooltipProvider delayDuration={0}>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <Header onOpenCommandPalette={handleOpenCommandPalette} />
            <main
              ref={mainRef}
              className="flex-1 overflow-y-auto"
            >
              <Outlet />
            </main>
          </div>
          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
          />
        </div>
      </TooltipProvider>
    </SidebarProvider>
  );
}
