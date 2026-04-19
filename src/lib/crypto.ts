import crypto from "crypto";
import logger from "./logger.js";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getMasterKey(customKey?: string): Buffer {
  const keyStr = customKey || env.MASTER_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error("CRITICAL: MASTER_ENCRYPTION_KEY environment variable is not set");
  }
  
  return crypto.createHash("sha256").update(keyStr).digest();
}

export function encrypt(text: string, customKey?: string): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getMasterKey(customKey);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    const tag = cipher.getAuthTag().toString("hex");
    
    return `${iv.toString("hex")}:${tag}:${encrypted}`;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Encryption failed");
    throw new Error("Failed to encrypt sensitive data", { cause: err });
  }
}

export function decrypt(encryptedText: string, customKey?: string): string {
  try {
    const [ivHex, tagHex, encryptedData] = encryptedText.split(":");
    if (!ivHex || !tagHex || !encryptedData) {
      throw new Error("Invalid encrypted text format");
    }
    
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const key = getMasterKey(customKey);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Decryption failed");
    throw new Error("Failed to decrypt sensitive data - check MASTER_ENCRYPTION_KEY", { cause: err });
  }
}

export function mask(str: string): string {
  if (!str) return "";
  if (str.length <= 8) return "****";
  return str.slice(0, 4) + "****" + str.slice(-4);
}