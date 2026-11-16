# Hosted platform database foundation

**Status:** Hosted SaaS foundation (cross-cutting; product roadmap Phase 13). This is not a complete hosted service.

## Requirements

- PostgreSQL 16 or later.
- Apply ordered migrations with `npm run db:migrate` using `MIGRATION_DATABASE_URL` (or `DATABASE_URL` as a fallback) and a dedicated migration owner with CREATEROLE permission. Keep the runtime `DATABASE_URL` separate and least-privileged. The runner verifies SHA-256 checksums and serializes concurrent migration runs.
- Do not run migrations with the request-serving database identity.
- The CI workflow runs the migration against a disposable PostgreSQL 16 service and exercises the row-level security policies.

## Initial relational model

- `app_users`: normalized email identity and minimal profile fields.
- `organizations`: customer workspaces.
- `memberships`: user-to-workspace relationship and role.
- `projects`: organization-scoped target properties.
- `assessments`: organization/project-scoped assessment lifecycle and JSON report.
- `sessions`: token digest, expiry, last-seen and revocation metadata.
- `auth_tokens`: one-time magic-link token digests and consumption state.
- `auth_rate_limits`: HMAC-keyed distributed abuse-control windows; raw email/IP values are not stored.
- `schema_migrations`: ordered migration names and SHA-256 checksums.
- `audit_events`: append-only workspace audit records.

The assessment table has a composite foreign key to `projects(organization_id, id)`, preventing an assessment from referencing a project under a different organization.

## Row-level security

All tenant-owned tables have PostgreSQL RLS enabled. Projects, assessments and audit events also use FORCE RLS. User, organization, membership and session tables do not FORCE RLS so narrowly scoped SECURITY DEFINER authentication functions owned by the migration/table owner can provision accounts and resolve sessions; the request-serving role is not the owner and remains subject to RLS. The non-login `searqon_app` role is non-superuser, non-owner, non-createrole, non-createdb and `NOBYPASSRLS`. It cannot directly provision users, modify memberships or read authentication tokens/rate-limit rows.

For each authenticated request, the API:
1. Authenticate the user independently of request-supplied organization IDs.
2. Begin a database transaction.
3. `SET LOCAL ROLE searqon_app` and set `searqon.user_id` with a parameterized `set_config(..., true)` call inside that transaction. The runtime login role must be a non-owner, non-superuser member of `searqon_app`.
4. Execute all tenant-scoped queries through the restricted runtime role.
5. Commit or roll back; transaction-local context must not leak through the connection pool.

RLS derives workspace access by checking a membership row for the authenticated user. A caller-provided `organization_id` is never authorization. The CI integration test proves that a user sees only their workspace's projects, assessments, organizations and audit records; a missing identity context sees no tenant data; cross-tenant writes are rejected. A separate end-to-end PostgreSQL test runs through a non-owner `searqon_runtime` login granted membership in `searqon_app`; it covers account provisioning, token replacement and replay rejection, session creation, profile resolution and logout. It runs only against a dedicated disposable `*_test` or `*_ci` database.

**Trust boundary:** the application database role is a trusted server-side identity. PostgreSQL custom settings are not an independent cryptographic authentication mechanism. A compromised runtime role that can execute arbitrary SQL can attempt to set a different user context. Parameterized queries, strict query construction, least-privilege roles, network isolation and application authorization remain mandatory. Do not claim RLS alone protects against a fully compromised application/database credential.

## Audit events

Audit events can be selected and appended by an authorized workspace member. A database trigger rejects UPDATE and DELETE. This provides append-only behavior for the application role; database superusers and migration owners remain privileged trust anchors. Independent tamper-proof custody and export are future controls.

## Explicitly not implemented

- OAuth/OIDC, passkeys, MFA, recovery codes, enterprise SSO and session-management UI.
- Invitation and additional membership administration.
- Project/assessment runtime persistence and worker database integration.
- Project and assessment CRUD endpoints.
- Queue, scheduler, quotas, billing, provider adapters or live monitoring.
- Encryption/key management, backup/restore automation, data residency or physical deletion workflows.
- Production DB roles, network policies, secrets, backups, SLOs or deployment.

The passwordless authentication service uses narrowly scoped SECURITY DEFINER functions for account provisioning and session lookup; the runtime role cannot directly access authentication-token or rate-limit tables. The Node.js adapter is wired into registration, magic-link verification, session lookup/logout and authenticated profile loading. Project/assessment persistence and worker execution are not yet wired into the running HTTP API.


## Node.js database adapter

The repository pins `pg@8.23.1` (node-postgres) and commits the generated npm lockfile. The adapter in `src/platform/database.js` provides a bounded pool, connection and statement timeouts, keepalive, safe pool-error reporting, and a tenant transaction helper. Remote database connections require TLS certificate verification; plaintext is allowed only for loopback development hosts.

`withUserTransaction(pool, userId, work)` starts a transaction, assumes `searqon_app` with `SET LOCAL ROLE`, and sets `searqon.user_id` with a parameterized transaction-local `set_config` call. The identity must be sourced from an independently authenticated server-side session, not from client input. It commits on success, rolls back on failure, and destroys the connection if rollback fails. The transaction-local setting is cleared by PostgreSQL when the transaction ends.

Unit tests cover URL validation, pool bounds, TLS policy, safe error reporting, commit/rollback behavior and connection disposal. A PostgreSQL integration test runs the helper against a disposable PostgreSQL 16 service with a one-connection pool, proving RLS isolation across sequential identities and absence of tenant context when no identity is set.

The adapter is wired into the passwordless authentication service. Customer-facing project/assessment persistence, background workers and production operations remain incomplete.
