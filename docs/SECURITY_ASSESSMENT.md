# Security Assessment and Verification Plan

**Status:** Engineering self-assessment; not an independent penetration test or ASVS certification.

## Baseline

Use OWASP Application Security Verification Standard (ASVS) 5.0.0 as the application-security control catalogue. The current implementation is an early SaaS foundation and must not be represented as ASVS Level 2 compliant. Controls are recorded as implemented, partial, or not yet evidenced.

Reference: https://asvs.owasp.org/ and https://github.com/OWASP/ASVS/tree/master/5.0

## Implemented controls and evidence

| Area | Current control | Evidence / implementation |
|---|---|---|
| Authentication | One-time email sign-in links, 32-byte random tokens, SHA-256 token digests, single-use consumption, server-side sessions | \`src/platform/auth.js\`; migrations 0001–0003; PostgreSQL integration tests |
| Session lifetime | 30-minute inactivity timeout and 24-hour absolute expiry; logout revokes server-side session | \`searqon.lookup_session\`; \`searqon.revoke_session\`; \`test/auth.integration.test.js\` |
| Session cookie | HttpOnly, SameSite=Lax, Path=/; production uses Secure and the __Host- prefix | \`apps/web/server.js\`; cookie regression tests |
| CSRF | Exact same-origin Origin checks on authenticated state-changing auth, project and assessment routes | \`apps/web/server.js\`; web-server tests |
| Authorization | Organization membership and role checks; owner/admin/analyst writes; viewer read-only | \`src/platform/workspaces.js\`; tenant integration tests |
| Tenant isolation | PostgreSQL RLS, transaction-local authenticated identity, restricted runtime role, forced RLS on tenant tables | \`db/migrations/\`; \`src/platform/database.js\`; PostgreSQL integration tests |
| Audit | Append-only tenant audit events for project creation and assessment outcomes | \`searqon.audit_events\`; trigger and RLS tests |
| Injection | Parameterized SQL; no request-built SQL identifiers | \`src/platform/workspaces.js\` |
| SSRF boundary | Project target URL is validated against public HTTP(S) destination policy; project assessment currently analyzes caller-supplied content and does not fetch target URLs | \`src/security/url-policy.js\`; \`src/platform/workspaces.js\` |
| Resource bounds | 2 MiB document limit, bounded JSON request readers, 16 KiB auth/project JSON body limit, Node header/request/keep-alive timeouts | \`apps/web/server.js\`; workspace validation |
| Browser protections | CSP, nosniff, frame denial, referrer and permissions policies; HSTS in production | \`apps/web/server.js\` |
| Supply chain | Locked dependencies, npm audit, SBOM validation, CodeQL and Gitleaks workflows | \`.github/workflows/\` |

PostgreSQL RLS is a second authorization boundary, not a replacement for application authorization. The runtime database role is deliberately restricted; migrations run with a separate privileged connection.

Reference: https://www.postgresql.org/docs/16/ddl-rowsecurity.html

## Open controls and release blockers

| Area | Required work before production acceptance |
|---|---|
| Identity assurance | MFA/WebAuthn, recovery policy, account disablement, email-change re-authentication, session inventory and user/admin session revocation |
| Session policy | Review inactivity/absolute limits against risk; define concurrent-session limits and re-authentication for sensitive actions |
| Authorization | Formal permission matrix, organization invitations, role administration, field-level access review and negative tests for every resource route |
| Abuse prevention | Per-user and per-organization quotas/rate limits for project creation, document assessment and future provider/worker usage |
| Data protection | Production encryption/key-management design, secrets manager, retention schedules, export/deletion workflows, backup encryption and restore evidence |
| Runtime isolation | Dedicated worker boundary, egress policy, resource quotas, parser isolation and adversarial tests before any browser or active-agent execution |
| Operational security | Centralized audit/alerting, incident response, vulnerability disclosure, dependency update policy, SLOs and on-call ownership |
| Privacy/legal | Data-flow inventory, processor/subprocessor review, lawful basis/consent review, cross-border transfer and retention review |
| Assurance | Independent penetration test and remediation retest; no unresolved critical/high findings before launch |

## Explicit safety boundaries

- No consumer AI interface scraping is enabled by this foundation.
- The project assessment endpoint does not retrieve the supplied target URL.
- The passive Agent Readiness analyzer must not invoke MCP tools.
- A provider observation is not a guarantee of universal model behavior.
- Sample dashboard data is not customer measurement.
- A successful CI run does not establish production readiness or certification.
- No deployment should occur until production identity, database, email, secret storage, monitoring, backup/restore and rollback configuration are reviewed.

## Acceptance evidence

Every security control must link to a code path, test, configuration or signed external assessment. Mark a control verified only when its positive and negative cases are tested on the production-equivalent deployment topology. Record exceptions with owner, rationale, expiry and compensating controls.
