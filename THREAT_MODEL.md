# Threat Model — AI by AI

> P4-07: Complements SECURITY.md with attack surface analysis for sandbox and MCP client.

## Trust Boundaries

```
┌─────────────────────────────────────────────────────┐
│                   Internet / User                     │
│   Browser ─── HTTPS ──▶ Fastify (Node.js)            │
│                          │                             │
│                    ┌─────┴──────┐                     │
│                    │  Auth/CSRF  │                     │
│                    └─────┬──────┘                     │
│                          │                             │
│          ┌───────────────┼───────────────┐            │
│          ▼               ▼               ▼            │
│    API Routes       Sandbox         MCP Client        │
│    (ask,admin)   (JS/Python)     (tool calls)         │
│          │               │               │            │
│          ▼               ▼               ▼            │
│    PostgreSQL     isolated-vm     External APIs        │
│    Redis          bubblewrap      (OpenAI, etc.)      │
│    BullMQ         /unshare                            │
└─────────────────────────────────────────────────────┘
```

## Attack Surfaces

### 1. Sandbox Execution (HIGH RISK)

**Threat**: Remote Code Execution via user-submitted code.

**Mitigations in place**:
- JavaScript: `isolated-vm` with 128MB memory limit, 5s timeout
- Python: `bubblewrap`/`unshare` OS-level sandbox with:
  - Import restrictions (blocks ctypes, subprocess, signal, etc.)
  - Socket blocking (no network access)
  - File write restrictions (/tmp only)
  - Memory and CPU limits
- Workflow expressions: `isolated-vm` with 32MB limit, 1s timeout, 2000 char limit (P3-27)

**Residual risks**:
- bubblewrap escape via kernel vulnerabilities
- Resource exhaustion within sandbox limits
- Side-channel timing attacks

### 2. MCP Client / Tool Calls (MEDIUM RISK)

**Threat**: Prompt injection causing tool misuse, SSRF, data exfiltration.

**Mitigations in place**:
- SSRF validation (`validateSafeUrl`) blocks private IPs, localhost, cloud metadata
- Per-provider API key scoping (P3-28)
- Circuit breaker pattern for external calls

**Residual risks**:
- DNS rebinding attacks bypassing SSRF check
- Prompt injection via tool results
- Rate limiting per-tool not enforced

### 3. Authentication & Authorization (MEDIUM RISK)

**Threat**: Session hijacking, privilege escalation, CSRF.

**Mitigations in place**:
- JWT + httpOnly cookies with SameSite
- CSRF protection via X-Requested-With header (P4-01)
- Admin routes require admin role middleware
- Constant-time token comparison (P4-03)
- Anonymous rate limiting (P0-01)
- Account suspension with Redis status cache

**Residual risks**:
- JWT rotation not implemented (long-lived tokens)
- No MFA support

### 4. Data Storage (LOW-MEDIUM RISK)

**Threat**: Data leakage, cross-tenant access, encryption key compromise.

**Mitigations in place**:
- AES-256-GCM encryption with HKDF key derivation
- Key rotation support (versioned envelope)
- Per-user data scoping (moving to per-org: P4-06)
- Semantic cache scoped by userId (P3-21)

**Residual risks**:
- No field-level encryption for PII in conversations
- Backup encryption not enforced

### 5. Supply Chain (LOW RISK)

**Threat**: Malicious dependencies, typosquatting.

**Mitigations in place**:
- Package lockfile
- Known dependency versions pinned

**Recommended additions**:
- `npm audit` in CI pipeline
- Dependabot or Renovate for dependency updates
- SBOM generation

## Data Flow Sensitivity

| Data Type | Encryption | Access Control | Notes |
|-----------|-----------|---------------|-------|
| API keys | AES-256-GCM | Per-user | Decrypted on-demand, not cached (P1-06) |
| Conversations | Plaintext in DB | userId scoped | Consider field-level encryption |
| Uploaded files | At-rest (disk) | userId scoped | Chunked via KB pipeline |
| Audit logs | Plaintext | Admin-only | Exported via streaming (P3-24) |
| Traces | Plaintext | userId scoped | Optional Langfuse integration |

## Recommended Future Hardening

1. Add WAF rules for common attack patterns
2. Implement JWT rotation with refresh tokens
3. Add MFA for admin accounts
4. Add field-level encryption for PII
5. Implement network policies for sandbox egress
6. Add SBOM and dependency scanning to CI
7. Rate limit per-tool in MCP client
8. Add DNS rebinding protection to SSRF validator
