import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: "admin" | "member" | "viewer";
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const DEMO_USER: AuthUser = {
  id: "demo-001",
  username: "admin",
  email: "admin@aibyai.dev",
  role: "admin",
};
const DEMO_TOKEN = "demo-token-preview-only";

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("aibyai_token");
    const savedUser = localStorage.getItem("aibyai_user");
    if (token && savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem("aibyai_token");
        localStorage.removeItem("aibyai_user");
      }
    }
  }, []);

  const login = async (username: string, _password: string) => {
    // Demo mode: accept any credentials
    localStorage.setItem("aibyai_token", DEMO_TOKEN);
    localStorage.setItem("aibyai_user", JSON.stringify(DEMO_USER));
    setUser(DEMO_USER);
  };

  const logout = () => {
    localStorage.removeItem("aibyai_token");
    localStorage.removeItem("aibyai_user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
