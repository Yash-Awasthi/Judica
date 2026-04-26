/**
 * Self-Editing Memory — Phase 2.13
 *
 * The council can actively modify its own memory blocks mid-conversation:
 * - Promote a fact to long-term
 * - Demote something it was wrong about
 * - Merge two contradictory memories
 * - Delete a stale entry
 *
 * Not just passive storage — the agent manages its own memory like an OS manages RAM.
 *
 * Inspired by:
 * - Letta / MemGPT (Apache 2.0, letta-ai/letta) — self-editing memory with
 *   core/archival/recall blocks managed by the agent itself
 *
 * Implementation:
 * - Agent outputs memory edit actions in a structured format (JSON in response)
 * - Post-synthesis pass parses and executes these actions on memoryFacts
 * - Actions: promote, demote, merge, delete, upsert
 */

import { db } from "./drizzle.js";
import { memoryFacts } from "../db/schema/memoryFacts.js";
import { memoryTriples } from "../db/schema/memoryTriples.js";
import { eq, and, ilike } from "drizzle-orm";

export type MemoryEditAction =
  | { op: "upsert";  fact: string; conversationId?: string }
  | { op: "promote"; factId: number }
  | { op: "demote";  factId: number }
  | { op: "delete";  factId: number }
  | { op: "merge";   factId: number; intoFactId: number }

/** Parse memory edit actions embedded in agent response text. */
export function parseMemoryEdits(responseText: string): MemoryEditAction[] {
  // Agents can embed actions in a special XML-like block: <memory-edit>JSON</memory-edit>
  const matches = responseText.matchAll(/<memory-edit>([\s\S]*?)<\/memory-edit>/g);
  const actions: MemoryEditAction[] = [];

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item.op && typeof item.op === "string") {
          actions.push(item as MemoryEditAction);
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return actions;
}

/** Execute a batch of memory edit actions for a given user. */
export async function executeMemoryEdits(
  userId: number,
  actions: MemoryEditAction[],
  conversationId?: string,
): Promise<{ executed: number; errors: string[] }> {
  let executed = 0;
  const errors: string[] = [];

  for (const action of actions) {
    try {
      switch (action.op) {
        case "upsert": {
          // Insert new fact or update if same text exists
          const [existing] = await db
            .select({ id: memoryFacts.id })
            .from(memoryFacts)
            .where(and(eq(memoryFacts.userId, userId), ilike(memoryFacts.fact, action.fact)))
            .limit(1);

          if (existing) {
            await db.update(memoryFacts)
              .set({ decayScore: 1.0 })
              .where(eq(memoryFacts.id, existing.id));
          } else {
            await db.insert(memoryFacts).values({
              userId,
              fact: action.fact,
              conversationId: action.conversationId ?? conversationId ?? null,
              decayScore: 1.0,
            });
          }
          break;
        }

        case "promote": {
          await db.update(memoryFacts)
            .set({ decayScore: 1.0, scope: "global" } as any)
            .where(and(eq(memoryFacts.id, action.factId), eq(memoryFacts.userId, userId)));
          break;
        }

        case "demote": {
          await db.update(memoryFacts)
            .set({ decayScore: 0.1 })
            .where(and(eq(memoryFacts.id, action.factId), eq(memoryFacts.userId, userId)));
          break;
        }

        case "delete": {
          await db.delete(memoryFacts)
            .where(and(eq(memoryFacts.id, action.factId), eq(memoryFacts.userId, userId)));
          break;
        }

        case "merge": {
          // Copy content from factId into intoFactId, then delete factId
          const [source] = await db
            .select({ fact: memoryFacts.fact })
            .from(memoryFacts)
            .where(and(eq(memoryFacts.id, action.factId), eq(memoryFacts.userId, userId)))
            .limit(1);

          if (source) {
            const [target] = await db
              .select({ fact: memoryFacts.fact })
              .from(memoryFacts)
              .where(and(eq(memoryFacts.id, action.intoFactId), eq(memoryFacts.userId, userId)))
              .limit(1);

            if (target) {
              const merged = `${target.fact} | ${source.fact}`;
              await db.update(memoryFacts)
                .set({ fact: merged, decayScore: 1.0 })
                .where(eq(memoryFacts.id, action.intoFactId));
              await db.delete(memoryFacts)
                .where(eq(memoryFacts.id, action.factId));
            }
          }
          break;
        }
      }
      executed++;
    } catch (err) {
      errors.push(`${action.op}: ${(err as Error).message}`);
    }
  }

  return { executed, errors };
}

/**
 * Post-synthesis memory edit hook.
 * Call after each council response to apply any embedded memory edit actions.
 */
export async function applyPostSynthesisMemoryEdits(
  userId: number,
  verdictText: string,
  conversationId?: string,
): Promise<void> {
  const actions = parseMemoryEdits(verdictText);
  if (actions.length === 0) return;
  await executeMemoryEdits(userId, actions, conversationId);
}
