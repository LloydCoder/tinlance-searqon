# Local Web Application

**Status:** Cross-cutting web application increment. Local mode is supported; hosted production acceptance remains open.

The web application is a thin interface over the existing deterministic assessment engine. It does not replace the CLI, create a second rules engine, or claim hosted SaaS capabilities.

## Run locally

Requirements: Node.js 22 or later.

```bash
npm run dev:web
```

Open `http://127.0.0.1:4173`. To bind to another interface for a controlled local environment, set `HOST` explicitly. The default bind address is loopback.

## Current routes

| Route | Method | Purpose |
|---|---|---|
| `/api/v1/health` | GET | Liveness response |
| `/api/v1/ready` | GET | PostgreSQL readiness response |
| `/api/v1/auth/register` | POST | Create a workspace and send a one-time sign-in link |
| `/api/v1/auth/magic-link` | POST | Request a passwordless sign-in link |
| `/api/v1/auth/verify` | POST | Consume a one-time token and set the session cookie |
| `/api/v1/auth/me` | GET | Resolve the current session and workspace memberships |
| `/api/v1/auth/logout` | POST | Revoke the current session and clear the cookie |
| `/api/v1/assessments` | POST | Analyze caller-supplied HTML, Markdown or OpenAPI JSON; requires authentication in production |
| Other `/api/*` | Any | Structured 404 response |

The assessment request is JSON:

```json
{
  "source": "docs.example.test",
  "contentType": "text/html",
  "content": "<html><head><title>Example</title></head><body><h1>Docs</h1></body></html>"
}
```

The API returns the existing v1 assessment report, including evidence metadata, discipline coverage, findings, and limitations. It does not calculate or invent a universal score.

## Security and data boundary

- The web assessment endpoint accepts supplied document content only. It does not fetch the `source` label, follow links, execute scripts, render browser content, or connect to MCP servers.
- The existing analyzer enforces the 2 MiB document limit. The HTTP layer independently bounds request-body bytes.
- The server emits restrictive content-security and browser security headers, uses same-origin requests, rejects unsupported media types, and returns structured errors without stack traces.
- Static-file resolution is constrained to the application public directory; unknown file types and paths are not served.
- Authentication uses one-time email links, server-side session digests, origin validation, HttpOnly/SameSite cookies, HMAC-based database rate limits and a restricted PostgreSQL role. See [AUTHENTICATION.md](AUTHENTICATION.md).
- The API still lacks customer project CRUD, persisted assessment execution/history, background workers, provider observation adapters, billing, operational telemetry, backup/recovery and production deployment. It is not yet safe to expose as a public multi-tenant SaaS.
- Dashboard values in the marketing preview are illustrative sample data. They are not produced by the analyzer and must never be presented as customer measurements.

## Next hosted-service gates

A hosted product still requires project/assessment persistence, job orchestration, quotas, encryption/key management, audit lifecycle integration, backups/recovery, provider adapters, operational telemetry and deployment controls. Tenant isolation must be enforced in the database and every API/worker boundary. These concerns must not be simulated with browser-only state or hard-coded demo accounts.

The complete hosted product belongs in this same Searqon repository. Keep the open-source/local toolkit independently usable through modular boundaries and configuration, while implementing hosted identity, tenant persistence, billing and operations as internal packages and deployable applications in this codebase. Do not create a separate Searqon Cloud repository.


## Passwordless authentication

The same repository includes email-based registration, one-time magic-link login, server-side sessions, same-origin checks, cookie handling and an authenticated workspace shell. See [the authentication security and operations guide](AUTHENTICATION.md). Authentication is enabled only when a PostgreSQL runtime URL is configured. Email delivery uses Resend when configured; local-only console delivery requires explicit `SEARQON_EMAIL_MODE=console`. Project and assessment screens remain honest empty states until their persistence/API routes are implemented.
