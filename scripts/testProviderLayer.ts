import { encrypt, decrypt, mask } from "../src/lib/crypto.js";
import { createProvider } from "../src/lib/providers/factory.js";
import { OpenAIProvider } from "../src/lib/providers/concrete/openai.js";
import { GoogleProvider } from "../src/lib/providers/concrete/google.js";
import { RPAProvider } from "../src/lib/providers/concrete/rpa.js";
import assert from "assert";

/**
 * Verification Script for Provider & Credential Hardening
 */
async function runTests() {
  console.log("🚀 Starting Provider Layer Verification (Hardening v2)...");

  // 1. Encryption Roundtrip
  console.log("--- Testing Encryption Roundtrip ---");
  const rawKey = "sk-ant-1234567890abcdefghijklmnopqrstuv";
  process.env.MASTER_ENCRYPTION_KEY = "a_very_secret_32_byte_string_for_testing_purposes_!!";
  
  const encrypted = encrypt(rawKey);
  const decrypted = decrypt(encrypted);
  assert.strictEqual(rawKey, decrypted, "Decryption should return raw key");
  console.log("✅ Encryption Roundtrip Passed");

  // 2. Log Masking
  console.log("--- Testing Log Masking ---");
  const masked = mask(rawKey);
  assert.ok(masked.includes("****"), "Should contain asterisks");
  console.log("✅ Masking Passed");

  // 3. Factory Robust Identification (Issue 1)
  console.log("--- Testing Factory Robust Identification ---");
  
  // Test 3a: Explicit provider ID (even with mismatching name)
  const config1 = {
    name: "MyCustomOpenAI",
    type: "api" as const,
    provider: "openai" as const,
    apiKey: "dummy",
    model: "gpt-4o"
  };
  const p1 = createProvider(config1);
  assert.ok(p1 instanceof OpenAIProvider, "Should identify as OpenAI via explicit provider field");

  // Test 3b: Heuristic fallback (no provider field)
  const config2 = {
    name: "Google Gemini",
    type: "api" as const,
    apiKey: "dummy",
    model: "gemini-pro"
  };
  const p2 = createProvider(config2);
  assert.ok(p2 instanceof GoogleProvider, "Should identify as Google via heuristic fallback");

  console.log("✅ Factory Robust Identification Passed");

  // 4. RPA Isolation Path check
  console.log("--- Testing RPA Isolation Path ---");
  const rpaConfig = {
    name: "ChatGPT RPA",
    type: "rpa" as const,
    provider: "chatgpt" as const,
    apiKey: "dummy",
    model: "chatgpt",
    userId: 42 
  };
  
  const rpa = createProvider(rpaConfig) as RPAProvider;
  // We can access private fields via (rpa as any) for testing
  const sessionPath = (rpa as any).sessionPath;
  console.log(`RPA Session Path: ${sessionPath}`);
  assert.ok(sessionPath.includes("42"), "Path must contain sanitized userId");
  assert.ok(sessionPath.endsWith("chatgpt.json"), "Path must contain target name");
  console.log("✅ RPA Isolation Path Correct");

  console.log("\n✨ ALL TESTS PASSED ✨");
}

runTests().catch(err => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
