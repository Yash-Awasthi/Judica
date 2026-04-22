export interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "member" | "viewer";
}

export interface AuthState {
  user: User | null;
  token: string | null;
}

const TOKEN_KEY = "aibyai_token";
const USER_KEY = "aibyai_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function removeUser(): void {
  localStorage.removeItem(USER_KEY);
}

export function clearAuth(): void {
  removeToken();
  removeUser();
}

const API_BASE =
  typeof window !== "undefined"
    ? ((window as Record<string, unknown>).__API_BASE__ as string) || "/api"
    : "/api";

async function refreshToken(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.token) {
      setToken(data.token);
      return data.token;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && token) {
    const newToken = await refreshToken();
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      return fetch(url, { ...options, headers, credentials: "include" });
    }
    clearAuth();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }

  return res;
}
