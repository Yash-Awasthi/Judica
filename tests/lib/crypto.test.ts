import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt, decrypt, mask } from "../../src/lib/crypto.js";
import { env } from "../../src/config/env.js";

// Mock the environment to ensure a consistent key
vi.mock("../../src/config/env.js", () => ({
  env: {
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

describe("Crypto Utils", () => {
  describe("encrypt & decrypt", () => {
    it("should encrypt and decrypt a string successfully", () => {
      const plaintext = "super-secret-message-123";
      
      const encrypted = encrypt(plaintext);
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toEqual(plaintext);
      expect(encrypted.split(":")).toHaveLength(3); // iv:tag:data
      
      const decrypted = decrypt(encrypted);
      expect(decrypted).toEqual(plaintext);
    });

    it("should generate different encrypted strings for the same payload due to random IV", () => {
      const plaintext = "hello-world";
      
      const enc1 = encrypt(plaintext);
      const enc2 = encrypt(plaintext);
      
      expect(enc1).not.toEqual(enc2);
      expect(decrypt(enc1)).toEqual(plaintext);
      expect(decrypt(enc2)).toEqual(plaintext);
    });

    it("should throw an error on decrypting malformed string", () => {
      expect(() => decrypt("invalid-encrypted-format")).toThrow(/Failed to decrypt sensitive data/);
    });

    it("should throw an error on decrypting altered ciphertext", () => {
      // Create valid encrypted string
      const encrypted = encrypt("test-message");
      let parts = encrypted.split(":");
      
      // Alter the cipher data (part 3)
      parts[2] = "00" + parts[2].substring(2);
      const tampered = parts.join(":");
      
      expect(() => decrypt(tampered)).toThrow(/Failed to decrypt sensitive data/);
    });
  });

  describe("mask", () => {
    it("should mask long strings keeping only last 4 chars", () => {
      const masked = mask("sk-ant-api03-verylongsecretkey12345");
      expect(masked).toBe("****2345");
    });

    it("should just return '****' for strings 8 chars or less", () => {
      expect(mask("12345678")).toBe("****");
      expect(mask("abcd")).toBe("****");
    });

    it("should return empty string for falsy input", () => {
      expect(mask("")).toBe("");
      expect(mask(null as any)).toBe("");
    });
  });
});
