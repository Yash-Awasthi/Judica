/**
 * Document Set Service — CRUD for scoped document collections.
 *
 * Phase 3.8: curated subsets of the knowledge base.  Scope a specific agent or
 * conversation to only a defined set of documents — e.g. "only search our
 * legal docs" or "only the Q3 reports."
 */

import crypto from "crypto";
import { db } from "../lib/drizzle.js";
import {
  documentSets,
  documentSetMembers,
  conversationDocumentSets,
} from "../db/schema/documentSets.js";
import { eq, and, or, desc, inArray, count } from "drizzle-orm";
import logger from "../lib/logger.js";

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface CreateDocumentSetInput {
  name: string;
  description?: string;
  userId: number;
  isPublic?: boolean;
}

export interface UpdateDocumentSetInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export interface AddDocumentsInput {
  documentIds: string[];
  documentTitle?: string;
  documentSource?: string;
}

export interface DocumentSetRow {
  id: string;
  name: string;
  description: string | null;
  userId: number;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentSetWithCount extends DocumentSetRow {
  memberCount: number;
}

export interface DocumentSetMemberRow {
  id: string;
  documentSetId: string;
  documentId: string;
  documentTitle: string;
  documentSource: string | null;
  addedAt: Date;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createDocumentSet(
  input: CreateDocumentSetInput,
): Promise<{ id: string }> {
  try {
    const id = crypto.randomUUID();
    const [row] = await db
      .insert(documentSets)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        userId: input.userId,
        isPublic: input.isPublic ?? false,
      })
      .returning({ id: documentSets.id });

    logger.info({ id: row.id, name: input.name }, "Document set created");
    return { id: row.id };
  } catch (error) {
    logger.error({ error, input }, "Failed to create document set");
    throw error;
  }
}

export async function getDocumentSets(
  userId: number,
): Promise<DocumentSetRow[]> {
  try {
    return await db
      .select()
      .from(documentSets)
      .where(or(eq(documentSets.userId, userId), eq(documentSets.isPublic, true)))
      .orderBy(desc(documentSets.updatedAt));
  } catch (error) {
    logger.error({ error, userId }, "Failed to list document sets");
    throw error;
  }
}

export async function getDocumentSetById(
  id: string,
  userId: number,
): Promise<DocumentSetWithCount | null> {
  try {
    const [set] = await db
      .select()
      .from(documentSets)
      .where(
        and(
          eq(documentSets.id, id),
          or(eq(documentSets.userId, userId), eq(documentSets.isPublic, true)),
        ),
      )
      .limit(1);

    if (!set) return null;

    const [countResult] = await db
      .select({ value: count() })
      .from(documentSetMembers)
      .where(eq(documentSetMembers.documentSetId, id));

    return { ...set, memberCount: Number(countResult?.value ?? 0) };
  } catch (error) {
    logger.error({ error, id, userId }, "Failed to get document set by id");
    throw error;
  }
}

export async function updateDocumentSet(
  id: string,
  userId: number,
  input: UpdateDocumentSetInput,
): Promise<boolean> {
  try {
    const result = await db
      .update(documentSets)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(documentSets.id, id), eq(documentSets.userId, userId)));

    return (result as unknown as { rowCount: number }).rowCount > 0;
  } catch (error) {
    logger.error({ error, id, userId, input }, "Failed to update document set");
    throw error;
  }
}

export async function deleteDocumentSet(
  id: string,
  userId: number,
): Promise<boolean> {
  try {
    const result = await db
      .delete(documentSets)
      .where(and(eq(documentSets.id, id), eq(documentSets.userId, userId)));

    return (result as unknown as { rowCount: number }).rowCount > 0;
  } catch (error) {
    logger.error({ error, id, userId }, "Failed to delete document set");
    throw error;
  }
}

// ─── Members ────────────────────────────────────────────────────────────────

export async function addDocumentsToSet(
  setId: string,
  documentIds: string[],
  userId: number,
): Promise<{ addedCount: number }> {
  try {
    // Verify ownership
    const [set] = await db
      .select({ id: documentSets.id })
      .from(documentSets)
      .where(and(eq(documentSets.id, setId), eq(documentSets.userId, userId)))
      .limit(1);

    if (!set) {
      throw new Error("Document set not found or not owned by user");
    }

    const values = documentIds.map((docId) => ({
      id: crypto.randomUUID(),
      documentSetId: setId,
      documentId: docId,
      documentTitle: "",
    }));

    const rows = await db
      .insert(documentSetMembers)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: documentSetMembers.id });

    // Touch updatedAt
    await db
      .update(documentSets)
      .set({ updatedAt: new Date() })
      .where(eq(documentSets.id, setId));

    return { addedCount: rows.length };
  } catch (error) {
    logger.error({ error, setId, userId }, "Failed to add documents to set");
    throw error;
  }
}

export async function removeDocumentFromSet(
  setId: string,
  documentId: string,
  userId: number,
): Promise<void> {
  try {
    // Verify ownership
    const [set] = await db
      .select({ id: documentSets.id })
      .from(documentSets)
      .where(and(eq(documentSets.id, setId), eq(documentSets.userId, userId)))
      .limit(1);

    if (!set) {
      throw new Error("Document set not found or not owned by user");
    }

    await db
      .delete(documentSetMembers)
      .where(
        and(
          eq(documentSetMembers.documentSetId, setId),
          eq(documentSetMembers.documentId, documentId),
        ),
      );

    // Touch updatedAt
    await db
      .update(documentSets)
      .set({ updatedAt: new Date() })
      .where(eq(documentSets.id, setId));
  } catch (error) {
    logger.error({ error, setId, documentId, userId }, "Failed to remove document from set");
    throw error;
  }
}

export async function getDocumentSetMembers(
  setId: string,
  userId: number,
): Promise<DocumentSetMemberRow[]> {
  try {
    // Verify access
    const [set] = await db
      .select({ id: documentSets.id })
      .from(documentSets)
      .where(
        and(
          eq(documentSets.id, setId),
          or(eq(documentSets.userId, userId), eq(documentSets.isPublic, true)),
        ),
      )
      .limit(1);

    if (!set) {
      throw new Error("Document set not found or not accessible");
    }

    return await db
      .select()
      .from(documentSetMembers)
      .where(eq(documentSetMembers.documentSetId, setId));
  } catch (error) {
    logger.error({ error, setId, userId }, "Failed to get document set members");
    throw error;
  }
}

// ─── Conversation linking ───────────────────────────────────────────────────

export async function getDocumentSetsForConversation(
  conversationId: string,
): Promise<DocumentSetRow[]> {
  try {
    const links = await db
      .select({ documentSetId: conversationDocumentSets.documentSetId })
      .from(conversationDocumentSets)
      .where(eq(conversationDocumentSets.conversationId, conversationId));

    if (links.length === 0) return [];

    const setIds = links.map((l) => l.documentSetId);
    return await db
      .select()
      .from(documentSets)
      .where(inArray(documentSets.id, setIds));
  } catch (error) {
    logger.error({ error, conversationId }, "Failed to get document sets for conversation");
    throw error;
  }
}

export async function linkDocumentSetToConversation(
  conversationId: string,
  setId: string,
): Promise<void> {
  try {
    await db
      .insert(conversationDocumentSets)
      .values({ conversationId, documentSetId: setId })
      .onConflictDoNothing();
  } catch (error) {
    logger.error({ error, conversationId, setId }, "Failed to link document set to conversation");
    throw error;
  }
}

export async function unlinkDocumentSetFromConversation(
  conversationId: string,
  setId: string,
): Promise<void> {
  try {
    await db
      .delete(conversationDocumentSets)
      .where(
        and(
          eq(conversationDocumentSets.conversationId, conversationId),
          eq(conversationDocumentSets.documentSetId, setId),
        ),
      );
  } catch (error) {
    logger.error({ error, conversationId, setId }, "Failed to unlink document set from conversation");
    throw error;
  }
}

// ─── Filtering ──────────────────────────────────────────────────────────────

export async function filterDocumentsBySet(
  setId: string,
  documentIds: string[],
): Promise<string[]> {
  try {
    if (documentIds.length === 0) return [];

    const members = await db
      .select({ documentId: documentSetMembers.documentId })
      .from(documentSetMembers)
      .where(
        and(
          eq(documentSetMembers.documentSetId, setId),
          inArray(documentSetMembers.documentId, documentIds),
        ),
      );

    return members.map((m) => m.documentId);
  } catch (error) {
    logger.error({ error, setId }, "Failed to filter documents by set");
    throw error;
  }
}
