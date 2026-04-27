import { describe, it, expect } from "vitest";

// ─── No mocks needed — pure functions ────────────────────────────────────────

import {
  validateEmail,
  isDisposableDomain,
  getBlockedDomainCount,
} from "../../src/services/emailValidation.service.js";

// ─── validateEmail ────────────────────────────────────────────────────────────

describe("validateEmail", () => {
  // ── valid emails ─────────────────────────────────────────────────────────

  it("accepts a standard email", () => {
    const result = validateEmail("alice@example.com");
    expect(result).toEqual({ valid: true, domain: "example.com" });
  });

  it("accepts a gmail address", () => {
    const result = validateEmail("user@gmail.com");
    expect(result).toEqual({ valid: true, domain: "gmail.com" });
  });

  it("accepts an outlook address", () => {
    const result = validateEmail("user@outlook.com");
    expect(result).toEqual({ valid: true, domain: "outlook.com" });
  });

  it("accepts email with subaddress (plus-tag)", () => {
    const result = validateEmail("user+tag@example.com");
    expect(result).toEqual({ valid: true, domain: "example.com" });
  });

  it("accepts email with dots in local part", () => {
    const result = validateEmail("first.last@example.com");
    expect(result).toEqual({ valid: true, domain: "example.com" });
  });

  it("accepts email with hyphen in domain", () => {
    const result = validateEmail("user@my-domain.org");
    expect(result).toEqual({ valid: true, domain: "my-domain.org" });
  });

  it("accepts email with subdomain", () => {
    const result = validateEmail("user@mail.example.co.uk");
    expect(result).toEqual({ valid: true, domain: "mail.example.co.uk" });
  });

  it("accepts email with uppercase and normalises domain to lowercase", () => {
    const result = validateEmail("User@Example.COM");
    expect(result.valid).toBe(true);
    expect(result.domain).toBe("example.com");
  });

  it("accepts numeric local part", () => {
    const result = validateEmail("12345@example.com");
    expect(result).toEqual({ valid: true, domain: "example.com" });
  });

  // ── invalid format ────────────────────────────────────────────────────────

  it("rejects email with no @ symbol", () => {
    const result = validateEmail("notanemail");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("rejects email with multiple @ symbols", () => {
    const result = validateEmail("a@b@c.com");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("rejects email with leading space", () => {
    const result = validateEmail(" user@example.com");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("rejects email with trailing space", () => {
    const result = validateEmail("user@example.com ");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("rejects email with internal space", () => {
    const result = validateEmail("user name@example.com");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("rejects email with no local part", () => {
    const result = validateEmail("@example.com");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("rejects email with no domain part", () => {
    const result = validateEmail("user@");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("rejects email with no TLD", () => {
    const result = validateEmail("user@nodot");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("rejects empty string", () => {
    const result = validateEmail("");
    expect(result).toEqual({ valid: false, reason: "invalid_format" });
  });

  // ── disposable domains ────────────────────────────────────────────────────

  it("rejects mailinator.com", () => {
    const result = validateEmail("test@mailinator.com");
    expect(result).toEqual({ valid: false, reason: "disposable", domain: "mailinator.com" });
  });

  it("rejects guerrillamail.com", () => {
    const result = validateEmail("anon@guerrillamail.com");
    expect(result).toEqual({ valid: false, reason: "disposable", domain: "guerrillamail.com" });
  });

  it("rejects yopmail.com", () => {
    const result = validateEmail("throwaway@yopmail.com");
    expect(result).toEqual({ valid: false, reason: "disposable", domain: "yopmail.com" });
  });

  it("rejects tempmail.com", () => {
    const result = validateEmail("temp@tempmail.com");
    expect(result).toEqual({ valid: false, reason: "disposable", domain: "tempmail.com" });
  });

  it("rejects trashmail.com", () => {
    const result = validateEmail("trash@trashmail.com");
    expect(result).toEqual({ valid: false, reason: "disposable", domain: "trashmail.com" });
  });

  it("rejects subdomain of disposable (sub.mailinator.com)", () => {
    const result = validateEmail("user@sub.mailinator.com");
    expect(result).toEqual({ valid: false, reason: "disposable", domain: "sub.mailinator.com" });
  });

  it("rejects deep subdomain of disposable", () => {
    const result = validateEmail("x@a.b.guerrillamail.com");
    // The regex check: a.b.guerrillamail.com has >2 parts → parent = guerrillamail.com
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("disposable");
  });

  it("rejects subaddress user+tag@mailinator.com", () => {
    const result = validateEmail("user+anything@mailinator.com");
    expect(result).toEqual({ valid: false, reason: "disposable", domain: "mailinator.com" });
  });

  it("rejects subaddress on subdomain of disposable", () => {
    const result = validateEmail("user+tag@sub.mailinator.com");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("disposable");
  });

  it("returns domain in the result for valid emails", () => {
    const result = validateEmail("hello@protonmail.com");
    expect(result.valid).toBe(true);
    expect(result.domain).toBe("protonmail.com");
  });

  it("does not include reason for valid email", () => {
    const result = validateEmail("ok@example.org");
    expect(result.reason).toBeUndefined();
  });
});

// ─── isDisposableDomain ────────────────────────────────────────────────────────

describe("isDisposableDomain", () => {
  it("returns true for mailinator.com", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
  });

  it("returns true for yopmail.com", () => {
    expect(isDisposableDomain("yopmail.com")).toBe(true);
  });

  it("returns true for guerrillamail.com", () => {
    expect(isDisposableDomain("guerrillamail.com")).toBe(true);
  });

  it("returns true for trashmail.com", () => {
    expect(isDisposableDomain("trashmail.com")).toBe(true);
  });

  it("returns false for gmail.com", () => {
    expect(isDisposableDomain("gmail.com")).toBe(false);
  });

  it("returns false for outlook.com", () => {
    expect(isDisposableDomain("outlook.com")).toBe(false);
  });

  it("returns false for example.com", () => {
    expect(isDisposableDomain("example.com")).toBe(false);
  });

  it("returns false for protonmail.com", () => {
    expect(isDisposableDomain("protonmail.com")).toBe(false);
  });

  it("returns true for sub.mailinator.com (parent check)", () => {
    expect(isDisposableDomain("sub.mailinator.com")).toBe(true);
  });

  it("returns true for deep.sub.yopmail.com (parent check)", () => {
    expect(isDisposableDomain("deep.sub.yopmail.com")).toBe(true);
  });

  it("returns false for a.sub.gmail.com (non-disposable parent)", () => {
    expect(isDisposableDomain("a.sub.gmail.com")).toBe(false);
  });

  it("is case-insensitive (MAILINATOR.COM)", () => {
    expect(isDisposableDomain("MAILINATOR.COM")).toBe(true);
  });

  it("is case-insensitive for subdomain check", () => {
    expect(isDisposableDomain("Sub.MAILINATOR.COM")).toBe(true);
  });
});

// ─── getBlockedDomainCount ────────────────────────────────────────────────────

describe("getBlockedDomainCount", () => {
  it("returns a positive number", () => {
    expect(getBlockedDomainCount()).toBeGreaterThan(0);
  });

  it("returns at least 100 domains", () => {
    expect(getBlockedDomainCount()).toBeGreaterThanOrEqual(100);
  });

  it("returns a consistent value on repeated calls", () => {
    expect(getBlockedDomainCount()).toBe(getBlockedDomainCount());
  });
});
