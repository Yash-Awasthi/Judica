/**
 * Document Set Service — CRUD for scoped document collections.
 */

import { db } from "../lib/drizzle.js";
import { documentSets, documentSetMembers } from "../db/schema/documentSets.js";
import { eq, and, or, desc } from "drizzle-orm";
import logger from "../lib/logger.js";

export async function createDocumentSet(input: {
  name: string;
  description?: string;
  userId: number;
  isPublic?: boolean;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(documentSets)
    .values({
      name: input.name,
      description: input.description ?? "",
      userId: input.userId,
      isPublic: input.isPublic ?? false,
    })
    .returning({ id: documentSets.id });

  logger.info({ id: row.id, name: input.name }, "Document set created");
  return { id: row.id };
}

export async function listDocumentSets(userId: number) {
  return db
    .select()
    .from(documentSets)
    .where(or(eq(documentSets.userId, userId), eq(documentSets.isPublic, true)))
    .orderBy(desc(documentSets.updatedAt));
}

export async function getDocumentSet(setId: number, userId: number) {
  const [set] = await db
    .select()
    .from(documentSets)
    .where(
      and(
        eq(documentSets.id, setId),
        or(eq(documentSets.userId, userId), eq(documentSets.isPublic, true)),
      ),
    )
    .limit(1);

  if (!set) return null;

  const members = await db
    .select()
    .from(documentSetMembers)
    .where(eq(documentSetMembers.setId, setId));

  return { ...set, documents: members };
}

export async function updateDocumentSet(
  setId: number,
  userId: number,
  updates: { name?: string; description?: string; isPublic?: boolean },
): Promise<boolean> {
  const result = await db
    .update(documentSets)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(documentSets.id, setId), eq(documentSets.userId, userId)));

  return (result as unknown as { rowCount: number }).rowCount > 0;
}

export async function deleteDocumentSet(setId: number, userId: number): Promise<boolean> {
  const result = await db
    .delete(documentSets)
    .where(and(eq(documentSets.id, setId), eq(documentSets.userId, userId)));

  return (result as unknown as { rowCount: number }).rowCount > 0;
}

export async function addDocumentToSet(
  setId: number,
  document: { documentId: string; documentTitle?: string; documentSource?: string },
): Promise<{ id: number }> {
  const [row] = await db
    .insert(documentSetMembers)
    .values({
      setId,
      documentId: document.documentId,
      documentTitle: document.documentTitle ?? "",
      documentSource: document.documentSource,
    })
    .onConflictDoNothing()
    .returning({ id: documentSetMembers.id });

  return { id: row?.id ?? 0 };
}

export async function removeDocumentFromSet(setId: number, documentId: string): Promise<void> {
  await db
    .delete(documentSetMembers)
    .where(
      and(
        eq(documentSetMembers.setId, setId),
        eq(documentSetMembers.documentId, documentId),
      ),
    );
}

export async function getDocumentsInSet(setId: number) {
  return db
    .select()
    .from(documentSetMembers)
    .where(eq(documentSetMembers.setId, setId));
}
