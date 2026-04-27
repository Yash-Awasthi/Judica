import crypto from "crypto";
import logger from "./logger.js";

// Read MASTER_ENCRYPTION_KEY directly from process.env instead of importing
// config/env.ts, which triggers dotenv/config + validation side-effects at module load.
// The key is still validated at app startup via env.ts; this just decouples crypto.ts
// from that import so tests can import crypto without triggering env validation.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const HKDF_SALT = Buffer.from("judica-encryption-v1", "utf8");
const HKDF_INFO = Buffer.from("aes-256-gcm-key", "utf8");

// Support multiple key versions for rotation
const _parsedKeyVersion = parseInt(process.env.CURRENT_ENCRYPTION_VERSION || "1", 10);
// NaN guard on key version parse
const CURRENT_KEY_VERSION = Number.isFinite(_parsedKeyVersion) && _parsedKeyVersion >= 1 ? _parsedKeyVersion : 1;

// Use HKDF-SHA256 instead of raw sha256 for key derivation
function getMasterKey(customKey?: string): Buffer {
  const keyStr = customKey || process.env.MASTER_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error("CRITICAL: MASTER_ENCRYPTION_KEY environment variable is not set");
  }

  const hexBuf = Buffer.from(keyStr, "hex");
  if (hexBuf.length === 32) {
    // Preferred: 64-character hex-encoded key (32 bytes)
    return crypto.hkdfSync("sha256", hexBuf, HKDF_SALT, HKDF_INFO, 32) as unknown as Buffer;
  }

  // M-1 fix: enforce minimum byte length before accepting a utf8 key as IKM.
  // Without this check any short/weak string was silently accepted.
  const ikm = Buffer.from(keyStr, "utf8");
  if (ikm.length < 32) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) " +
      "or a UTF-8 string of at least 32 bytes"
    );
  }

  return crypto.hkdfSync("sha256", ikm, HKDF_SALT, HKDF_INFO, 32) as unknown as Buffer;
}

export function encrypt(text: string, customKey?: string, aad?: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getMasterKey(customKey);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Bind ciphertext to context via AAD to prevent cross-row swap attacks
    if (aad) {
      cipher.setAAD(Buffer.from(aad, "utf8"));
    }

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag().toString("hex");

    // Versioned JSON envelope with key version for rotation support
    return JSON.stringify({ v: 1, kv: CURRENT_KEY_VERSION, iv: iv.toString("hex"), tag, ct: encrypted });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Encryption failed");
    throw new Error("Failed to encrypt sensitive data", { cause: err });
  }
}

export function decrypt(encryptedText: string, customKey?: string, aad?: string): string {
  try {
    let ivHex: string, tagHex: string, encryptedData: string;

    // Support both legacy (iv:tag:ct) and new JSON envelope format
    if (encryptedText.startsWith("{")) {
      const envelope = JSON.parse(encryptedText) as Record<string, unknown>;
      // Validate envelope properties before use
      if (typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.ct !== "string") {
        throw new Error("Invalid encrypted envelope: missing iv, tag, or ct");
      }
      ivHex = envelope.iv;
      tagHex = envelope.tag;
      encryptedData = envelope.ct;
      // If key version differs from current and no custom key provided,
      // try PREVIOUS_ENCRYPTION_KEY for older versions
      if (!customKey && typeof envelope.kv === "number" && envelope.kv !== CURRENT_KEY_VERSION) {
        const prevKey = process.env.PREVIOUS_ENCRYPTION_KEY;
        if (prevKey) {
          customKey = prevKey;
        }
      }
    } else {
      // Legacy format: iv:tag:ct
      // L-1: Warn so operators know to migrate to the JSON envelope format
      logger.warn("Decrypting legacy iv:tag:ct format — consider re-encrypting with current version");
      [ivHex, tagHex, encryptedData] = encryptedText.split(":");
    }

    if (!ivHex || !tagHex || !encryptedData) {
      throw new Error("Invalid encrypted text format");
    }

    // Validate hex string lengths before buffer conversion (IV=12 bytes=24 hex, tag=16 bytes=32 hex)
    if (ivHex.length !== 24 || tagHex.length !== 32) {
      throw new Error("Invalid encrypted text format (bad IV/tag length)");
    }
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    // Validate IV and auth tag lengths for AES-256-GCM
    if (iv.length !== 12) throw new Error("Invalid IV length: expected 12 bytes");
    if (tag.length !== 16) throw new Error("Invalid auth tag length: expected 16 bytes");
    const key = getMasterKey(customKey);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    // Validate AAD on decryption
    if (aad) {
      decipher.setAAD(Buffer.from(aad, "utf8"));
    }

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Decryption failed");
    throw new Error("Failed to decrypt sensitive data", { cause: err });
  }
}

// Proper encryption detection — checks for JSON envelope or legacy format
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  // New JSON envelope format
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      return parsed.v === 1 && typeof parsed.iv === "string" && typeof parsed.tag === "string" && typeof parsed.ct === "string";
    } catch {
      return false;
    }
  }
  // Legacy format: 24-char hex iv : 32-char hex tag : hex ciphertext
  const parts = value.split(":");
  if (parts.length === 3) {
    return /^[0-9a-f]{24}$/.test(parts[0]) && /^[0-9a-f]{32}$/.test(parts[1]) && parts[2].length <= 1_000_000 && /^[0-9a-f]+$/.test(parts[2]);
  }
  return false;
}

// Only show last 4 chars to avoid leaking key prefix
export function mask(str: string): string {
  if (!str) return "";
  if (str.length <= 8) return "****";
  return "****" + str.slice(-4);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Use this for webhook signature validation, token comparison, etc.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid length-based timing leaks
    crypto.timingSafeEqual(
      Buffer.from(a.padEnd(Math.max(a.length, b.length), "\0")),
      Buffer.from(b.padEnd(Math.max(a.length, b.length), "\0"))
    );
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * HMAC-SHA256 helper for webhook signature generation/validation.
 * @param payload - The raw request body or data to sign
 * @param secret - The shared secret key
 * @returns hex-encoded HMAC signature
 */
export function hmacSHA256(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Validate an incoming webhook signature against the expected HMAC.
 * Combines hmacSHA256 + constantTimeEqual for safe comparison.
 */
export function verifyWebhookSignature(payload: string, secret: string, signature: string): boolean {
  const expected = hmacSHA256(payload, secret);
  return constantTimeEqual(expected, signature);
}