/**
 * CAPTCHA Verification Service — supports multiple providers.
 *
 * Providers: reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile.
 */

import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "captcha" });

export type CaptchaProvider = "recaptcha" | "hcaptcha" | "turnstile" | "none";

interface CaptchaVerifyResult {
  success: boolean;
  score?: number;
  errorCodes?: string[];
}

// ─── Provider Verification URLs ───────────────────────────────────────────────

const VERIFY_URLS: Record<string, string> = {
  recaptcha: "https://www.google.com/recaptcha/api/siteverify",
  hcaptcha: "https://hcaptcha.com/siteverify",
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
};

// ─── Get Active Provider ──────────────────────────────────────────────────────

export function getCaptchaProvider(): CaptchaProvider {
  if (env.CAPTCHA_PROVIDER) return env.CAPTCHA_PROVIDER as CaptchaProvider;
  if (env.RECAPTCHA_SECRET_KEY) return "recaptcha";
  if (env.HCAPTCHA_SECRET_KEY) return "hcaptcha";
  if (env.TURNSTILE_SECRET_KEY) return "turnstile";
  return "none";
}

export function getCaptchaSiteKey(): string | null {
  const provider = getCaptchaProvider();
  switch (provider) {
    case "recaptcha": return env.RECAPTCHA_SITE_KEY ?? null;
    case "hcaptcha": return env.HCAPTCHA_SITE_KEY ?? null;
    case "turnstile": return env.TURNSTILE_SITE_KEY ?? null;
    default: return null;
  }
}

// ─── Verify CAPTCHA Token ─────────────────────────────────────────────────────

export async function verifyCaptcha(token: string, remoteIp?: string): Promise<CaptchaVerifyResult> {
  const provider = getCaptchaProvider();

  if (provider === "none") {
    return { success: true };
  }

  const secretKey = getSecretKey(provider);
  if (!secretKey) {
    log.warn({ provider }, "CAPTCHA secret key not configured");
    return { success: true }; // Fail open if misconfigured
  }

  const verifyUrl = VERIFY_URLS[provider];
  if (!verifyUrl) {
    return { success: false, errorCodes: ["unknown-provider"] };
  }

  try {
    const params = new URLSearchParams({
      secret: secretKey,
      response: token,
    });
    if (remoteIp) params.append("remoteip", remoteIp);

    const resp = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!resp.ok) {
      log.error({ status: resp.status, provider }, "CAPTCHA verification API error");
      return { success: false, errorCodes: ["api-error"] };
    }

    const data = await resp.json() as Record<string, unknown>;

    const result: CaptchaVerifyResult = {
      success: data.success === true,
      score: typeof data.score === "number" ? data.score : undefined,
      errorCodes: Array.isArray(data["error-codes"]) ? data["error-codes"] as string[] : undefined,
    };

    // For reCAPTCHA v3, enforce minimum score
    if (provider === "recaptcha" && result.score !== undefined) {
      const minScore = Number(env.RECAPTCHA_MIN_SCORE) || 0.5;
      if (result.score < minScore) {
        log.info({ score: result.score, minScore }, "reCAPTCHA score below threshold");
        result.success = false;
      }
    }

    if (!result.success) {
      log.info({ provider, errorCodes: result.errorCodes }, "CAPTCHA verification failed");
    }

    return result;
  } catch (err) {
    log.error({ error: (err as Error).message, provider }, "CAPTCHA verification error");
    return { success: false, errorCodes: ["network-error"] };
  }
}

function getSecretKey(provider: CaptchaProvider): string | undefined {
  switch (provider) {
    case "recaptcha": return env.RECAPTCHA_SECRET_KEY;
    case "hcaptcha": return env.HCAPTCHA_SECRET_KEY;
    case "turnstile": return env.TURNSTILE_SECRET_KEY;
    default: return undefined;
  }
}
