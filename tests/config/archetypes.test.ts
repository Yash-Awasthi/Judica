import { describe, it, expect } from "vitest";
import {
  ARCHETYPES,
  SUMMONS,
  COUNCIL_TEMPLATES,
  UNIVERSAL_PROMPT,
} from "../../src/config/archetypes.js";
import type { Archetype, CouncilTemplate } from "../../src/config/archetypes.js";

describe("archetypes config", () => {
  const expectedArchetypeKeys = [
    "architect", "contrarian", "empiricist", "ethicist", "futurist",
    "pragmatist", "historian", "empath", "outsider", "strategist",
    "minimalist", "creator", "judge", "devils_advocate",
  ];

  describe("ARCHETYPES", () => {
    it("has all expected keys", () => {
      for (const key of expectedArchetypeKeys) {
        expect(ARCHETYPES).toHaveProperty(key);
      }
      expect(Object.keys(ARCHETYPES)).toHaveLength(expectedArchetypeKeys.length);
    });

    it("each archetype has required fields: id, name, thinkingStyle, asks, blindSpot, systemPrompt", () => {
      const requiredFields: (keyof Archetype)[] = [
        "id", "name", "thinkingStyle", "asks", "blindSpot", "systemPrompt",
      ];
      for (const [key, archetype] of Object.entries(ARCHETYPES)) {
        for (const field of requiredFields) {
          expect(archetype[field], `${key} missing ${field}`).toBeDefined();
          expect(typeof archetype[field], `${key}.${field} should be string`).toBe("string");
        }
      }
    });

    it("archetype ids match their keys", () => {
      for (const [key, archetype] of Object.entries(ARCHETYPES)) {
        expect(archetype.id, `archetype key "${key}" id mismatch`).toBe(key);
      }
    });

    it("archetypes with tools have valid tool arrays", () => {
      for (const [key, archetype] of Object.entries(ARCHETYPES)) {
        if (archetype.tools !== undefined) {
          expect(Array.isArray(archetype.tools), `${key}.tools should be array`).toBe(true);
          expect(archetype.tools.length, `${key}.tools should not be empty`).toBeGreaterThan(0);
          for (const tool of archetype.tools) {
            expect(typeof tool).toBe("string");
          }
        }
      }
    });
  });

  describe("SUMMONS", () => {
    const expectedCategories = [
      "debate", "research", "business", "technical",
      "personal", "creative", "ethical", "strategy", "default",
    ];

    it("has expected categories", () => {
      for (const cat of expectedCategories) {
        expect(SUMMONS).toHaveProperty(cat);
      }
      expect(Object.keys(SUMMONS)).toHaveLength(expectedCategories.length);
    });

    it("each array contains only valid archetype ids", () => {
      const validIds = Object.keys(ARCHETYPES);
      for (const [category, members] of Object.entries(SUMMONS)) {
        for (const id of members) {
          expect(validIds, `SUMMONS.${category} contains invalid id "${id}"`).toContain(id);
        }
      }
    });

    it("arrays do not contain duplicates", () => {
      for (const [category, members] of Object.entries(SUMMONS)) {
        const unique = new Set(members);
        expect(unique.size, `SUMMONS.${category} has duplicates`).toBe(members.length);
      }
    });

    it("all categories have exactly 5 members", () => {
      for (const [category, members] of Object.entries(SUMMONS)) {
        expect(members.length, `SUMMONS.${category} should have 5 members`).toBe(5);
      }
    });
  });

  describe("COUNCIL_TEMPLATES", () => {
    const expectedTemplateKeys = ["debate", "research", "technical", "creative"];

    it("has expected keys", () => {
      for (const key of expectedTemplateKeys) {
        expect(COUNCIL_TEMPLATES).toHaveProperty(key);
      }
      expect(Object.keys(COUNCIL_TEMPLATES)).toHaveLength(expectedTemplateKeys.length);
    });

    it("each template has id, name, masterPrompt, and memberPrompts array", () => {
      for (const [key, template] of Object.entries(COUNCIL_TEMPLATES)) {
        expect(template.id, `${key} missing id`).toBeTypeOf("string");
        expect(template.name, `${key} missing name`).toBeTypeOf("string");
        expect(template.masterPrompt, `${key} missing masterPrompt`).toBeTypeOf("string");
        expect(Array.isArray(template.memberPrompts), `${key}.memberPrompts should be array`).toBe(true);
        expect(template.memberPrompts.length, `${key}.memberPrompts should not be empty`).toBeGreaterThan(0);
      }
    });

    it("template ids match their keys", () => {
      for (const [key, template] of Object.entries(COUNCIL_TEMPLATES)) {
        expect(template.id, `template key "${key}" id mismatch`).toBe(key);
      }
    });
  });

  describe("UNIVERSAL_PROMPT", () => {
    it("is a non-empty string", () => {
      expect(typeof UNIVERSAL_PROMPT).toBe("string");
      expect(UNIVERSAL_PROMPT.length).toBeGreaterThan(0);
    });
  });
});
