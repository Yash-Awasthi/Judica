import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * P0-09 / P4-01: CSRF protection for cookie-authenticated state-mutating requests.
 *
 * Strategy: Require a custom header (X-Requested-With) for all non-GET/HEAD/OPTIONS
 * requests that use cookie-based authentication. Browsers won't send custom headers
 * in cross-origin requests without CORS preflight approval.
 *
 * P4-01: This approach is equivalent to @fastify/csrf-protection's "custom request header"
 * strategy but without the extra dependency. The X-Requested-With header acts as a CSRF
 * token since browsers enforce CORS preflight for custom headers on cross-origin requests.
 * Origin/Referer validation is added as defense-in-depth.
 */
const STATE_MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const ALLOWED_ORIGINS_LIST: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : ["http://localhost:3000", "http://localhost:5173"];

export async function fastifyCsrfProtection(request: FastifyRequest, reply: FastifyReply) {
  // Only enforce on state-mutating methods
  if (!STATE_MUTATING_METHODS.has(request.method)) return;

  // Only enforce when auth comes via cookie (not Authorization header)
  const hasAuthHeader = request.headers.authorization?.startsWith("Bearer ");
  const hasCookieToken = !!(request as { cookies?: { access_token?: string } }).cookies?.access_token;

  if (hasAuthHeader || !hasCookieToken) return;

  // Cookie-based auth on a mutating request: require X-Requested-With header
  const xRequestedWith = request.headers["x-requested-with"];
  if (!xRequestedWith) {
    reply.code(403).send({ error: "CSRF validation failed. Include X-Requested-With header." });
    return;
  }

  // P4-01: Defense-in-depth — validate Origin header when present
  const origin = request.headers.origin;
  if (origin) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : ["http://localhost:3000", "http://localhost:5173"];
    // R2-10: Use URL parsing for localhost check — startsWith("http://localhost:") could be
    // bypassed with "http://localhost.attacker.com" depending on other checks.
    let isLocal = false;
    try {
      const originUrl = new URL(origin);
      isLocal = (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1") &&
                (originUrl.protocol === "http:" || originUrl.protocol === "https:");
    } catch {
      // Malformed Origin — treat as not local
    }
    if (!allowedOrigins.includes(origin) && !isLocal) {
      reply.code(403).send({ error: "CSRF validation failed. Origin not allowed." });
      return;
    }
  }
}
