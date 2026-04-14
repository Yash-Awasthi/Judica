# AIBYAI Security Audit — Open Items

> Last updated: April 14, 2026. Items resolved in this audit session have been removed. Only actionable remaining items are listed.

---

## HIGH Priority

### 1. Python sandbox lacks kernel-level isolation

**Location:** `src/sandbox/pythonSandbox.ts`

The Python code sandbox uses process-level isolation only (`ulimit` + socket monkey-patching). A malicious payload can bypass this via `ctypes` to make raw syscalls, escaping the sandbox entirely.

**Recommendation:** Use kernel-level namespace isolation — nsjail, bubblewrap, gVisor, or Firecracker per-execution containers. This is the single highest-risk remaining item for any deployment accepting untrusted code.

---

### 2. API keys stored in localStorage and sent in request body

**Location:** `frontend/src/views/SettingsView.tsx`, `frontend/src/context/AuthContext.tsx`

User-configured LLM API keys (OpenAI, Anthropic, etc.) are stored in `localStorage` and transmitted in the request body to the backend. This exposes keys to XSS attacks and browser extension access.

**Recommendation:** Store API keys server-side only. Frontend should reference keys by ID (e.g., `provider_key_id: "pk_123"`), never by value. Backend decrypts on use. This requires a new API endpoint and DB table.

---

## MEDIUM Priority

### 3. Auth tokens in localStorage (not httpOnly cookies)

**Location:** `frontend/src/context/AuthContext.tsx`

JWT access tokens are stored in `localStorage`, making them accessible to any JavaScript running on the page. Combined with an XSS vulnerability, this would allow full account takeover.

**Recommendation:** Migrate to `httpOnly` + `Secure` + `SameSite=Strict` cookies for session management. Requires backend changes to set cookies on login and validate them on each request. This is an architectural change that affects auth flow, CORS, and CSRF protection.

---

### 4. Express-to-Fastify migration incomplete

**Location:** `src/index.ts` (lines 231–306), `src/middleware/*.ts` (11 files)

The server uses `@fastify/express` compatibility layer for 11 middleware files, Swagger UI, and BullMQ Board. This adds overhead and complicates the request lifecycle (two different middleware chains).

**Files still on Express compat:**
- `middleware/rateLimit.ts`
- `middleware/limiter.ts`
- `middleware/errorHandler.ts`
- `middleware/auth.ts` (Express version, separate from Fastify auth)
- `middleware/requestId.ts`
- `middleware/cspNonce.ts`
- `middleware/prometheusMiddleware.ts`
- Swagger UI (`swagger-ui-express`)
- BullMQ Board (`@bull-board/express`)
- `pino-http` Express middleware
- `express.json()` body parser

**Recommendation:** Migrate each to native Fastify plugins. Replace `swagger-ui-express` with `@fastify/swagger-ui`. Replace BullMQ Board Express adapter with Fastify adapter. This can be done incrementally — one middleware at a time.

---

### 5. Accessibility (a11y) deficiencies

**Location:** Frontend-wide

The frontend lacks proper ARIA attributes, focus trapping in modals, keyboard navigation support, and screen reader labels throughout. This affects usability for users with disabilities and may create compliance issues.

**Recommendation:** Conduct an accessibility audit with axe-core or Lighthouse. Priority areas: modal dialogs (focus trap), form inputs (labels), interactive elements (keyboard handlers), color contrast, and screen reader announcements for dynamic content.

---

## LOW Priority

### 6. SerpAPI key fix may break integration

**Location:** `src/lib/tools/builtin.ts`

The previous audit moved the SerpAPI key from a URL query parameter to an HTTP header. However, SerpAPI's official API expects the key as a `api_key` query parameter, not a header. This fix may have broken the SerpAPI integration.

**Recommendation:** Verify SerpAPI auth mechanism. If query param is required, revert to query param but add log masking to prevent the key from appearing in access logs.

---

### 7. User settings not persisted server-side

**Location:** `frontend/src/context/AuthContext.tsx`, `frontend/src/views/SettingsView.tsx`

User preferences (autoCouncil, debateRound, coldValidator, piiDetection) are stored only in `localStorage`. They're lost on device change and can't be synced across sessions.

**Recommendation:** Create a `user_settings` table and `/api/settings` endpoint. Load on login, save on change. Low risk but impacts user experience.

---

<div align="center">

**[Back to README](./README.md)** · **[Roadmap](./ROADMAP.md)** · **[Security Policy](./SECURITY.md)**

</div>
