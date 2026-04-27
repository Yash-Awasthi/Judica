/**
 * CLI API Client — handles HTTP requests to the judica server.
 */

import { getConfig } from "./config.js";

export class ApiClient {
  private baseUrl: string;
  private token: string | null;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.get("serverUrl") as string ?? "http://localhost:3000";
    this.token = config.get("token") as string ?? null;
  }

  async get<T>(path: string): Promise<T> {
    return this.request("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request("POST", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request("DELETE", path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const error = await resp.json().catch(() => ({ error: resp.statusText })) as Record<string, unknown>;
      throw new Error((error.error as string) ?? `API error: ${resp.status}`);
    }

    if (resp.status === 204) return {} as T;
    return resp.json() as Promise<T>;
  }

  get isAuthenticated(): boolean {
    return !!this.token;
  }
}
