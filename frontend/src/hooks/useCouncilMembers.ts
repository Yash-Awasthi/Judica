import { useState, useEffect, useCallback, useRef } from "react";
import type { CouncilMember } from "../types/index.js";
import { useAuth } from "../context/AuthContext.js";

const DEFAULT_MEMBERS: CouncilMember[] = [
  {
    id: "1",
    name: "The Architect",
    type: "openai-compat",
    apiKey: "",
    model: "mistral-large-latest",
    baseUrl: "https://api.mistral.ai/v1",
    active: true,
    role: "Expert",
    tone: "Academic",
    customBehaviour: "",
  },
  {
    id: "2",
    name: "The Contrarian",
    type: "openai-compat",
    apiKey: "",
    model: "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai/v1",
    active: true,
    role: "Devil's Advocate",
    tone: "Blunt",
    customBehaviour: "",
  },
  {
    id: "3",
    name: "The Pragmatist",
    type: "openai-compat",
    apiKey: "",
    model: "mistral-small-latest",
    baseUrl: "https://api.mistral.ai/v1",
    active: true,
    role: "Pragmatist",
    tone: "Concise",
    customBehaviour: "",
  },
  {
    id: "4",
    name: "The Summarizer",
    type: "openai-compat",
    apiKey: "",
    model: "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai/v1",
    active: true,
    role: "Critic",
    tone: "Concise",
    customBehaviour:
      "You are an Unbiased Summarizer. Provide a completely neutral, objective summary of the debate. Do not invent new arguments.",
  },
];

const STORAGE_KEY = "council_members";

// Strip sensitive data for localStorage storage
function stripSensitiveData(members: CouncilMember[]): CouncilMember[] {
  return members.map(m => ({
    ...m,
    apiKey: "", // Never store API keys in localStorage
  }));
}

// Mask an API key for display: "sk-abc...xyz" -> "sk-a****xyz"
export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return key ? "********" : "";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

export function useCouncilMembers() {
  const { token, fetchWithAuth } = useAuth();
  const [members, setMembers] = useState<CouncilMember[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_MEMBERS;
    } catch {
      return DEFAULT_MEMBERS;
    }
  });
  const [serverKeysLoaded, setServerKeysLoaded] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load server-side config (with API keys) on mount
  useEffect(() => {
    if (!token) return;
    fetchWithAuth("/api/auth/config")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.members && Array.isArray(data.members)) {
          setMembers(prev => {
            // Merge server-side API keys into local member state
            const serverMap = new Map<string, CouncilMember>(data.members.map((m: CouncilMember) => [m.id, m]));
            return prev.map(local => {
              const server = serverMap.get(local.id);
              if (server?.apiKey) {
                return { ...local, apiKey: server.apiKey };
              }
              return local;
            });
          });
        }
        setServerKeysLoaded(true);
      })
      .catch(() => setServerKeysLoaded(true));
  }, [token, fetchWithAuth]);

  // Save to localStorage (stripped) and server (full) when members change
  useEffect(() => {
    // Save stripped version to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripSensitiveData(members)));

    // Debounced save to server
    if (token && serverKeysLoaded) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        fetchWithAuth("/api/auth/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { members } }),
        }).catch(() => { /* best effort */ });
      }, 1000);
    }
  }, [members, token, fetchWithAuth, serverKeysLoaded]);

  const addMember = useCallback(() => {
    setMembers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: `Member ${prev.length + 1}`,
        type: "openai-compat",
        apiKey: "",
        model: "gpt-4o",
        active: true,
        role: "Default",
        tone: "Concise",
        customBehaviour: "",
      },
    ]);
  }, []);

  const removeMember = useCallback((id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const updateMember = useCallback((id: string, updates: Partial<CouncilMember>) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
    );
  }, []);

  return { members, setMembers, addMember, removeMember, updateMember, maskApiKey };
}
