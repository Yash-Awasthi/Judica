import CryptoJS from "crypto-js";
import { env } from "../config/env.js";

export function encrypt(text: string): string {
  if (!text) return "";
  return CryptoJS.AES.encrypt(text, env.ENCRYPTION_KEY).toString();
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext) return "";
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, env.ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
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