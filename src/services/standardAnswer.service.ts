/**
 * Standard Answers — Service
 *
 * CRUD operations for standard answers + query matching.
 */

import { db } from "../lib/drizzle.js";
import { standardAnswers, standardAnswerRules } from "../db/schema/standardAnswers.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { StandardAnswer, MatchRule, MatchResult, StandardAnswerConfig } from "../lib/standardAnswers/models.js";
import { findBestStandardAnswer, DEFAULT_STANDARD_ANSWER_CONFIG } from "../lib/standardAnswers/index.js";

/** Create a new standard answer with rules. */
export async function createStandardAnswer(
  data: {
    title: string;
    answer: string;
    categories?: string[];
    priority?: number;
    rules: Array<{ type: "keyword" | "regex" | "semantic"; value: string; threshold?: number; matchAll?: boolean }>;
  },
  userId: number,
): Promise<{ id: string }> {
  const answerId = randomUUID();
  const now = new Date();

  await db.insert(standardAnswers).values({
    id: answerId,
    title: data.title,
    answer: data.answer,
    categories: data.categories || [],
    priority: data.priority || 0,
    createdBy: userId,
    updatedAt: now,
  });

  if (data.rules.length > 0) {
    await db.insert(standardAnswerRules).values(
      data.rules.map((r) => ({
        id: randomUUID(),
        answerId,
        type: r.type,
        value: r.value,
        threshold: Math.round((r.threshold || 0.8) * 100),
        matchAll: r.matchAll || false,
      })),
    );
  }

  return { id: answerId };
}

/** List all standard answers with their rules. */
export async function listStandardAnswers(): Promise<StandardAnswer[]> {
  const answers = await db.select().from(standardAnswers).orderBy(standardAnswers.priority);
  const rules = await db.select().from(standardAnswerRules);

  const rulesByAnswer = new Map<string, MatchRule[]>();
  for (const r of rules) {
    const list = rulesByAnswer.get(r.answerId) || [];
    list.push({
      id: r.id,
      type: r.type,
      value: r.value,
      threshold: r.threshold / 100,
      matchAll: r.matchAll,
    });
    rulesByAnswer.set(r.answerId, list);
  }

  return answers.map((a) => ({
    id: a.id,
    title: a.title,
    answer: a.answer,
    enabled: a.enabled,
    rules: rulesByAnswer.get(a.id) || [],
    categories: (a.categories as string[]) || [],
    priority: a.priority,
    createdBy: a.createdBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));
}

/** Delete a standard answer and its rules. */
export async function deleteStandardAnswer(id: string): Promise<void> {
  await db.delete(standardAnswers).where(eq(standardAnswers.id, id));
}

/** Update a standard answer. */
export async function updateStandardAnswer(
  id: string,
  data: Partial<{ title: string; answer: string; enabled: boolean; categories: string[]; priority: number }>,
): Promise<void> {
  await db.update(standardAnswers).set({ ...data, updatedAt: new Date() }).where(eq(standardAnswers.id, id));
}

/** Match a query against all standard answers. */
export async function matchQuery(
  query: string,
  config?: StandardAnswerConfig,
): Promise<MatchResult | null> {
  const answers = await listStandardAnswers();
  return findBestStandardAnswer(query, answers, config || DEFAULT_STANDARD_ANSWER_CONFIG);
}
