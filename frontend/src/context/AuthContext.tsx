import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";

interface AuthContextType {
  user: string;
  token: string | null;
  login: (emailOrToken: string, password: string) => void | Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("council_token"));
  const [user, setUser] = useState<string>(() => localStorage.getItem("council_user") || "");

  const tokenRef = useRef<string | null>(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const logout = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (currentToken) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${currentToken}` }
        });
      } catch (err: unknown) {
        console.error("Logout request failed", err);
      }
    }
    tokenRef.current = null;
    setToken(null);
    setUser("");
    localStorage.removeItem("council_token");
    localStorage.removeItem("council_user");
  }, []);

  const login = useCallback(async (emailOrToken: string, passwordOrUsername: string) => {
    // Try API login first
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: emailOrToken, password: passwordOrUsername }),
      });
      if (res.ok) {
        const data = await res.json();
        tokenRef.current = data.token;
        setToken(data.token);
        setUser(data.username || emailOrToken);
        localStorage.setItem("council_token", data.token);
        localStorage.setItem("council_user", data.username || emailOrToken);
        return;
      }
      const err = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(err.error || "Login failed");
    } catch (err: unknown) {
      // If it looks like a direct token call (non-email string), fall back to token-based login
      if (!emailOrToken.includes("@")) {
        tokenRef.current = emailOrToken;
        setToken(emailOrToken);
        setUser(passwordOrUsername);
        localStorage.setItem("council_token", emailOrToken);
        localStorage.setItem("council_user", passwordOrUsername);
        return;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }, []);

  const register = useCallback(async (username: string, _email: string, password: string) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Registration failed" }));
      throw new Error(err.error || "Registration failed");
    }
    const data = await res.json();
    tokenRef.current = data.token;
    setToken(data.token);
    setUser(data.username || username);
    localStorage.setItem("council_token", data.token);
    localStorage.setItem("council_user", data.username || username);
  }, []);

  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const fetchWithAuth = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    const currentToken = tokenRef.current;
    const headers = new Headers(options?.headers || {});
    
    if (currentToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${currentToken}`);
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      logoutRef.current();
    }

    return response;
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, fetchWithAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
