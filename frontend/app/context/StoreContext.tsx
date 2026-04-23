import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CustomModel {
  id: string;
  label: string;
  apiUrl: string;
  apiKey?: string;
}

export interface CustomArchetype {
  id: string;
  name: string;
  icon: string;
  color: string;
  thinkingStyle: string;
  description: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
}

// ─── Built-in models (always available) ─────────────────────────────────────

const BUILTIN_MODELS = [
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "llama-3.3-70b", label: "Llama 3.3 70B" },
];

// ─── Context ────────────────────────────────────────────────────────────────

interface StoreContextType {
  // Models
  builtinModels: typeof BUILTIN_MODELS;
  customModels: CustomModel[];
  allModels: { id: string; label: string }[];
  addCustomModel: (model: Omit<CustomModel, "id">) => string;

  // Archetypes
  customArchetypes: CustomArchetype[];
  addCustomArchetype: (arch: Omit<CustomArchetype, "id">) => void;
  updateArchetype: (id: string, data: Partial<CustomArchetype>) => void;
  removeArchetype: (id: string) => void;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [customArchetypes, setCustomArchetypes] = useState<CustomArchetype[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("aibyai_custom_archetypes");
      if (saved) setCustomArchetypes(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("aibyai_custom_models");
      if (saved) setCustomModels(JSON.parse(saved));
    } catch {}
  }, []);

  // Persist to localStorage on change
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("aibyai_custom_archetypes", JSON.stringify(customArchetypes));
  }, [customArchetypes]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("aibyai_custom_models", JSON.stringify(customModels));
  }, [customModels]);

  const addCustomModel = useCallback((model: Omit<CustomModel, "id">) => {
    const id = `custom-model-${Date.now()}`;
    setCustomModels((prev) => [
      ...prev,
      { ...model, id },
    ]);
    return id;
  }, []);

  const allModels = [
    ...BUILTIN_MODELS,
    ...customModels.map((m) => ({ id: m.id, label: m.label })),
  ];

  const addCustomArchetype = useCallback((arch: Omit<CustomArchetype, "id">) => {
    setCustomArchetypes((prev) => [
      ...prev,
      { ...arch, id: `custom-arch-${Date.now()}` },
    ]);
  }, []);

  const updateArchetype = useCallback((id: string, data: Partial<CustomArchetype>) => {
    setCustomArchetypes((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...data } : a))
    );
  }, []);

  const removeArchetype = useCallback((id: string) => {
    setCustomArchetypes((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <StoreContext.Provider
      value={{
        builtinModels: BUILTIN_MODELS,
        customModels,
        allModels,
        addCustomModel,
        customArchetypes,
        addCustomArchetype,
        updateArchetype,
        removeArchetype,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
