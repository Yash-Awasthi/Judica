# Security Policy — Judica

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Active support |

---

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly — **do not open a public GitHub issue**.

### How to Report

1. **Email**: Send details to **yvawasthi1203@gmail.com**
2. **GitHub**: Open a [private security advisory](https://github.com/Yash-Awasthi/judica/security/advisories/new)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Affected files or endpoints
- Severity assessment (CRITICAL / HIGH / MEDIUM / LOW)
- Any suggested fix

### Response Timeline

| Step | Target |
|---|---|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 5 business days |
| Resolution timeline communicated | After assessment |
| Credit in release notes | Default (unless you prefer anonymity) |

### Scope

**In scope:**
- Authentication and authorization bypasses
- Remote code execution (RCE)
- SQL injection, XSS, SSRF, CSRF
- Sandbox escape vectors
- Sensitive data exposure (API keys, credentials, conversation data)
- Workflow engine security issues
- Privilege escalation (member → admin, cross-user data access)

**Out of scope:**
- Vulnerabilities in third-party dependencies (report upstream; we monitor via Dependabot and CodeQL)
- Social engineering attacks
- Rate limiting bypass where the rate limit is already configured
- Issues in third-party services we integrate with (OpenAI, Anthropic, etc.)
- Theoretical attacks with no practical exploit path

---

## Security Architecture

### Authentication & Sessions

- **JWT access tokens** — HS256, 15-minute TTL, algorithm pinned in verification
- **Refresh tokens** — 7-day TTL, stored httpOnly cookie, tracked in database for revocation
- **Password hashing** — argon2id (OWASP recommended, memory-hard). Legacy bcrypt hashes are transparently re-hashed to argon2id on next login.
- **OAuth2** — Google and GitHub via Passport.js. Email verification is enforced before account activation.
- **Constant-time comparison** — token comparison uses `crypto.timingSafeEqual()` to prevent timing attacks
- **Account suspension** — suspension status cached in Redis for fast rejection without DB hit

### Authorization

- **RBAC** — three roles: `admin`, `member`, `viewer`. Enforced via middleware on every route.
- **Resource ownership** — all mutations check `userId` or `createdBy` before modifying
- **Admin routes** — require explicit `requireAdmin` middleware; no implicit escalation path
- **Per-tenant quota enforcement** — token budget checked before each deliberation

### Encryption

- **Algorithm** — AES-256-GCM with per-record IV (nonce)
- **Key derivation** — `scrypt` (N=16384, r=8, p=1) for per-record key stretching from the master key
- **What's encrypted** — provider API keys, council configurations, memory backend credentials
- **Key rotation** — supported via versioned envelope (`CURRENT_ENCRYPTION_VERSION` env var). Old ciphertexts remain readable; new writes use the current version.
- **Admin rotation endpoint** — `POST /api/admin/rotate-keys` re-encrypts all records to the new key version

### Rate Limiting

All limits are Redis-backed (sliding window) and enforced via explicit `preHandler` middleware — not just plugin configuration, which CodeQL cannot statically trace.

| Endpoint | Limit | Implementation |
|---|---|---|
| `POST /auth/login`, `POST /auth/register` | 10 req/min | `authRateLimit` preHandler (`src/middleware/rateLimit.ts`) |
| `GET /` (static page) | 60 req/min | `staticPageRateLimit` preHandler (`src/app.ts`) |
| API endpoints | 60 req/min | Fastify rate-limit plugin + Redis store |
| `POST /sandbox/execute` | 10 req/min | Per-user sandbox rate limit |
| `POST /voice` | 20 req/min | Voice endpoint rate limit |

### Input Validation

- **Zod schemas** applied as Fastify `preHandler` middleware on all request bodies (`src/middleware/validate.ts`)
- **Safe math parser** — recursive descent parser for calculator tool; no `eval()` or `Function()`
- **LIKE wildcard escaping** — `%` and `_` escaped in all SQL LIKE clauses
- **File upload** — MIME type allowlist, path traversal protection via `path.resolve()` + boundary assertion

### SSRF Protection

`src/lib/ssrf.ts` validates all outbound URLs before connection:

- Resolves DNS and checks all returned IPs
- Blocks private ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Blocks link-local: `169.254.0.0/16` (including cloud metadata `169.254.169.254`)
- Blocks IPv6 loopback, unique-local, and link-local
- `redirect: "manual"` on all fetches — redirect targets are re-validated before following
- Applied everywhere: LLM adapter calls, `read_webpage` tool, workflow HTTP nodes, MCP client, research scraping

### Code Sandbox

**JavaScript** (`src/sandbox/jsSandbox.ts`):
- `isolated-vm` library — proper V8 isolate, not `vm.runInNewContext`
- 128 MB memory cap, 5-second timeout (SIGKILL)
- No access to Node.js APIs, network, or filesystem

**Python** (`src/sandbox/pythonSandbox.ts`) — defense in depth:

1. **Import restrictions** — `ctypes`, `subprocess`, `multiprocessing`, `signal`, `gc`, `inspect`, `dis`, `pickle` blocked at import hook level; also removed from `sys.modules`
2. **`os` hardening** — `os.system`, `os.popen`, `os.fork`, `os.exec*`, `os.spawn*`, `os.kill` replaced with `PermissionError` raisers
3. **Socket blocking** — `socket.socket` subclassed to block `connect`, `bind`, `sendto`, `sendmsg`, `fromfd`, `socketpair`
4. **File write restriction** — `open()` monkey-patched to allow writes only inside `/tmp`
5. **Namespace isolation** — bubblewrap (`bwrap`) with `--unshare-all`, `--die-with-parent`, read-only filesystem bind mounts, isolated `/proc`
6. **Syscall filtering** — seccomp-bpf policy blocks `ptrace`, `mount`, `bpf`, `unshare`, `kexec_load`, `perf_event_open`, and 25+ other dangerous syscalls
7. **Resource limits** — ulimit: 256 MB memory (`-v`), 10s CPU time (`-t`), 32 processes (`-u`)
8. **Timeout** — SIGKILL sent by Node.js `spawn` timeout (not just ulimit)
9. **Isolation tier fallback** — if bubblewrap is unavailable, falls back to `unshare` namespaces; production without either requires `ALLOW_UNSAFE_SANDBOX=1`

### HTML Sanitization

Web-scraped content and uploaded documents are sanitized before injection into LLM prompts:

- `<script>` and `<style>` tags stripped with a `while(prev !== result)` loop — handles nested-tag bypass (`<scr<script>ipt>`)
- Closing tag pattern `<\/script\s*>` matches space-before-`>` variants (`</script >`)
- All remaining HTML tags stripped via `<[^>]+>` replacement
- 1 MB content cap before stripping

### Headers

Applied globally by Fastify Helmet:

- `Content-Security-Policy` with per-request nonce (`script-src 'nonce-...'`)
- `Strict-Transport-Security` (HSTS) in production
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-Permitted-Cross-Domain-Policies: none`
- Request ID correlation header (`X-Request-Id`) on all responses

### PII Protection

`src/lib/pii.ts` automatically detects and risk-scores PII patterns (email, phone, SSN, credit card, etc.) before content is sent to external AI providers. Configurable redaction middleware available as a pipeline hook.

### Dependency Security

- Dependabot security alerts enabled on the repository
- GitHub CodeQL scanning on every push to `main`
- `package-lock.json` lockfile pins exact dependency versions
- `npm audit` recommended before releases

---

## Recent Security Fixes

| Date | CodeQL Alert | Fix |
|---|---|---|
| 2025 | `js/incomplete-multi-character-sanitization` (#67–69) | Loop-based HTML sanitization in `read_webpage.ts` |
| 2025 | `js/bad-tag-filter` (#70–72) | `\s*` in closing tag regex in `builtin.ts` |
| 2025 | `js/http-to-file-access` (#73) | Path canonicalization + boundary assertion in Python sandbox |
| 2025 | `js/file-system-race` (#74) | Atomic single read + ENOENT handling in `cost.ts` |
| 2025 | `js/insecure-temporary-file` (#75) | Assert audio file is not in `os.tmpdir()` before open |
| 2025 | `js/missing-rate-limiting` (#76, #78) | Explicit Redis `preHandler` on `GET /` and auth routes |
