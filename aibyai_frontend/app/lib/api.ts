import { fetchWithAuth, getToken } from "./auth";
import { MOCK_DATA } from "./mock-data";

const API_BASE =
  typeof window !== "undefined"
    ? ((window as Record<string, unknown>).__API_BASE__ as string) || "/api"
    : "/api";

function isDemoMode(): boolean {
  return typeof window !== "undefined" && getToken() === "demo-token-preview-only";
}

function getMockResponse(path: string): unknown | null {
  const cleanPath = path.split("?")[0];
  for (const [pattern, data] of Object.entries(MOCK_DATA)) {
    const regex = new RegExp("^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$");
    if (regex.test(cleanPath)) return data;
  }
  return null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  // Demo mode: return mock data instead of hitting backend
  if (isDemoMode() && method === "GET") {
    const mock = getMockResponse(path);
    if (mock !== null) return mock as T;
  }

  const url = `${API_BASE}${path}`;
  const options: RequestInit = { method };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetchWithAuth(url, options);

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message =
      (errorBody as Record<string, string>).message ??
      (errorBody as Record<string, string>).error ??
      `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
