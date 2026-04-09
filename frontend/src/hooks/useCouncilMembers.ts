import { useState, useEffect } from "react";
import type { CouncilMember } from "../types/index.js";

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

export function useCouncilMembers() {
  const [members, setMembers] = useState<CouncilMember[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_MEMBERS;
    } catch {
      return DEFAULT_MEMBERS;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
  }, [members]);

  const addMember = () => {
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
  };

  const removeMember = (id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const updateMember = (id: string, updates: Partial<CouncilMember>) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
    );
  };

  return { members, setMembers, addMember, removeMember, updateMember };
}
