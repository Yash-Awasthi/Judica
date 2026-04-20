import crypto from "crypto";
import logger from "./logger.js";

// P5-19: Read MASTER_ENCRYPTION_KEY directly from process.env instead of importing
// config/env.ts, which triggers dotenv/config + validation side-effects at module load.
// The key is still validated at app startup via env.ts; this just decouples crypto.ts
// from that import so tests can import crypto without triggering env validation.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const HKDF_SALT = Buffer.from("aibyai-encryption-v1", "utf8");
const HKDF_INFO = Buffer.from("aes-256-gcm-key", "utf8");

// P0-21: Support multiple key versions for rotation
const CURRENT_KEY_VERSION = parseInt(process.env.CURRENT_ENCRYPTION_VERSION || "1", 10);

// P0-14: Use HKDF-SHA256 instead of raw sha256 for key derivation
function getMasterKey(customKey?: string): Buffer {
  const keyStr = customKey || process.env.MASTER_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error("CRITICAL: MASTER_ENCRYPTION_KEY environment variable is not set");
  }

  const ikm = Buffer.from(keyStr, "hex").length === 32
    ? Buffer.from(keyStr, "hex")
    : Buffer.from(keyStr, "utf8");

  return crypto.hkdfSync("sha256", ikm, HKDF_SALT, HKDF_INFO, 32) as unknown as Buffer;
}

export function encrypt(text: string, customKey?: string, aad?: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getMasterKey(customKey);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // P0-15: Bind ciphertext to context via AAD to prevent cross-row swap attacks
    if (aad) {
      cipher.setAAD(Buffer.from(aad, "utf8"));
    }

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag().toString("hex");

    // P0-16/P0-21: Versioned JSON envelope with key version for rotation support
    return JSON.stringify({ v: 1, kv: CURRENT_KEY_VERSION, iv: iv.toString("hex"), tag, ct: encrypted });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Encryption failed");
    throw new Error("Failed to encrypt sensitive data", { cause: err });
  }
}

export function decrypt(encryptedText: string, customKey?: string, aad?: string): string {
  try {
    let ivHex: string, tagHex: string, encryptedData: string;

    // P0-16: Support both legacy (iv:tag:ct) and new JSON envelope format
    if (encryptedText.startsWith("{")) {
      const envelope = JSON.parse(encryptedText) as { v: number; kv?: number; iv: string; tag: string; ct: string };
      ivHex = envelope.iv;
      tagHex = envelope.tag;
      encryptedData = envelope.ct;
      // P0-21: If key version differs from current and no custom key provided,
      // try PREVIOUS_ENCRYPTION_KEY for older versions
      if (!customKey && envelope.kv && envelope.kv !== CURRENT_KEY_VERSION) {
        const prevKey = process.env.PREVIOUS_ENCRYPTION_KEY;
        if (prevKey) {
          customKey = prevKey;
        }
      }
    } else {
      // Legacy format: iv:tag:ct
      [ivHex, tagHex, encryptedData] = encryptedText.split(":");
    }

    if (!ivHex || !tagHex || !encryptedData) {
      throw new Error("Invalid encrypted text format");
    }

    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const key = getMasterKey(customKey);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    // P0-15: Validate AAD on decryption
    if (aad) {
      decipher.setAAD(Buffer.from(aad, "utf8"));
    }

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Decryption failed");
    throw new Error("Failed to decrypt sensitive data - check MASTER_ENCRYPTION_KEY", { cause: err });
  }
}

// P0-17: Proper encryption detection — checks for JSON envelope or legacy format
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
    return /^[0-9a-f]{24}$/.test(parts[0]) && /^[0-9a-f]{32}$/.test(parts[1]) && /^[0-9a-f]+$/.test(parts[2]);
  }
  return false;
}

// P5-18: Only show last 4 chars to avoid leaking key prefix
export function mask(str: string): string {
  if (!str) return "";
  if (str.length <= 8) return "****";
  return "****" + str.slice(-4);
}

/**
 * P4-03: Constant-time string comparison to prevent timing attacks.
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
 * P4-03: HMAC-SHA256 helper for webhook signature generation/validation.
 * @param payload - The raw request body or data to sign
 * @param secret - The shared secret key
 * @returns hex-encoded HMAC signature
 */
export function hmacSHA256(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * P4-03: Validate an incoming webhook signature against the expected HMAC.
 * Combines hmacSHA256 + constantTimeEqual for safe comparison.
 */
export function verifyWebhookSignature(payload: string, secret: string, signature: string): boolean {
  const expected = hmacSHA256(payload, secret);
  return constantTimeEqual(expected, signature);
}