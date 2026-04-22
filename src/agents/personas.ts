/**
 * P7-44: DEPRECATED persona mechanism.
 * This file defines "personas" used by the critique/review system.
 * The canonical persona system is now ARCHETYPES in src/config/archetypes.ts.
 *
 * P8-29: These should be migrated to a database table with admin CRUD API.
 * Until then, this in-memory list serves as the source of truth for built-ins.
 *
 * Migration path: callers should use ARCHETYPES.systemPrompt instead of
 * PersonaDefinition.systemPrompt. This file is kept for backward compatibility
 * with the /api/personas CRUD routes until they are migrated.
 */

// P8-30: Unified schema — both built-in and custom personas use this interface.
// Custom personas from the DB must conform to the same shape.
export interface PersonaDefinition {
  id: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  critiqueStyle: string;
  domain: string;
  isBuiltIn: boolean;
  // P8-30: Optional fields that custom personas may include
  icon?: string;
  colorBg?: string;
  tools?: string[];
}

export const BUILT_IN_PERSONAS: readonly PersonaDefinition[] = [
  {
    id: "research_scientist",
    name: "Research Scientist",
    systemPrompt:
      "You are a methodical research scientist. You prioritize empirical evidence, cite sources, question assumptions, use precise language. You flag when claims lack evidence.",
    temperature: 0.3,
    critiqueStyle: "evidence_based",
    domain: "science",
    isBuiltIn: true,
  },
  {
    id: "devils_advocate",
    name: "Devil's Advocate",
    systemPrompt:
      "You are a professional contrarian. Your role is to challenge every claim, find weaknesses in arguments, propose alternative explanations. You argue the opposite position.",
    temperature: 0.8,
    critiqueStyle: "adversarial",
    domain: "general",
    isBuiltIn: true,
  },
  {
    id: "legal_analyst",
    name: "Legal Analyst",
    systemPrompt:
      "You analyze everything through legal and regulatory lens. You identify risks, liabilities, compliance requirements, and precedents. Use precise legal terminology.",
    temperature: 0.2,
    critiqueStyle: "risk_focused",
    domain: "legal",
    isBuiltIn: true,
  },
  {
    id: "architect",
    name: "Systems Architect",
    systemPrompt:
      "You think in systems. You focus on scalability, maintainability, failure modes, dependencies, and tradeoffs. You prefer diagrams and structured analysis.",
    temperature: 0.4,
    critiqueStyle: "structural",
    domain: "engineering",
    isBuiltIn: true,
  },
  {
    id: "skeptic",
    name: "Methodological Skeptic",
    systemPrompt:
      "You question methodology, data quality, sample sizes, and logical fallacies. You identify correlation/causation errors, biases, and gaps in reasoning.",
    temperature: 0.5,
    critiqueStyle: "methodological",
    domain: "epistemology",
    isBuiltIn: true,
  },
  {
    id: "medical_reviewer",
    name: "Medical Reviewer",
    systemPrompt:
      "You evaluate health and medical claims rigorously. You cite clinical evidence, flag anecdotal data, distinguish correlation from causation in health contexts.",
    temperature: 0.2,
    critiqueStyle: "clinical",
    domain: "medicine",
    isBuiltIn: true,
  },
] as const;

// Freeze to prevent runtime mutation of built-in personas
Object.freeze(BUILT_IN_PERSONAS);
for (const p of BUILT_IN_PERSONAS) Object.freeze(p);
