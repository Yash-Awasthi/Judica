import {
  encryptBatch,
  decryptBatch,
  isEncryptedEnvelope,
} from "../../src/lib/fieldEncryption.js";
import { encrypt, decrypt } from "../../src/lib/crypto.js";
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  // Provide test encryption key
  process.env.MASTER_ENCRYPTION_KEY = "a".repeat(64); // 32-byte hex key
  process.env.CURRENT_ENCRYPTION_VERSION = "1";
});

describe("fieldEncryption", () => {
  describe("encryptBatch / decryptBatch", () => {
    it("encrypts a batch of values", () => {
      const items = [
        { value: "Hello, my name is Alice.", fieldName: "content" },
        { value: "My email is alice@example.com", fieldName: "content" },
      ];
      const encrypted = encryptBatch(items);
      expect(encrypted).toHaveLength(2);
      for (const enc of encrypted) {
        expect(isEncryptedEnvelope(enc)).toBe(true);
      }
    });

    it("decrypts an encrypted batch back to plaintext", () => {
      const items = [
        { value: "Sensitive data point 1", fieldName: "content" },
        { value: "Sensitive data point 2", fieldName: "content" },
      ];
      const encrypted = encryptBatch(items);
      const decrypted = decryptBatch(
        encrypted.map((value) => ({ value, fieldName: "content" }))
      );
      expect(decrypted[0]).toBe("Sensitive data point 1");
      expect(decrypted[1]).toBe("Sensitive data point 2");
    });

    it("skips already-encrypted values in encryptBatch", () => {
      const alreadyEncrypted = encrypt("test", undefined, "content");
      const items = [{ value: alreadyEncrypted, fieldName: "content" }];
      const result = encryptBatch(items);
      // Should be identical (not double-encrypted)
      expect(result[0]).toBe(alreadyEncrypted);
    });

    it("passes through plaintext in decryptBatch (migration mode)", () => {
      const items = [{ value: "plaintext no envelope", fieldName: "content" }];
      const result = decryptBatch(items);
      expect(result[0]).toBe("plaintext no envelope");
    });

    it("handles empty string values without throwing", () => {
      const items = [{ value: "", fieldName: "content" }];
      expect(() => encryptBatch(items)).not.toThrow();
      expect(() => decryptBatch(items)).not.toThrow();
    });
  });

  describe("isEncryptedEnvelope", () => {
    it("returns true for a valid encrypted envelope", () => {
      const enc = encrypt("test value", undefined, "field1");
      expect(isEncryptedEnvelope(enc)).toBe(true);
    });

    it("returns false for plaintext", () => {
      expect(isEncryptedEnvelope("Hello world")).toBe(false);
      expect(isEncryptedEnvelope("")).toBe(false);
    });

    it("returns false for arbitrary JSON", () => {
      expect(isEncryptedEnvelope(JSON.stringify({ foo: "bar" }))).toBe(false);
      expect(isEncryptedEnvelope(JSON.stringify({ data: "test" }))).toBe(false);
    });

    it("returns false for malformed JSON starting with brace", () => {
      expect(isEncryptedEnvelope("{not valid json")).toBe(false);
    });
  });

  describe("AAD binding prevents cross-field swap attacks", () => {
    it("decryption fails if field name (AAD) differs from encryption", () => {
      const enc = encrypt("my-secret", undefined, "conversation:content");
      // Try to decrypt with wrong field AAD
      expect(() => decrypt(enc, undefined, "memory:content")).toThrow();
    });

    it("decryption succeeds with matching AAD", () => {
      const plaintext = "sensitive user data";
      const enc = encrypt(plaintext, undefined, "conversation:content");
      const dec = decrypt(enc, undefined, "conversation:content");
      expect(dec).toBe(plaintext);
    });
  });
});
