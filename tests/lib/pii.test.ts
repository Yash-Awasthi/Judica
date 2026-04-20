import { describe, it, expect } from "vitest";
import { detectPII } from "../../src/lib/pii.js";

describe("PII Detection", () => {
  it("should return found=false for clean text", () => {
    const result = detectPII("This is a normal sentence with no personal info.");
    expect(result.found).toBe(false);
    expect(result.riskScore).toBe(0);
  });

  it("should detect high severity PII (SSN, credit card)", () => {
    // Use a credit card number that passes Luhn validation
    // Visa: 4111111111111111 passes Luhn
    const text = "My SSN is 123-45-6789 and my card is 4111-1111-1111-1111.";
    const result = detectPII(text);

    expect(result.found).toBe(true);
    expect(result.types).toContain("ssn");
    expect(result.types).toContain("credit_card");
    expect(result.riskScore).toBeGreaterThanOrEqual(20); // 10 + 10
    expect(result.anonymized).toContain("[SSN_REDACTED]");
    expect(result.anonymized).toContain("[CREDIT_CARD_REDACTED]");
    expect(result.recommendations.some(r => r.includes("HIGH RISK"))).toBe(true);
  });

  it("should detect medium severity PII (email, phone)", () => {
    const text = "Contact me at test@example.com or 555-123-4567.";
    const result = detectPII(text);

    expect(result.found).toBe(true);
    expect(result.types).toContain("email");
    expect(result.types).toContain("phone");
    expect(result.riskScore).toBe(10); // 5 + 5
    expect(result.anonymized).toContain("[EMAIL_REDACTED]");
    expect(result.anonymized).toContain("[PHONE_REDACTED]");
  });

  it("should detect low severity PII (IP, URL, Name)", () => {
    const text = "My site is https://site.com and my IP is 192.168.1.1. Signed, Dr. John Doe.";
    const result = detectPII(text);

    expect(result.found).toBe(true);
    expect(result.types).toContain("url");
    expect(result.types).toContain("ip_address");
    expect(result.types).toContain("name");
    expect(result.riskScore).toBe(6); // 2 + 2 + 2
  });

  it("should handle multiple overlaps and process from end to start", () => {
    const text = "123-45-6789"; // SSN
    const result = detectPII(text);
    expect(result.anonymized).toBe("[SSN_REDACTED]");
  });

  it("should generate critical recommendation for high severity items", () => {
    const result = detectPII("123-45-6789");
    expect(result.recommendations.some(r => r.includes("CRITICAL"))).toBe(true);
  });

  it("should recommend rewriting for many PII types", () => {
    // Use text guaranteed to produce >3 unique PII types: ssn + email + phone + ip_address + url
    // Use a valid Luhn CC to be safe: 4111111111111111
    const text = "SSN: 123-45-6789. Card: 4111-1111-1111-1111. Email: foo@bar.com. Phone: 555-123-4567. IP: 10.0.0.1.";
    const result = detectPII(text);
    // types.size > 3 triggers the rewrite recommendation
    expect(result.types.length).toBeGreaterThan(3);
    // The recommendation reads "Consider rewriting the query..."
    expect(result.recommendations.some(r => r.includes("rewriting"))).toBe(true);
  });
});
