/**
 * Tenant Isolation Service — per-tenant encryption key management and
 * RLS context injection.
 *
 * Reference: PostgreSQL Row-Level Security (RLS) — built-in tenant isolation
 * at the database level. Nile / Drizzle ORM RLS patterns.
 *
 * Key responsibilities:
 *   ensureTenantKey        — create a per-tenant HKDF IKM if none exists
 *   getTenantKey           — decrypt and return the raw IKM for a tenant
 *   rotateTenantKey        — generate a new IKM (old stays for legacy decrypt)
 *   encryptForTenant       — encrypt data using the tenant-derived key
 *   decryptForTenant       — decrypt data using the tenant-derived key
 *   withTenantContext       — execute a callback inside a transaction that sets
 *                            SET LOCAL app.current_tenant_id to activate RLS
 */

import crypto from "crypto";
import { db } from "../lib/drizzle.js";
import { tenantEncryptionKeys } from "../db/schema/tenantIsolation.js";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/crypto.js";
import logger from "../lib/logger.js";
import { randomUUID } from "crypto";

const log = logger.child({ service: "tenantIsolation" });

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const HKDF_SALT = Buffer.from("judica-tenant-isolation-v1", "utf8");
const HKDF_INFO = Buffer.from("per-tenant-aes-256-gcm", "utf8");

// ─── Key Derivation ────────────────────────────────────────────────────────────

/** Derive a 32-byte AES key from a tenant's raw IKM via HKDF-SHA256. */
function deriveKey(ikm: Buffer): Buffer {
  return crypto.hkdfSync("sha256", ikm, HKDF_SALT, HKDF_INFO, 32) as unknown as Buffer;
}

// ─── Ensure / Get Key ─────────────────────────────────────────────────────────

/**
 * Ensure a per-tenant encryption key exists.  Creates one if missing.
 * Idempotent — safe to call on every tenant request.
 */
export async function ensureTenantKey(tenantId: string): Promise<void> {
  const existing = await db
    .select({ id: tenantEncryptionKeys.id })
    .from(tenantEncryptionKeys)
    .where(eq(tenantEncryptionKeys.tenantId, tenantId))
    .limit(1);

  if (existing.length > 0) return;

  // Generate 32 random bytes as HKDF IKM
  const ikm = crypto.randomBytes(32);
  const encryptedIkm = encrypt(ikm.toString("hex"));

  await db.insert(tenantEncryptionKeys).values({
    id: randomUUID(),
    tenantId,
    encryptedIkm,
    keyVersion: 1,
    active: true,
  });

  log.info({ tenantId }, "Per-tenant encryption key created");
}

/**
 * Retrieve and decrypt the raw IKM for the tenant's active key.
 * Returns null if no key has been provisioned yet.
 */
export async function getTenantKey(tenantId: string): Promise<Buffer | null> {
  const [row] = await db
    .select()
    .from(tenantEncryptionKeys)
    .where(eq(tenantEncryptionKeys.tenantId, tenantId))
    .limit(1);

  if (!row) return null;

  const ikmHex = decrypt(row.encryptedIkm);
  return Buffer.from(ikmHex, "hex");
}

// ─── Key Rotation ─────────────────────────────────────────────────────────────

/**
 * Rotate the per-tenant encryption key.
 * Old key is NOT deleted — existing ciphertext can still be decrypted with
 * the old keyVersion (callers must handle version disambiguation).
 * Returns the new key version.
 */
export async function rotateTenantKey(tenantId: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(tenantEncryptionKeys)
    .where(eq(tenantEncryptionKeys.tenantId, tenantId))
    .limit(1);

  const currentVersion = existing?.keyVersion ?? 0;
  const newVersion = currentVersion + 1;

  const newIkm = crypto.randomBytes(32);
  const encryptedIkm = encrypt(newIkm.toString("hex"));

  if (existing) {
    await db
      .update(tenantEncryptionKeys)
      .set({ encryptedIkm, keyVersion: newVersion, updatedAt: new Date() })
      .where(eq(tenantEncryptionKeys.tenantId, tenantId));
  } else {
    await db.insert(tenantEncryptionKeys).values({
      id: randomUUID(),
      tenantId,
      encryptedIkm,
      keyVersion: newVersion,
      active: true,
    });
  }

  log.info({ tenantId, newVersion }, "Per-tenant encryption key rotated");
  return newVersion;
}

// ─── Tenant-Scoped Encrypt / Decrypt ─────────────────────────────────────────

/**
 * Encrypt a string using the per-tenant AES-256-GCM key.
 * Falls back to the platform master key when the tenant has no custom key.
 */
export async function encryptForTenant(tenantId: string, plaintext: string): Promise<string> {
  const ikm = await getTenantKey(tenantId);
  if (!ikm) {
    // Fallback: platform master key (single-tenant mode)
    return encrypt(plaintext);
  }
  const key = deriveKey(ikm);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let ct = cipher.update(plaintext, "utf8", "hex");
  ct += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return JSON.stringify({ v: 1, tid: tenantId, iv: iv.toString("hex"), tag, ct });
}

/**
 * Decrypt a string that was encrypted with the per-tenant AES-256-GCM key.
 */
export async function decryptForTenant(tenantId: string, ciphertext: string): Promise<string> {
  // Detect per-tenant envelope
  if (ciphertext.startsWith("{")) {
    const envelope = JSON.parse(ciphertext) as Record<string, unknown>;
    if (typeof envelope.tid === "string" && envelope.v === 1) {
      const ikm = await getTenantKey(tenantId);
      if (!ikm) throw new Error(`No encryption key for tenant ${tenantId}`);
      const key = deriveKey(ikm);
      const iv = Buffer.from(envelope.iv as string, "hex");
      const tag = Buffer.from(envelope.tag as string, "hex");
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      let pt = decipher.update(envelope.ct as string, "hex", "utf8");
      pt += decipher.final("utf8");
      return pt;
    }
  }
  // Fallback: platform master key
  return decrypt(ciphertext);
}

// ─── RLS Transaction Helper ───────────────────────────────────────────────────

/**
 * Execute a callback inside a database transaction with RLS activated.
 *
 * Sets `SET LOCAL app.current_tenant_id = <tenantId>` before any queries,
 * activating PostgreSQL RLS policies on RLS-enabled tables.
 *
 * Usage:
 *   const result = await withTenantContext(tenantId, async (tx) => {
 *     return tx.select().from(tenantMembers);
 *   });
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  // Validate tenantId to prevent SQL injection via SET LOCAL
  if (!/^[a-z0-9_-]{1,64}$/i.test(tenantId)) {
    throw new Error(`Invalid tenantId for RLS context: ${tenantId}`);
  }

  return db.transaction(async (tx) => {
    // SET LOCAL is scoped to the current transaction — automatically cleared on commit/rollback
    await tx.execute(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
    return fn(tx as unknown as typeof db);
  });
}
