import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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
  addCustomModel: (model: Omit<CustomModel, "id">) => void;

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

  const addCustomModel = useCallback((model: Omit<CustomModel, "id">) => {
    setCustomModels((prev) => [
      ...prev,
      { ...model, id: `custom-model-${Date.now()}` },
    ]);
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
