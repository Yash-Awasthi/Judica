import { db } from "../lib/drizzle.js";
import { sharedFacts } from "../db/schema/council.js";
import { eq, asc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { routeAndCollect } from "../router/index.js";

export interface SharedFactData {
  id: string;
  conversationId: string;
  content: string;
  sourceAgent: string;
  type: string;
  confidence: number;
  confirmedBy: string[];
  disputedBy: string[];
  createdAt: Date;
}

// P8-24: Validate that conversationId belongs to the requesting user
// This is checked at the service layer before calling these functions.
// Adding a comment to document the contract: callers MUST verify ownership
// via conversationService.findConversationById(conversationId, userId)
// before invoking addFact, getFacts, extractAndStoreFacts.

export async function addFact(
  conversationId: string,
  content: string,
  sourceAgent: string,
  type: "fact" | "decision" | "assumption" | "contradiction",
  confidence: number
): Promise<SharedFactData> {
  const [fact] = await db.insert(sharedFacts).values({
    id: randomUUID(),
    conversationId,
    content,
    sourceAgent,
    type,
    confidence: Math.min(1, Math.max(0, confidence)),
    confirmedBy: [sourceAgent],
    disputedBy: [],
  }).returning();
  return fact as SharedFactData;
}

export async function getFacts(conversationId: string): Promise<SharedFactData[]> {
  const facts = await db
    .select()
    .from(sharedFacts)
    .where(eq(sharedFacts.conversationId, conversationId))
    .orderBy(asc(sharedFacts.createdAt))
    .limit(500);
  return facts as SharedFactData[];
}

// P8-23: Use atomic SQL array operations to prevent race conditions
export async function confirmFact(factId: string, agentId: string): Promise<void> {
  // Check if fact exists first
  const [existing] = await db
    .select()
    .from(sharedFacts)
    .where(eq(sharedFacts.id, factId));
  if (!existing) return;

  // Atomically add to confirmedBy and remove from disputedBy
  await db
    .update(sharedFacts)
    .set({
      confirmedBy: sql`array_append(array_remove(${sharedFacts.confirmedBy}, ${agentId}), ${agentId})`,
      disputedBy: sql`array_remove(${sharedFacts.disputedBy}, ${agentId})`,
    })
    .where(eq(sharedFacts.id, factId));
}

// P8-23: Use atomic SQL array operations to prevent race conditions
export async function disputeFact(factId: string, agentId: string): Promise<void> {
  // Check if fact exists first
  const [existing] = await db
    .select()
    .from(sharedFacts)
    .where(eq(sharedFacts.id, factId));
  if (!existing) return;

  await db
    .update(sharedFacts)
    .set({
      disputedBy: sql`array_append(array_remove(${sharedFacts.disputedBy}, ${agentId}), ${agentId})`,
      confirmedBy: sql`array_remove(${sharedFacts.confirmedBy}, ${agentId})`,
    })
    .where(eq(sharedFacts.id, factId));
}

export async function getFactContext(conversationId: string): Promise<string> {
  const facts = await getFacts(conversationId);
  if (facts.length === 0) return "";

  const lines = facts.map((f) => {
    const status =
      f.disputedBy.length > 0
        ? ` [DISPUTED by ${f.disputedBy.length}]`
        : f.confirmedBy.length > 1
          ? ` [CONFIRMED by ${f.confirmedBy.length}]`
          : "";
    return `- [${f.type.toUpperCase()}] (${Math.round(f.confidence * 100)}%) ${f.content}${status}`;
  });

  return `[SHARED FACTS]\n${lines.join("\n")}\n[/SHARED FACTS]`;
}

export async function extractAndStoreFacts(
  conversationId: string,
  agentId: string,
  responseText: string,
  userId?: number
): Promise<SharedFactData[]> {
  // P8-25: Pass userId so LLM calls are attributed to user's quota
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Extract key factual claims from this text. Return a JSON array of objects with "content", "type" (fact/decision/assumption), and "confidence" (0.0-1.0). Only return the JSON array.\n\nText: "${responseText.substring(0, 2000)}"`,
      },
    ],
    temperature: 0,
  }, { userId });

  try {
    const match = result.text.match(/\[[\s\S]*\]/);
    if (!match || match[0].length > 10_000) return []; // Cap parsed JSON size
    const claims = JSON.parse(match[0]) as Array<{
      content: string;
      type: string;
      confidence: number;
    }>;

    const validTypes = ["fact", "decision", "assumption", "contradiction"] as const;
    const stored: SharedFactData[] = [];
    for (const claim of claims.slice(0, 5)) {
      const claimType = validTypes.includes(claim.type as typeof validTypes[number]) ? claim.type as typeof validTypes[number] : "fact";
      const fact = await addFact(
        conversationId,
        claim.content,
        agentId,
        claimType,
        claim.confidence ?? 0.7
      );
      stored.push(fact);
    }
    return stored;
  } catch {
    return [];
  }
}
