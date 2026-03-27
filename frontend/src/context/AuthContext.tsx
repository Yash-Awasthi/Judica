import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";

interface AuthContextType {
  user: string;
  token: string | null;
  login: (token: string, username: string) => void;
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

  const tokenRef = useRef(token);
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
      } catch (err) {
        console.error("Logout request failed", err);
      }
    }
    setToken(null);
    setUser("");
    localStorage.removeItem("council_token");
    localStorage.removeItem("council_user");
  }, []);

  const login = useCallback((newToken: string, username: string) => {
    setToken(newToken);
    setUser(username);
    localStorage.setItem("council_token", newToken);
    localStorage.setItem("council_user", username);
  }, []);

  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  const fetchWithAuth = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    const currentToken = tokenRef.current;
    const headers = new Headers(options?.headers || {});
    
    if (currentToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${currentToken}`);
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      if (logoutRef.current) {
         logoutRef.current();
      }
    }

    return response;
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, fetchWithAuth }}>
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
