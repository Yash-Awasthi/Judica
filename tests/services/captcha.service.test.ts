import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mockEnv = vi.hoisted(() => ({
  CAPTCHA_PROVIDER: undefined as string | undefined,
  RECAPTCHA_SECRET_KEY: undefined as string | undefined,
  RECAPTCHA_SITE_KEY: undefined as string | undefined,
  RECAPTCHA_MIN_SCORE: undefined as number | undefined,
  HCAPTCHA_SECRET_KEY: undefined as string | undefined,
  HCAPTCHA_SITE_KEY: undefined as string | undefined,
  TURNSTILE_SECRET_KEY: undefined as string | undefined,
  TURNSTILE_SITE_KEY: undefined as string | undefined,
}));

// ─── Mocks (must come before the import) ─────────────────────────────────────

vi.mock("../../src/config/env.js", () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

// ─── Import under test (after mocks) ─────────────────────────────────────────

import {
  getCaptchaProvider,
  getCaptchaSiteKey,
  verifyCaptcha,
} from "../../src/services/captcha.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetEnv() {
  mockEnv.CAPTCHA_PROVIDER = undefined;
  mockEnv.RECAPTCHA_SECRET_KEY = undefined;
  mockEnv.RECAPTCHA_SITE_KEY = undefined;
  mockEnv.RECAPTCHA_MIN_SCORE = undefined;
  mockEnv.HCAPTCHA_SECRET_KEY = undefined;
  mockEnv.HCAPTCHA_SITE_KEY = undefined;
  mockEnv.TURNSTILE_SECRET_KEY = undefined;
  mockEnv.TURNSTILE_SITE_KEY = undefined;
}

function mockFetchSuccess(body: Record<string, unknown>, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  } as Response);
}

// ─── getCaptchaProvider ───────────────────────────────────────────────────────

describe("getCaptchaProvider", () => {
  beforeEach(() => {
    resetEnv();
    vi.clearAllMocks();
  });

  it("returns 'none' when no env vars are set", () => {
    expect(getCaptchaProvider()).toBe("none");
  });

  it("returns 'recaptcha' when CAPTCHA_PROVIDER='recaptcha'", () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    expect(getCaptchaProvider()).toBe("recaptcha");
  });

  it("returns 'hcaptcha' when CAPTCHA_PROVIDER='hcaptcha'", () => {
    mockEnv.CAPTCHA_PROVIDER = "hcaptcha";
    expect(getCaptchaProvider()).toBe("hcaptcha");
  });

  it("returns 'turnstile' when CAPTCHA_PROVIDER='turnstile'", () => {
    mockEnv.CAPTCHA_PROVIDER = "turnstile";
    expect(getCaptchaProvider()).toBe("turnstile");
  });

  it("returns 'none' when CAPTCHA_PROVIDER='none'", () => {
    mockEnv.CAPTCHA_PROVIDER = "none";
    expect(getCaptchaProvider()).toBe("none");
  });

  it("returns 'recaptcha' from RECAPTCHA_SECRET_KEY when no CAPTCHA_PROVIDER set", () => {
    mockEnv.RECAPTCHA_SECRET_KEY = "secret-recaptcha";
    expect(getCaptchaProvider()).toBe("recaptcha");
  });

  it("returns 'hcaptcha' from HCAPTCHA_SECRET_KEY when no CAPTCHA_PROVIDER or RECAPTCHA_SECRET_KEY", () => {
    mockEnv.HCAPTCHA_SECRET_KEY = "secret-hcaptcha";
    expect(getCaptchaProvider()).toBe("hcaptcha");
  });

  it("returns 'turnstile' from TURNSTILE_SECRET_KEY when no higher-priority keys set", () => {
    mockEnv.TURNSTILE_SECRET_KEY = "secret-turnstile";
    expect(getCaptchaProvider()).toBe("turnstile");
  });

  it("CAPTCHA_PROVIDER takes precedence over individual secret keys", () => {
    mockEnv.CAPTCHA_PROVIDER = "hcaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    expect(getCaptchaProvider()).toBe("hcaptcha");
  });

  it("RECAPTCHA_SECRET_KEY takes precedence over HCAPTCHA_SECRET_KEY", () => {
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    mockEnv.HCAPTCHA_SECRET_KEY = "hk";
    expect(getCaptchaProvider()).toBe("recaptcha");
  });
});

// ─── getCaptchaSiteKey ────────────────────────────────────────────────────────

describe("getCaptchaSiteKey", () => {
  beforeEach(() => {
    resetEnv();
    vi.clearAllMocks();
  });

  it("returns null when provider is 'none'", () => {
    expect(getCaptchaSiteKey()).toBeNull();
  });

  it("returns RECAPTCHA_SITE_KEY when provider is recaptcha", () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SITE_KEY = "site-recaptcha";
    expect(getCaptchaSiteKey()).toBe("site-recaptcha");
  });

  it("returns null when provider is recaptcha but RECAPTCHA_SITE_KEY is unset", () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    expect(getCaptchaSiteKey()).toBeNull();
  });

  it("returns HCAPTCHA_SITE_KEY when provider is hcaptcha", () => {
    mockEnv.CAPTCHA_PROVIDER = "hcaptcha";
    mockEnv.HCAPTCHA_SITE_KEY = "site-hcaptcha";
    expect(getCaptchaSiteKey()).toBe("site-hcaptcha");
  });

  it("returns TURNSTILE_SITE_KEY when provider is turnstile", () => {
    mockEnv.CAPTCHA_PROVIDER = "turnstile";
    mockEnv.TURNSTILE_SITE_KEY = "site-turnstile";
    expect(getCaptchaSiteKey()).toBe("site-turnstile");
  });
});

// ─── verifyCaptcha ────────────────────────────────────────────────────────────

describe("verifyCaptcha", () => {
  beforeEach(() => {
    resetEnv();
    vi.clearAllMocks();
  });

  it("returns { success: true } when provider is 'none'", async () => {
    const result = await verifyCaptcha("any-token");
    expect(result).toEqual({ success: true });
  });

  it("returns { success: true } (fail-open) when secret key is missing", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    // RECAPTCHA_SECRET_KEY is undefined
    const result = await verifyCaptcha("any-token");
    expect(result).toEqual({ success: true });
  });

  it("calls the reCAPTCHA verify URL with correct params", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "test-secret";
    const fetchSpy = mockFetchSuccess({ success: true, score: 0.9 });

    await verifyCaptcha("my-token", "1.2.3.4");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.google.com/recaptcha/api/siteverify");
    expect(opts.method).toBe("POST");
    expect((opts.body as string)).toContain("secret=test-secret");
    expect((opts.body as string)).toContain("response=my-token");
    expect((opts.body as string)).toContain("remoteip=1.2.3.4");
  });

  it("returns { success: true } for a successful hCaptcha response", async () => {
    mockEnv.CAPTCHA_PROVIDER = "hcaptcha";
    mockEnv.HCAPTCHA_SECRET_KEY = "hk-secret";
    mockFetchSuccess({ success: true });

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(true);
  });

  it("returns { success: true } for a successful Turnstile response", async () => {
    mockEnv.CAPTCHA_PROVIDER = "turnstile";
    mockEnv.TURNSTILE_SECRET_KEY = "ts-secret";
    mockFetchSuccess({ success: true });

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(true);
  });

  it("returns { success: false } when API response has success=false", async () => {
    mockEnv.CAPTCHA_PROVIDER = "hcaptcha";
    mockEnv.HCAPTCHA_SECRET_KEY = "hk-secret";
    mockFetchSuccess({ success: false, "error-codes": ["invalid-input-response"] });

    const result = await verifyCaptcha("bad-token");
    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(["invalid-input-response"]);
  });

  it("returns { success: false, errorCodes: ['api-error'] } on HTTP error", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    mockFetchSuccess({}, false, 503);

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(["api-error"]);
  });

  it("returns { success: false, errorCodes: ['network-error'] } when fetch throws", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network failure"));

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(["network-error"]);
  });

  it("reCAPTCHA v3: fails when score is below 0.5 (default threshold)", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    mockFetchSuccess({ success: true, score: 0.3 });

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(false);
    expect(result.score).toBe(0.3);
  });

  it("reCAPTCHA v3: passes when score equals 0.5 (exactly at threshold)", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    mockFetchSuccess({ success: true, score: 0.5 });

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(true);
    expect(result.score).toBe(0.5);
  });

  it("reCAPTCHA v3: passes when score is above 0.5", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    mockFetchSuccess({ success: true, score: 0.9 });

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(true);
    expect(result.score).toBe(0.9);
  });

  it("reCAPTCHA v3: respects custom RECAPTCHA_MIN_SCORE", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    mockEnv.RECAPTCHA_MIN_SCORE = 0.8;
    mockFetchSuccess({ success: true, score: 0.7 });

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(false);
  });

  it("reCAPTCHA v3: score check is skipped when score is absent from response", async () => {
    mockEnv.CAPTCHA_PROVIDER = "recaptcha";
    mockEnv.RECAPTCHA_SECRET_KEY = "rk";
    mockFetchSuccess({ success: true }); // no score field

    const result = await verifyCaptcha("token");
    expect(result.success).toBe(true);
    expect(result.score).toBeUndefined();
  });

  it("does not add remoteip to params when remoteIp is omitted", async () => {
    mockEnv.CAPTCHA_PROVIDER = "hcaptcha";
    mockEnv.HCAPTCHA_SECRET_KEY = "hk";
    const fetchSpy = mockFetchSuccess({ success: true });

    await verifyCaptcha("token");

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((opts.body as string)).not.toContain("remoteip");
  });

  it("includes error-codes from API response in result", async () => {
    mockEnv.CAPTCHA_PROVIDER = "turnstile";
    mockEnv.TURNSTILE_SECRET_KEY = "ts";
    mockFetchSuccess({ success: false, "error-codes": ["timeout-or-duplicate"] });

    const result = await verifyCaptcha("token");
    expect(result.errorCodes).toEqual(["timeout-or-duplicate"]);
  });

  it("calls the hCaptcha verify URL", async () => {
    mockEnv.CAPTCHA_PROVIDER = "hcaptcha";
    mockEnv.HCAPTCHA_SECRET_KEY = "hk";
    const fetchSpy = mockFetchSuccess({ success: true });

    await verifyCaptcha("token");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hcaptcha.com/siteverify");
  });

  it("calls the Turnstile verify URL", async () => {
    mockEnv.CAPTCHA_PROVIDER = "turnstile";
    mockEnv.TURNSTILE_SECRET_KEY = "ts";
    const fetchSpy = mockFetchSuccess({ success: true });

    await verifyCaptcha("token");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
  });
});
