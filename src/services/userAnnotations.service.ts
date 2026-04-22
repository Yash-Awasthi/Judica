/**
 * User Annotations service.
 *
 * Allows users to highlight, comment on, flag, and bookmark
 * specific parts of agent responses within conversations.
 */

import crypto from "crypto";
import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AnnotationType = "highlight" | "comment" | "flag" | "bookmark";

export interface Annotation {
  id: string;
  userId: string;
  conversationId: string;
  messageId: string;
  type: AnnotationType;
  content: string;
  selection?: { start: number; end: number };
  createdAt: Date;
}

// ─── In-memory store ────────────────────────────────────────────────────────

const MAX_ANNOTATIONS = 10_000;
const ANNOTATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const annotations = new Map<string, Annotation>();

function evictStaleAnnotations(): void {
  const now = Date.now();
  let evicted = 0;
  for (const [id, ann] of annotations) {
    if (now - ann.createdAt.getTime() > ANNOTATION_TTL_MS) {
      annotations.delete(id);
      evicted++;
    }
  }
  if (evicted > 0) {
    logger.info({ evicted, remaining: annotations.size }, "Evicted stale annotations");
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = setInterval(
  evictStaleAnnotations,
  CLEANUP_INTERVAL_MS,
);
if (cleanupTimer && typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

// ─── Core Functions ─────────────────────────────────────────────────────────

export function createAnnotation(
  userId: string,
  conversationId: string,
  messageId: string,
  type: AnnotationType,
  content: string,
  selection?: { start: number; end: number },
): Annotation {
  const id = crypto.randomBytes(12).toString("hex");
  const annotation: Annotation = {
    id,
    userId,
    conversationId,
    messageId,
    type,
    content,
    selection,
    createdAt: new Date(),
  };
  if (annotations.size >= MAX_ANNOTATIONS) {
    evictStaleAnnotations();
  }
  if (annotations.size >= MAX_ANNOTATIONS) {
    throw new Error("Annotation store is full");
  }
  annotations.set(id, annotation);
  logger.info({ annotationId: id, userId, type }, "Created annotation");
  return annotation;
}

export function getAnnotationsForMessage(messageId: string): Annotation[] {
  return Array.from(annotations.values()).filter((a) => a.messageId === messageId);
}

export function getAnnotationsForConversation(conversationId: string): Annotation[] {
  return Array.from(annotations.values()).filter((a) => a.conversationId === conversationId);
}

export function getUserAnnotations(userId: string, limit?: number): Annotation[] {
  const userAnns = Array.from(annotations.values())
    .filter((a) => a.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (limit) {
    return userAnns.slice(0, limit);
  }
  return userAnns;
}

export function deleteAnnotation(id: string, userId: string): boolean {
  const ann = annotations.get(id);
  if (!ann) {
    throw new Error(`Annotation '${id}' not found`);
  }
  if (ann.userId !== userId) {
    throw new Error("Only the annotation owner can delete it");
  }
  annotations.delete(id);
  logger.info({ annotationId: id }, "Deleted annotation");
  return true;
}

export function updateAnnotation(id: string, userId: string, content: string): Annotation {
  const ann = annotations.get(id);
  if (!ann) {
    throw new Error(`Annotation '${id}' not found`);
  }
  if (ann.userId !== userId) {
    throw new Error("Only the annotation owner can update it");
  }
  ann.content = content;
  logger.info({ annotationId: id }, "Updated annotation");
  return ann;
}

// ─── Reset (for tests) ─────────────────────────────────────────────────────

export function _reset(): void {
  annotations.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
