import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface SidebarContextType {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

const STORAGE_KEY = "aibyai_sidebar_collapsed";

function getInitial(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(getInitial);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(v));
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextType {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
