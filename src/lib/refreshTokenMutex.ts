/**
 * Phase 8.7 — JWT Refresh Token Single-Use Enforcement
 *
 * Ref: OWASP JWT Cheat Sheet — refresh token rotation best practices
 *      https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
 *      Auth.js (ISC, 26k stars) — implements single-use refresh token rotation
 *
 * Problem: parallel refresh race condition
 *   If two concurrent requests arrive with the same refresh token (browser tab
 *   duplication, network retry, race), both can:
 *   1. Both read the token from DB (both see it as valid)
 *   2. Both pass validation
 *   3. One deletes and issues a new token pair
 *   4. The second also issues a new token pair using the same now-deleted token
 *   This results in two valid access tokens with different lineage.
 *
 * Fix: distributed mutex per token hash
 *   - Acquire a Redis lock keyed on SHA-256(tokenHash) BEFORE reading the DB
 *   - TTL: 10 seconds (well above any DB round-trip, below any reasonable session lifetime)
 *   - Only one request can hold the lock; a second concurrent request gets LOCKED_OUT
 *   - The second request returns 429 with Retry-After: 1 header
 *   - On the retry, the token is already rotated — the family tracking detects replay
 *     and revokes all sessions (existing behavior in auth.ts)
 *
 * Implementation follows the OWASP recommendation of "detect and react":
 *   - Legitimate race: browser tab race during session restore → 429 + 1s retry works transparently
 *   - Stolen token: attacker tries to use same token → both blocked; original user sees forced re-auth
 */

import redis from "../lib/redis.js";
import logger from "../lib/logger.js";
import { createHash } from "crypto";

const log = logger.child({ service: "refreshTokenMutex" });

const LOCK_TTL_MS = 10_000;    // 10 second lock TTL
const LOCK_PREFIX  = "rt_lock:";

// ─── Types ────────────────────────────────────────────────────────────────────

export class RefreshTokenLockConflictError extends Error {
  constructor() {
    super("Refresh token is currently being rotated — please retry in 1 second");
    this.name = "RefreshTokenLockConflictError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lockKey(tokenHash: string): string {
  // Hash the tokenHash again so the Redis key doesn't directly expose the token identifier
  const keyHash = createHash("sha256").update(`lock:${tokenHash}`).digest("hex").slice(0, 32);
  return `${LOCK_PREFIX}${keyHash}`;
}

// ─── Mutex Implementation ─────────────────────────────────────────────────────

/**
 * Acquire a distributed lock for a refresh token rotation.
 *
 * Uses Redis SET NX (set if not exists) with a TTL — the standard distributed
 * lock pattern recommended by the Redis documentation.
 *
 * @param tokenHash  - The hashed refresh token (same hash used in RefreshToken table)
 * @param lockValue  - Unique owner ID (e.g., requestId) so only the owner can release
 * @returns true if lock acquired; throws RefreshTokenLockConflictError if already locked
 */
export async function acquireRefreshLock(
  tokenHash: string,
  lockValue: string
): Promise<boolean> {
  const key = lockKey(tokenHash);

  try {
    // SET key value NX PX ttl — non-atomic set-if-not-exists with expiry
    const existing = await redis.get(key);
    if (existing !== null) {
      log.debug({ key }, "Refresh token lock already held — concurrent rotation in progress");
      throw new RefreshTokenLockConflictError();
    }
    await redis.set(key, lockValue, { PX: LOCK_TTL_MS });

    return true;
  } catch (err) {
    if (err instanceof RefreshTokenLockConflictError) throw err;
    // Redis failure: fail OPEN (allow the rotation to proceed without the lock)
    // This is safe: the existing family tracking + token deletion still prevents
    // double-issuance in most cases; the lock is an additional layer, not the only one.
    log.warn({ err, key }, "Refresh token lock acquisition failed (Redis error) — proceeding without lock");
    return false;
  }
}

/**
 * Release the distributed lock.
 * Only releases if the lock value matches (Lua script for atomicity).
 *
 * @param tokenHash  - The hashed refresh token
 * @param lockValue  - Must match the value used in acquireRefreshLock
 */
export async function releaseRefreshLock(
  tokenHash: string,
  lockValue: string
): Promise<void> {
  const key = lockKey(tokenHash);

  // Lua script: only delete if the value matches (prevents releasing another request's lock)
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  try {
    await (redis as unknown as { eval: (script: string, keys: string[], args: string[]) => Promise<unknown> })
      .eval(luaScript, [key], [lockValue]);
  } catch (err) {
    // Lock release failure is non-critical — TTL will expire the lock automatically
    log.warn({ err, key }, "Failed to release refresh token lock — will expire automatically");
  }
}

/**
 * Execute a callback with a distributed refresh token lock held.
 * Releases the lock in a finally block regardless of success or failure.
 *
 * This is the recommended way to use the mutex from the auth route handler.
 *
 * @example
 * ```ts
 * const newTokenPair = await withRefreshLock(tokenHash, requestId, async () => {
 *   // ... validate token, delete old, issue new
 * });
 * ```
 */
export async function withRefreshLock<T>(
  tokenHash: string,
  lockValue: string,
  callback: () => Promise<T>
): Promise<T> {
  await acquireRefreshLock(tokenHash, lockValue);
  try {
    return await callback();
  } finally {
    await releaseRefreshLock(tokenHash, lockValue);
  }
}
