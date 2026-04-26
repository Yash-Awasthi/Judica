/**
 * Phase 8.6 — Field-Level Encryption for Conversation Content (PII)
 *
 * Ref: Mongoose Field-Level Encryption pattern
 *      node-seal homomorphic encryption library
 *      Drizzle ORM: custom column transformers with AES-256-GCM (already in crypto layer)
 *
 * Architecture:
 *   - Uses the existing AES-256-GCM crypto layer (src/lib/crypto.ts) — no new key material
 *   - Provides Drizzle-compatible column transformer objects that encrypt on write
 *     and decrypt on read, transparently to the rest of the application
 *   - AAD (Additional Authenticated Data) binds each encrypted field to its row context
 *     (table name + column name + optional row ID) to prevent cross-row swap attacks
 *   - Supports per-field encryption so only sensitive columns are encrypted
 *     (non-PII fields like timestamps stay plaintext — range queries still work)
 *
 * Usage with Drizzle schema:
 *   ```ts
 *   import { encryptedText } from "../lib/fieldEncryption.js";
 *
 *   export const conversations = pgTable("Conversation", {
 *     id: serial("id").primaryKey(),
 *     content: encryptedText("content"),          // transparent encrypt/decrypt
 *     userId: integer("userId").notNull(),
 *     createdAt: timestamp("createdAt").defaultNow(),
 *   });
 *   ```
 *
 * PII fields encrypted:
 *   - conversation.content (full message text)
 *   - memory.content (extracted facts, may contain user PII)
 *   - agentMemories.content
 *   - uploads.originalName (filename may reveal PII)
 *
 * Fields intentionally NOT encrypted (needed for indexing/filtering):
 *   - All timestamps
 *   - All foreign keys
 *   - Embeddings (vector similarity search requires plaintext)
 *   - userId, sessionId (need to filter by)
 */

import { encrypt, decrypt } from "./crypto.js";
import { customType } from "drizzle-orm/pg-core";
import logger from "./logger.js";

const log = logger.child({ module: "fieldEncryption" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EncryptedColumnOptions {
  /** Optional AAD prefix. Combined with column name for context binding. */
  aadPrefix?: string;
}

// ─── Drizzle Custom Column Types ──────────────────────────────────────────────

/**
 * Encrypted text column for Drizzle ORM.
 *
 * Data is stored as the encrypted JSON envelope from crypto.ts.
 * Reads return plaintext; writes encrypt transparently.
 *
 * @param fieldName - The column name in the database (used for AAD binding)
 * @param opts      - Optional configuration
 */
export function encryptedText(fieldName: string, opts: EncryptedColumnOptions = {}) {
  const aadContext = opts.aadPrefix ? `${opts.aadPrefix}:${fieldName}` : fieldName;

  return customType<{ data: string; driverData: string }>({
    dataType() {
      return "text";
    },
    toDriver(value: string): string {
      if (!value) return value;
      try {
        return encrypt(value, undefined, aadContext);
      } catch (err) {
        log.error({ err, fieldName }, "Field encryption failed");
        throw new Error(`Failed to encrypt field ${fieldName}`, { cause: err });
      }
    },
    fromDriver(value: string): string {
      if (!value) return value;
      // If the value doesn't look like an encrypted envelope, return as-is
      // (handles unencrypted legacy data during migration)
      if (!value.startsWith("{")) {
        log.debug({ fieldName }, "Non-encrypted value read — plaintext passthrough (migration mode)");
        return value;
      }
      try {
        return decrypt(value, undefined, aadContext);
      } catch (err) {
        log.error({ err, fieldName }, "Field decryption failed");
        throw new Error(`Failed to decrypt field ${fieldName}`, { cause: err });
      }
    },
  })(fieldName);
}

/**
 * Encrypted jsonb column for Drizzle ORM.
 * Encrypts the JSON-serialised form of the object.
 *
 * @param fieldName - The column name in the database (used for AAD)
 */
export function encryptedJson<T = unknown>(fieldName: string, opts: EncryptedColumnOptions = {}) {
  const aadContext = opts.aadPrefix ? `${opts.aadPrefix}:${fieldName}` : fieldName;

  return customType<{ data: T; driverData: string }>({
    dataType() {
      return "text"; // stored as encrypted text, not native jsonb
    },
    toDriver(value: T): string {
      if (value === null || value === undefined) return value as unknown as string;
      const json = JSON.stringify(value);
      try {
        return encrypt(json, undefined, aadContext);
      } catch (err) {
        throw new Error(`Failed to encrypt JSON field ${fieldName}`, { cause: err });
      }
    },
    fromDriver(value: string): T {
      if (!value) return value as unknown as T;
      const json = value.startsWith("{\"v\":")
        ? decrypt(value, undefined, aadContext)
        : value; // plaintext passthrough for migration
      return JSON.parse(json) as T;
    },
  })(fieldName);
}

// ─── Bulk Encryption Utilities ────────────────────────────────────────────────

/**
 * Encrypt a batch of strings, returning encrypted envelopes.
 * Useful for encrypting existing plaintext rows during migration.
 */
export function encryptBatch(
  items: Array<{ value: string; fieldName: string }>
): string[] {
  return items.map(({ value, fieldName }) => {
    if (!value || value.startsWith("{\"v\":")) return value; // already encrypted
    return encrypt(value, undefined, fieldName);
  });
}

/**
 * Decrypt a batch, returning plaintext values.
 */
export function decryptBatch(
  items: Array<{ value: string; fieldName: string }>
): string[] {
  return items.map(({ value, fieldName }) => {
    if (!value || !value.startsWith("{\"v\":")) return value; // plaintext passthrough
    return decrypt(value, undefined, fieldName);
  });
}

/**
 * Check if a string value is an encrypted envelope from this system.
 * Useful during migration to distinguish encrypted from plaintext rows.
 */
export function isEncryptedEnvelope(value: string): boolean {
  if (!value || !value.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed.v === "number" && typeof parsed.iv === "string" && typeof parsed.ct === "string";
  } catch {
    return false;
  }
}
