import { db } from "../lib/drizzle.js";
import { sharedFacts } from "../db/schema/council.js";
import { eq, asc } from "drizzle-orm";
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
    .orderBy(asc(sharedFacts.createdAt));
  return facts as SharedFactData[];
}

export async function confirmFact(factId: string, agentId: string): Promise<void> {
  const [fact] = await db
    .select()
    .from(sharedFacts)
    .where(eq(sharedFacts.id, factId));
  if (!fact) return;

  const confirmed = Array.from(new Set([...fact.confirmedBy, agentId]));
  const disputed = fact.disputedBy.filter((id) => id !== agentId);

  await db
    .update(sharedFacts)
    .set({ confirmedBy: confirmed, disputedBy: disputed })
    .where(eq(sharedFacts.id, factId));
}

export async function disputeFact(factId: string, agentId: string): Promise<void> {
  const [fact] = await db
    .select()
    .from(sharedFacts)
    .where(eq(sharedFacts.id, factId));
  if (!fact) return;

  const disputed = Array.from(new Set([...fact.disputedBy, agentId]));
  const confirmed = fact.confirmedBy.filter((id) => id !== agentId);

  await db
    .update(sharedFacts)
    .set({ confirmedBy: confirmed, disputedBy: disputed })
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
  responseText: string
): Promise<SharedFactData[]> {
  const result = await routeAndCollect({
    model: "auto",
    messages: [
      {
        role: "user",
        content: `Extract key factual claims from this text. Return a JSON array of objects with "content", "type" (fact/decision/assumption), and "confidence" (0.0-1.0). Only return the JSON array.\n\nText: "${responseText.substring(0, 2000)}"`,
      },
    ],
    temperature: 0,
  });

  try {
    const match = result.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
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
