import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt, isEncrypted, mask, constantTimeEqual, hmacSHA256, verifyWebhookSignature } from "../../src/lib/crypto.js";

// P11-03: Real decrypt success and failure paths — no mocking.

describe("P11-03: decrypt real paths (no mocks)", () => {
  const TEST_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2";

  beforeEach(() => {
    process.env.MASTER_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.MASTER_ENCRYPTION_KEY;
    delete process.env.PREVIOUS_ENCRYPTION_KEY;
    delete process.env.CURRENT_ENCRYPTION_VERSION;
  });

  describe("encrypt/decrypt round-trip", () => {
    it("should encrypt and decrypt a simple string", () => {
      const plaintext = "sk-ant-api03-secret-key-12345";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should encrypt and decrypt a single-space string", () => {
      const encrypted = encrypt(" ");
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(" ");
    });

    it("should encrypt and decrypt unicode text", () => {
      const plaintext = "密钥🔑 こんにちは";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertexts for same plaintext (random IV)", () => {
      const plaintext = "same-text";
      const enc1 = encrypt(plaintext);
      const enc2 = encrypt(plaintext);
      expect(enc1).not.toBe(enc2);
      expect(decrypt(enc1)).toBe(plaintext);
      expect(decrypt(enc2)).toBe(plaintext);
    });
  });

  describe("decrypt failure paths", () => {
    it("should throw on corrupted ciphertext", () => {
      const encrypted = encrypt("test");
      const parsed = JSON.parse(encrypted);
      parsed.ct = "deadbeef" + parsed.ct.slice(8);
      expect(() => decrypt(JSON.stringify(parsed))).toThrow("Failed to decrypt");
    });

    it("should throw on wrong master key", () => {
      const encrypted = encrypt("secret");
      process.env.MASTER_ENCRYPTION_KEY = "ff".repeat(32);
      expect(() => decrypt(encrypted)).toThrow("Failed to decrypt");
    });

    it("should throw on tampered auth tag", () => {
      const encrypted = encrypt("test");
      const parsed = JSON.parse(encrypted);
      parsed.tag = "00".repeat(16);
      expect(() => decrypt(JSON.stringify(parsed))).toThrow("Failed to decrypt");
    });

    it("should throw on invalid format (not JSON, not legacy)", () => {
      expect(() => decrypt("not-valid-at-all")).toThrow("Failed to decrypt");
    });

    it("should throw on empty string", () => {
      expect(() => decrypt("")).toThrow();
    });

    it("should throw when MASTER_ENCRYPTION_KEY is not set", () => {
      const encrypted = encrypt("test");
      delete process.env.MASTER_ENCRYPTION_KEY;
      expect(() => decrypt(encrypted)).toThrow();
    });

    it("should throw on truncated IV", () => {
      const encrypted = encrypt("test");
      const parsed = JSON.parse(encrypted);
      parsed.iv = parsed.iv.slice(0, 4);
      expect(() => decrypt(JSON.stringify(parsed))).toThrow();
    });
  });

  describe("AAD (Additional Authenticated Data)", () => {
    it("should decrypt with correct AAD", () => {
      const encrypted = encrypt("secret", undefined, "user:123");
      const decrypted = decrypt(encrypted, undefined, "user:123");
      expect(decrypted).toBe("secret");
    });

    it("should fail decrypt with wrong AAD", () => {
      const encrypted = encrypt("secret", undefined, "user:123");
      expect(() => decrypt(encrypted, undefined, "user:456")).toThrow("Failed to decrypt");
    });

    it("should fail decrypt with AAD when encrypted without AAD", () => {
      const encrypted = encrypt("secret");
      expect(() => decrypt(encrypted, undefined, "unexpected-aad")).toThrow("Failed to decrypt");
    });
  });

  describe("custom key support", () => {
    it("should encrypt/decrypt with custom key", () => {
      const customKey = "bb".repeat(32);
      const encrypted = encrypt("data", customKey);
      const decrypted = decrypt(encrypted, customKey);
      expect(decrypted).toBe("data");
    });

    it("should fail with wrong custom key", () => {
      const encrypted = encrypt("data", "bb".repeat(32));
      expect(() => decrypt(encrypted, "cc".repeat(32))).toThrow("Failed to decrypt");
    });
  });

  describe("isEncrypted detection", () => {
    it("should detect JSON envelope format", () => {
      const encrypted = encrypt("test");
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it("should reject plaintext", () => {
      expect(isEncrypted("sk-ant-api03-mykey")).toBe(false);
    });

    it("should reject empty string", () => {
      expect(isEncrypted("")).toBe(false);
    });

    it("should reject malformed JSON", () => {
      expect(isEncrypted("{broken")).toBe(false);
    });
  });

  describe("mask utility", () => {
    it("should mask showing only last 4 chars", () => {
      expect(mask("sk-ant-api03-longkey")).toBe("****gkey");
    });

    it("should fully mask short strings", () => {
      expect(mask("short")).toBe("****");
    });

    it("should return empty for empty input", () => {
      expect(mask("")).toBe("");
    });
  });

  describe("constantTimeEqual", () => {
    it("should return true for equal strings", () => {
      expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    });

    it("should return false for different strings same length", () => {
      expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    });

    it("should return false for different length strings", () => {
      expect(constantTimeEqual("short", "longer-string")).toBe(false);
    });
  });

  describe("HMAC and webhook verification", () => {
    it("should produce consistent HMAC for same input", () => {
      const h1 = hmacSHA256("payload", "secret");
      const h2 = hmacSHA256("payload", "secret");
      expect(h1).toBe(h2);
    });

    it("should verify valid webhook signature", () => {
      const sig = hmacSHA256("body-content", "webhook-secret");
      expect(verifyWebhookSignature("body-content", "webhook-secret", sig)).toBe(true);
    });

    it("should reject invalid webhook signature", () => {
      expect(verifyWebhookSignature("body-content", "webhook-secret", "invalid-hex")).toBe(false);
    });
  });
});
