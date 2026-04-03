import crypto from "crypto";
import logger from "./logger.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Get the master encryption key from environment.
 * Decision: Env variable mandatory, never stored in DB.
 */
function getMasterKey(): Buffer {
  const keyStr = process.env.MASTER_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error("CRITICAL: MASTER_ENCRYPTION_KEY environment variable is not set");
  }
  
  // Ensure exactly 32 bytes for aes-256
  return crypto.createHash("sha256").update(keyStr).digest();
}

/**
 * Encrypt a string using AES-256-GCM.
 * Returns: iv:tag:encryptedData as a single colon-separated string.
 */
export function encrypt(text: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getMasterKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    const tag = cipher.getAuthTag().toString("hex");
    
    return `${iv.toString("hex")}:${tag}:${encrypted}`;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Encryption failed");
    throw new Error("Failed to encrypt sensitive data");
  }
}

/**
 * Decrypt a string using AES-256-GCM.
 */
export function decrypt(encryptedText: string): string {
  try {
    const [ivHex, tagHex, encryptedData] = encryptedText.split(":");
    if (!ivHex || !tagHex || !encryptedData) {
      throw new Error("Invalid encrypted text format");
    }
    
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Decryption failed");
    throw new Error("Failed to decrypt sensitive data - check MASTER_ENCRYPTION_KEY");
  }
}

/**
 * Identity masking for logs.
 * Decision: Mask sensitive strings (API keys, etc.)
 */
export function mask(str: string): string {
  if (!str) return "";
  if (str.length <= 8) return "****";
  return str.slice(0, 4) + "****" + str.slice(-4);
}