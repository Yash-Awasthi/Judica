# Security Policy

At AI Council, we take security seriously. We are committed to maintaining a robust, engineering-grade platform that protects user data, API keys, and internal workflows.

## Supported Versions

Please ensure you are running the latest version of the application.

| Version | Supported          |
| ------- | ------------------ |
| `main` branch | :white_check_mark: |
| < `main` | :x:                |

We currently only provide security updates for the latest code on the `main` branch.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

To report a vulnerability, please open a **private GitHub Security Advisory** in this repository.

### Response SLA

* **Acknowledgment**: We aim to acknowledge your report within **48 hours**.
* **Patching**: For critical issues, we target releasing a patch within **14 days**.

We will keep you informed of our progress as we investigate and mitigate the issue.

## Scope

### In-Scope

We welcome reports concerning the security of the AI Council platform itself. This includes, but is not limited to:

*   **API Key Encryption**: The AES-256 encryption implementation for stored API keys. *If you find a way to bypass this and read plain-text keys from the database, please report it immediately.*
*   **Authentication & Authorization**: Flaws in the JWT implementation, session handling, or rate-limiting bypasses.
*   **SSE Streaming Pipeline**: Vulnerabilities in how the Server-Sent Events are handled, parsed, or broadcasted.
*   **Database Queries**: SQL injection or improper access controls via Prisma.
*   **Provider Adapter Engine**: Flaws in how we route and transmit data to third-party APIs.

### Out-of-Scope

The following items are outside the scope of this security policy:

*   **Third-Party Provider APIs**: Security vulnerabilities within OpenAI, Anthropic, Google Gemini, or other integrated services themselves.
*   **LLM Outputs**: The generated text or "hallucinations" from the AI models. (While we aim to reduce hallucinations via the Council architecture, LLM inaccuracies are not considered traditional security vulnerabilities).
*   **Denial of Service (DoS)**: Volumetric attacks against the public demo (if applicable).
*   **Missing Best Practices**: Reports of missing security headers or non-exploitable configuration issues, unless they lead to a direct, provable compromise.
