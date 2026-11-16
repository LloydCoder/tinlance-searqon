# Hosted platform database foundation

**Status:** Phase 9 foundation only. This migration is not a complete hosted service.

## Requirements

- PostgreSQL 16 or later.
- Apply `db/migrations/0001_platform_core.sql` using a dedicated migration owner with permission to create the schema and the non-login `searqon_app` role.
- Do not run migrations with the request-serving database identity.
- The CI workflow runs the migration against a disposable PostgreSQL 16 service and exercises the row-level security policies.

## Initial relational model

- `app_users`: normalized email identity and minimal profile fields.
- `organizations`: customer workspaces.
- `memberships`: user-to-workspace relationship and role.
- `projects`: organization-scoped target properties.
- `assessments`: organization/project-scoped assessment lifecycle and JSON report.
- `sessions`: token digest, expiry, last-seen and revocation metadata.
- `audit_events`: append-only workspace audit records.

The assessment table has a composite foreign key to `projects(organization_id, id)`, preventing an assessment from referencing a project under a different organization.

## Row-level security

All tenant-owned tables use enabled and forced PostgreSQL RLS. The non-login `searqon_app` role is non-superuser, non-owner, non-createrole, non-createdb and `NOBYPASSRLS`. It cannot provision users or modify organization memberships. Membership administration and identity provisioning require separately scoped server-side workflows, which are not yet implemented.

For each authenticated request, the future API must:
1. Authenticate the user independently of request-supplied organization IDs.
2. Begin a database transaction.
3. Set `searqon.user_id` with a parameterized `set_config(..., true)` call inside that transaction.
4. Execute all tenant-scoped queries through the restricted runtime role.
5. Commit or roll back; transaction-local context must not leak through the connection pool.

RLS derives workspace access by checking a membership row for the authenticated user. A caller-provided `organization_id` is never authorization. The CI integration test proves that a user sees only their workspace's projects, assessments, organizations and audit records; a missing identity context sees no tenant data; cross-tenant writes are rejected.

**Trust boundary:** the application database role is a trusted server-side identity. PostgreSQL custom settings are not an independent cryptographic authentication mechanism. A compromised runtime role that can execute arbitrary SQL can attempt to set a different user context. Parameterized queries, strict query construction, least-privilege roles, network isolation and application authorization remain mandatory. Do not claim RLS alone protects against a fully compromised application/database credential.

## Audit events

Audit events can be selected and appended by an authorized workspace member. A database trigger rejects UPDATE and DELETE. This provides append-only behavior for the application role; database superusers and migration owners remain privileged trust anchors. Independent tamper-proof custody and export are future controls.

## Explicitly not implemented

- Login, passwordless verification, OAuth/OIDC, MFA, account recovery or session issuance.
- Invitation and membership provisioning.
- API/worker runtime database connection and migrations runner.
- Project and assessment CRUD endpoints.
- Queue, scheduler, quotas, billing, provider adapters or live monitoring.
- Encryption/key management, backup/restore automation, data residency or physical deletion workflows.
- Production DB roles, network policies, secrets, backups, SLOs or deployment.

The schema is a foundation contract; it is not yet wired into the running HTTP API.


## Node.js database adapter

The repository pins `pg@8.23.1` (node-postgres) and commits the generated npm lockfile. The adapter in `src/platform/database.js` provides a bounded pool, connection and statement timeouts, keepalive, safe pool-error reporting, and a tenant transaction helper. Remote database connections require TLS certificate verification; plaintext is allowed only for loopback development hosts.

`withUserTransaction(pool, userId, work)` starts a transaction and sets `searqon.user_id` with a parameterized transaction-local `set_config` call. The identity must be sourced from an independently authenticated server-side session, not from client input. It commits on success, rolls back on failure, and destroys the connection if rollback fails. The transaction-local setting is cleared by PostgreSQL when the transaction ends.

Unit tests cover URL validation, pool bounds, TLS policy, safe error reporting, commit/rollback behavior and connection disposal. A PostgreSQL integration test runs the helper against a disposable PostgreSQL 16 service with a one-connection pool, proving RLS isolation across sequential identities and absence of tenant context when no identity is set.

This adapter is not yet wired into the public web HTTP server. Authentication/session issuance, secure account provisioning and customer-facing project APIs remain incomplete.
