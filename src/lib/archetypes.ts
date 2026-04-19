import { db } from "./drizzle.js";
import { userArchetypes } from "../db/schema/users.js";
import { chats } from "../db/schema/conversations.js";
import { eq, and, asc } from "drizzle-orm";
import { ARCHETYPES, Archetype } from "../config/archetypes.js";

export interface UserArchetypeInput {
  archetypeId?: string;
  name: string;
  thinkingStyle: string;
  asks: string;
  blindSpot: string;
  systemPrompt: string;
  tools?: string[];
  icon?: string;
  colorBg?: string;
  isActive?: boolean;
}

export async function getUserArchetypes(userId: number): Promise<Record<string, Archetype>> {
  const rows = await db.select().from(userArchetypes)
    .where(and(eq(userArchetypes.userId, userId), eq(userArchetypes.isActive, true)))
    .orderBy(asc(userArchetypes.createdAt));

  const customArchetypes: Record<string, Archetype> = {};

  for (const ua of rows) {
    customArchetypes[ua.archetypeId || `custom_${ua.id}`] = {
      id: ua.archetypeId || `custom_${ua.id}`,
      name: ua.name,
      thinkingStyle: ua.thinkingStyle,
      asks: ua.asks,
      blindSpot: ua.blindSpot,
      systemPrompt: ua.systemPrompt,
      tools: ua.tools,
      icon: ua.icon || undefined,
      colorBg: ua.colorBg || undefined
    };
  }

  return { ...ARCHETYPES, ...customArchetypes };
}

export async function upsertUserArchetype(
  userId: number,
  archetype: UserArchetypeInput,
  archetypeId?: string
): Promise<Archetype> {
  const aid = archetypeId || `custom_${Date.now()}`;
  const data = {
    userId,
    archetypeId: aid,
    name: archetype.name,
    thinkingStyle: archetype.thinkingStyle,
    asks: archetype.asks,
    blindSpot: archetype.blindSpot,
    systemPrompt: archetype.systemPrompt,
    tools: archetype.tools || [],
    icon: archetype.icon,
    colorBg: archetype.colorBg,
    isActive: archetype.isActive !== false,
    updatedAt: new Date()
  };

  const [result] = await db.insert(userArchetypes)
    .values({ ...data, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [userArchetypes.userId, userArchetypes.archetypeId],
      set: data
    })
    .returning();

  return {
    id: result.archetypeId,
    name: result.name,
    thinkingStyle: result.thinkingStyle,
    asks: result.asks,
    blindSpot: result.blindSpot,
    systemPrompt: result.systemPrompt,
    tools: result.tools,
    icon: result.icon || undefined,
    colorBg: result.colorBg || undefined
  };
}

export async function deleteUserArchetype(userId: number, archetypeId: string): Promise<void> {
  await db.delete(userArchetypes)
    .where(and(eq(userArchetypes.userId, userId), eq(userArchetypes.archetypeId, archetypeId)));
}

export async function toggleArchetypeStatus(userId: number, archetypeId: string): Promise<boolean> {
  const [archetype] = await db.select().from(userArchetypes)
    .where(and(eq(userArchetypes.userId, userId), eq(userArchetypes.archetypeId, archetypeId)))
    .limit(1);

  if (!archetype) return false;

  const [updated] = await db.update(userArchetypes)
    .set({ isActive: !archetype.isActive })
    .where(and(eq(userArchetypes.userId, userId), eq(userArchetypes.archetypeId, archetypeId)))
    .returning();

  return updated.isActive;
}

export function validateArchetype(data: UserArchetypeInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.name || data.name.trim().length < 2) {
    errors.push("Name must be at least 2 characters long");
  }

  if (!data.thinkingStyle || data.thinkingStyle.trim().length < 5) {
    errors.push("Thinking style must be at least 5 characters long");
  }

  if (!data.asks || data.asks.trim().length < 5) {
    errors.push("Asks field must be at least 5 characters long");
  }

  if (!data.blindSpot || data.blindSpot.trim().length < 5) {
    errors.push("Blind spot field must be at least 5 characters long");
  }

  if (!data.systemPrompt || data.systemPrompt.trim().length < 20) {
    errors.push("System prompt must be at least 20 characters long");
  }

  if (data.name && data.name.length > 100) {
    errors.push("Name must be less than 100 characters");
  }
  if (data.systemPrompt && data.systemPrompt.length > 5000) {
    errors.push("System prompt must be less than 5000 characters");
  }

  if (data.tools && Array.isArray(data.tools)) {
    const validTools = ["web_search", "execute_code", "read_webpage"];
    const invalidTools = data.tools.filter(tool => !validTools.includes(tool));
    if (invalidTools.length > 0) {
      errors.push(`Invalid tools: ${invalidTools.join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export async function getArchetypeUsage(userId: number): Promise<Record<string, number>> {
  const rows = await db.select({ opinions: chats.opinions, createdAt: chats.createdAt })
    .from(chats)
    .where(eq(chats.userId, userId));

  const usage: Record<string, number> = {};

  const now = Date.now();
  const halfLifeMs = 14 * 24 * 60 * 60 * 1000; // 14-day half-life

  for (const chat of rows) {
    const opinions = chat.opinions as { name: string }[] || [];
    // Recency weight: recent chats count more than old ones
    const ageMs = now - new Date(chat.createdAt).getTime();
    const weight = Math.pow(0.5, ageMs / halfLifeMs);

    for (const opinion of opinions) {
      const name = opinion.name;
      usage[name] = (usage[name] || 0) + weight;
    }
  }

  // Round to 2 decimal places for readability
  for (const key of Object.keys(usage)) {
    usage[key] = Math.round(usage[key] * 100) / 100;
  }

  return usage;
}

/**
 * Recommend archetypes for a user based on their engagement patterns.
 * Returns archetype IDs sorted by weighted usage (most engaged first).
 */
export function rankArchetypesByEngagement(
  usage: Record<string, number>,
): { id: string; name: string; score: number }[] {
  return Object.entries(ARCHETYPES)
    .map(([id, arch]) => ({
      id,
      name: arch.name,
      score: usage[arch.name] || 0,
    }))
    .sort((a, b) => b.score - a.score);
}

export function cloneDefaultArchetype(archetypeId: string): UserArchetypeInput {
  const defaultArchetype = ARCHETYPES[archetypeId];
  if (!defaultArchetype) {
    throw new Error(`Default archetype '${archetypeId}' not found`);
  }

  return {
    name: `Custom ${defaultArchetype.name}`,
    thinkingStyle: defaultArchetype.thinkingStyle,
    asks: defaultArchetype.asks,
    blindSpot: defaultArchetype.blindSpot,
    systemPrompt: defaultArchetype.systemPrompt,
    tools: defaultArchetype.tools || [],
    icon: defaultArchetype.icon,
    colorBg: defaultArchetype.colorBg
  };
}

export async function exportUserArchetypes(userId: number): Promise<string> {
  const archetypes = await db.select().from(userArchetypes)
    .where(eq(userArchetypes.userId, userId))
    .orderBy(asc(userArchetypes.createdAt));

  return JSON.stringify(archetypes, null, 2);
}

export async function importArchetypes(userId: number, jsonData: string): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;

  try {
    const data = JSON.parse(jsonData);

    if (!Array.isArray(data)) {
      errors.push("Invalid format: expected array of archetypes");
      return { imported, errors };
    }

    for (const item of data) {
      try {
        const validation = validateArchetype(item);
        if (!validation.valid) {
          errors.push(`Archetype "${item.name || 'unknown'}": ${validation.errors.join(", ")}`);
          continue;
        }

        await upsertUserArchetype(userId, item, item.archetypeId);
        imported++;
      } catch (err) {
        errors.push(`Failed to import archetype "${item.name || 'unknown'}": ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`Failed to parse JSON: ${(err as Error).message}`);
  }

  return { imported, errors };
}
