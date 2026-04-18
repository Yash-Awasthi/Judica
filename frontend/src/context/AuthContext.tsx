import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";

interface AuthContextType {
  user: string;
  role: string;
  token: string | null;
  login: (emailOrToken: string, password: string) => void | Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  loginWithGoogle: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<string>(() => localStorage.getItem("council_user") || "");
  const [role, setRole] = useState<string>(() => localStorage.getItem("council_role") || "viewer");

  const tokenRef = useRef<string | null>(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (user && !token) {
      fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.token) {
            tokenRef.current = data.token;
            setToken(data.token);
            setUser(data.username || user);
            setRole(data.role || "viewer");
            localStorage.setItem("council_role", data.role || "viewer");
          }
        })
        .catch(() => { /* no valid refresh token */ });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {},
      });
    } catch (err: unknown) {
      console.error("Logout request failed", err);
    }
    tokenRef.current = null;
    setToken(null);
    setUser("");
    setRole("viewer");
    localStorage.removeItem("council_user");
    localStorage.removeItem("council_role");
    localStorage.removeItem("council_token");
  }, []);

  const login = useCallback(async (emailOrToken: string, passwordOrUsername: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: emailOrToken, password: passwordOrUsername }),
      });
      if (res.ok) {
        const data = await res.json();
        tokenRef.current = data.token;
        setToken(data.token);
        setUser(data.username || emailOrToken);
        setRole(data.role || "viewer");
        localStorage.setItem("council_user", data.username || emailOrToken);
        localStorage.setItem("council_role", data.role || "viewer");
        return;
      }
      const err = await res.json().catch(() => ({ error: "Login failed" }));
      throw new Error(err.error || "Login failed");
    } catch (err: unknown) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
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
    setRole(data.role || "viewer");
    localStorage.setItem("council_user", data.username || username);
    localStorage.setItem("council_role", data.role || "viewer");
  }, []);

  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const fetchWithAuth = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    const currentToken = tokenRef.current;
    const headers = new Headers(options?.headers || {});

    if (currentToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${currentToken}`);
    }

    const response = await fetch(url, { ...options, headers, credentials: "include" });

    if (response.status === 401) {
      const refreshRes = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        tokenRef.current = data.token;
        setToken(data.token);
        setRole(data.role || "viewer");
        localStorage.setItem("council_role", data.role || "viewer");
        const retryHeaders = new Headers(options?.headers || {});
        retryHeaders.set("Authorization", `Bearer ${data.token}`);
        return fetch(url, { ...options, headers: retryHeaders, credentials: "include" });
      }
      logoutRef.current();
    }

    return response;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    return new Promise<void>((resolve, reject) => {
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        "/api/auth/google",
        "google-login",
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        reject(new Error("Popup blocked"));
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        
        const { type, token: newToken, username: newUsername, role: newRole, error } = event.data;
        
        if (type === "AUTH_SUCCESS") {
          tokenRef.current = newToken;
          setToken(newToken);
          setUser(newUsername);
          setRole(newRole || "viewer");
          localStorage.setItem("council_user", newUsername);
          localStorage.setItem("council_role", newRole || "viewer");
          window.removeEventListener("message", handleMessage);
          resolve();
        } else if (type === "AUTH_ERROR") {
          window.removeEventListener("message", handleMessage);
          reject(new Error(error || "Google login failed"));
        }
      };

      window.addEventListener("message", handleMessage);

      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          window.removeEventListener("message", handleMessage);
          setTimeout(() => reject(new Error("Login cancelled")), 100);
        }
      }, 1000);
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, token, login, register, logout, fetchWithAuth, loginWithGoogle }}>
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
