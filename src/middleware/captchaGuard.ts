/**
 * CAPTCHA + Email Validation Middleware
 *
 * Fastify preHandler hooks for protecting registration/login endpoints.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyCaptcha, getCaptchaProvider, getCaptchaSiteKey } from "../services/captcha.service.js";
import { validateEmail } from "../services/emailValidation.service.js";

/**
 * Require valid CAPTCHA token on the request body.
 * Skipped if no CAPTCHA provider is configured.
 */
export async function requireCaptcha(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const provider = getCaptchaProvider();
  if (provider === "none") return;

  const body = request.body as Record<string, unknown>;
  const captchaToken = body.captchaToken as string | undefined;

  if (!captchaToken) {
    reply.code(400).send({ error: "CAPTCHA verification required", provider });
    return;
  }

  const result = await verifyCaptcha(captchaToken, request.ip);
  if (!result.success) {
    reply.code(403).send({
      error: "CAPTCHA verification failed",
      errorCodes: result.errorCodes,
    });
    return;
  }
}

/**
 * Validate email is not from a disposable provider.
 * Expects email in request body.
 */
export async function rejectDisposableEmail(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as Record<string, unknown>;
  const email = body.email as string | undefined;

  if (!email) return; // Let other validators handle missing email

  const result = validateEmail(email);
  if (!result.valid) {
    if (result.reason === "disposable") {
      reply.code(422).send({
        error: "Disposable email addresses are not allowed. Please use a permanent email.",
        reason: "disposable_email",
      });
      return;
    }
    if (result.reason === "invalid_format") {
      reply.code(400).send({
        error: "Invalid email format",
        reason: "invalid_email",
      });
      return;
    }
  }
}
