import crypto from "crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getCurrentVersion(): string {
  return process.env.CURRENT_ENCRYPTION_VERSION || "1";
}

function getKey(version: string = "1"): Buffer {
  const keyStr = process.env[`ENCRYPTION_KEY_V${version}`] || env.ENCRYPTION_KEY;
  if (!keyStr) throw new Error(`Missing encryption key for version ${version}`);
  return crypto.createHash("sha256").update(String(keyStr)).digest();
}

export function encrypt(text: string): string {
  if (!text) return "";
  const version = getCurrentVersion();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(version), iv);
  
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  
  const authTag = cipher.getAuthTag().toString("base64");
  
  return `v${version}:${iv.toString("base64")}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";
  try {
    let version = "1";
    let payload = ciphertext;
    
    if (ciphertext.startsWith("v")) {
      const firstColon = ciphertext.indexOf(":");
      version = ciphertext.slice(1, firstColon);
      payload = ciphertext.slice(firstColon + 1);
    }

    const parts = payload.split(":");
    if (parts.length !== 3) return "";
    
    const [ivStr, authTagStr, encryptedStr] = parts;
    const iv = Buffer.from(ivStr, "base64");
    const authTag = Buffer.from(authTagStr, "base64");
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(version), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedStr, "base64", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch {
    return "";
  }
}

export function encryptConfig(config: any): any {
  if (!config?.members) return config;
  return {
    ...config,
    members: config.members.map((m: any) => ({
      ...m,
      apiKey: m.apiKey ? encrypt(m.apiKey) : "",
    })),
  };
}

export function decryptConfig(config: any): any {
  if (!config?.members) return config;
  return {
    ...config,
    members: config.members.map((m: any) => ({
      ...m,
      apiKey: m.apiKey ? decrypt(m.apiKey) : "",
    })),
  };
}