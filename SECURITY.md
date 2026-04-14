# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. **Email**: Send details to **yvawasthi1203@gmail.com** (or open a [private security advisory](https://github.com/Yash-Awasthi/aibyai/security/advisories/new) on GitHub)
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Affected files/endpoints
   - Severity assessment (CRITICAL/HIGH/MEDIUM/LOW)
   - Any suggested fixes

### What to Expect

- **Acknowledgment** within 48 hours
- **Initial assessment** within 5 business days
- **Resolution timeline** communicated after assessment
- **Credit** given in release notes (unless you prefer anonymity)

### Scope

The following are in scope:
- Authentication and authorization bypasses
- Remote code execution (RCE)
- SQL injection, XSS, SSRF, CSRF
- Sensitive data exposure (API keys, credentials)
- Sandbox escape vectors
- Workflow engine security issues

The following are out of scope:
- Vulnerabilities in dependencies (report upstream; we monitor via Dependabot)
- Social engineering attacks
- Denial of service via rate limiting (already mitigated)
- Issues in third-party services we integrate with

## Security Measures

This project implements:
- JWT authentication with HS256 pinning and Zod validation
- SSRF protection via DNS resolution and private IP blocking
- Rate limiting (Redis-backed for cluster deployments)
- Input validation on all route handlers
- Parameterized queries via Drizzle ORM (no raw SQL)
- File upload MIME type allowlist with path traversal protection
- Python sandbox with resource limits (ulimit)
- Automated dependency scanning via Dependabot and CodeQL
