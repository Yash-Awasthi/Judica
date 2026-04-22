import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  type User,
  getToken,
  setToken,
  removeToken,
  getUser,
  setUser as storeUser,
  removeUser,
  clearAuth,
} from "~/lib/auth";
import { api } from "~/lib/api";

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  register(username: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = getToken();
    const storedUser = getUser();
    if (storedToken && storedUser) {
      setTokenState(storedToken);
      setUser(storedUser);
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>(
      "/auth/login",
      { username, password }
    );
    setToken(data.token);
    storeUser(data.user);
    setTokenState(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const data = await api.post<{ token: string; user: User }>(
        "/auth/register",
        { username, email, password }
      );
      setToken(data.token);
      storeUser(data.user);
      setTokenState(data.token);
      setUser(data.user);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // continue logout even if API fails
    }
    clearAuth();
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
