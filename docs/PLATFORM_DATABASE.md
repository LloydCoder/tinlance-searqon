# Hosted platform database foundation

**Status:** Hosted SaaS foundation (cross-cutting; product roadmap Phase 13). This is not a complete hosted service.

## Requirements

- PostgreSQL 16 or later.
- Apply ordered migrations with `npm run db:migrate` using `MIGRATION_DATABASE_URL` (or `DATABASE_URL` as a fallback) and a dedicated migration owner with CREATEROLE permission. Keep the runtime `DATABASE_URL` separate and least-privileged. The runner verifies SHA-256 checksums, serializes concurrent migration runs, and commits each migration plus its checksum in one transaction after removing any standalone outer transaction wrappers from the SQL file.
- Do not run migrations with the request-serving database identity.
- The CI workflow runs the migration against a disposable PostgreSQL 16 service and exercises the row-level security policies.

## Initial relational model

- `app_users`: normalized email identity and minimal profile fields.
- `organizations`: customer workspaces.
- `memberships`: user-to-workspace relationship and role.
- `projects`: organization-scoped target properties.
- `assessments`: organization/project-scoped assessment lifecycle and JSON report.
- `sessions`: token digest, 30-minute inactivity timeout via `last_seen_at`, 24-hour absolute expiry and revocation metadata.
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
- Asynchronous worker database integration and job orchestration.
- Project update/archive/delete endpoints and invitation/role administration flows.
- Queue, scheduler, quotas, billing, provider adapters or live monitoring.
- Encryption/key management, backup/restore automation, data residency or physical deletion workflows.
- Production DB roles, network policies, secrets, backups, SLOs or deployment.

The passwordless authentication service uses narrowly scoped SECURITY DEFINER functions for account provisioning and session lookup; the runtime role cannot directly access authentication-token or rate-limit tables. The Node.js adapter is wired into registration, magic-link verification, session lookup/logout and authenticated profile loading. The workspace service also persists projects and synchronous project assessments through tenant-scoped RLS transactions; worker execution and asynchronous orchestration are not yet wired into the running HTTP API.


## Node.js database adapter

The repository pins `pg@8.23.1` (node-postgres) and commits the generated npm lockfile. The adapter in `src/platform/database.js` provides a bounded pool, connection and statement timeouts, keepalive, safe pool-error reporting, and a tenant transaction helper. Remote database connections require TLS certificate verification; plaintext is allowed only for loopback development hosts.

`withUserTransaction(pool, userId, work)` starts a transaction, assumes `searqon_app` with `SET LOCAL ROLE`, and sets `searqon.user_id` with a parameterized transaction-local `set_config` call. The identity must be sourced from an independently authenticated server-side session, not from client input. It commits on success, rolls back on failure, and destroys the connection if rollback fails. The transaction-local setting is cleared by PostgreSQL when the transaction ends.

Unit tests cover URL validation, pool bounds, TLS policy, safe error reporting, commit/rollback behavior and connection disposal. A PostgreSQL integration test runs the helper against a disposable PostgreSQL 16 service with a one-connection pool, proving RLS isolation across sequential identities and absence of tenant context when no identity is set.

The adapter is wired into passwordless authentication and the tenant-scoped project/assessment service. Project creation/list/detail and synchronous persisted assessments run through RLS transactions and append-only audit events. Background workers, asynchronous jobs and production operations remain incomplete.

## Durable usage ledger and quota reservations

Migration `0004_usage_ledger.sql` adds tenant-scoped PostgreSQL usage periods, reservations and append-only usage events. The runtime adapter in `src/platform/usage-ledger.js` is intentionally a server-side service primitive; no public route or worker dispatch path is wired to it yet.

- The billing period is resolved by a trusted server-side subscription resolver; request-supplied dates are ignored, preventing customers from resetting quotas by choosing arbitrary period boundaries. For trials, that resolver must use the trial start and expiry as the period boundaries so the 500-answer-check trial allowance is lifetime-scoped rather than reset monthly. Each meter period snapshots its included limit, while one shared tenant-period spend-control row snapshots the plan, a SHA-256 fingerprint of the complete entitlement policy, overage opt-in and the spend cap across all meters. A plan, feature, quota, rate or spend-policy change cannot silently rewrite an active period; period policy changes require an explicit future migration/workflow.
- Reservation creation serializes the organization-scoped idempotency key, then locks the shared tenant-period spend row and tenant/meter/period counter with `SELECT ... FOR UPDATE`. It splits included and overage units and reserves both quota and aggregate overage spend before provider work can be dispatched.
- Organization-scoped idempotency keys prevent retries from reserving twice. Reusing a key for a different meter, quantity or period is rejected.
- Reservations expire after a bounded 15-minute default (configurable only within 30–3,600 seconds). Settlement checks expiry against the PostgreSQL clock. The bounded `releaseExpired` operation uses `FOR UPDATE SKIP LOCKED` to release abandoned reservations without double-releasing concurrent work.
- Settlement is bounded by the reservation, uses the overage rate and block size stored on that reservation, commits actual usage and releases unused reserved quota/spend in the same transaction. A repeated settlement with the same actual quantity is idempotent; a different quantity is rejected.
- Release returns reserved quota and spend without recording consumption. Only enumerated release reasons are accepted.
- Usage ledger events are append-only at the database trigger layer and record the authenticated actor; reservations retain their creator. Mutable counters and reservation state are transactionally updated with their corresponding immutable events. PostgreSQL RLS separately enforces membership for reads and owner/admin/analyst roles for writes.
- RLS is forced on counters, reservations and ledger entries. The restricted runtime role can access only rows for workspaces where the authenticated transaction identity has a membership. Usage writes require owner, admin or analyst role.
- Quota and spend arithmetic uses bounded safe integers in application code and PostgreSQL bigint constraints. Overage remains fail-closed unless the trusted server-side entitlement resolver explicitly supplies an enabled policy and positive spend cap.

The integration suite verifies concurrent reservations at the included quota boundary, duplicate request idempotency, settlement/release behavior, overage quote capture and partial settlement, cross-tenant isolation, and rejection of ledger mutation.

**Still not implemented:** customer-facing overage-consent workflow, provider-specific webhook signature verification and HTTP ingestion, durable inbox processing/reconciliation worker, invoice settlement, automated subscription lifecycle writes, automated reservation expiry/reconciliation, worker dispatch integration, API-wide entitlement enforcement, billing notifications, provider budget controls, or production billing operations. Do not treat these primitives as a complete billing system or enable paid usage solely because they exist.


## Subscription lifecycle and verified webhook inbox

Migration `0005_billing_lifecycle.sql` introduces a tenant-scoped subscription source-of-truth table, a redacted billing webhook inbox and an append-only subscription event history.

- A workspace has at most one current subscription row. Provider/customer/subscription identifiers are uniquely constrained; plan/status, trial, billing interval and period invariants are enforced in PostgreSQL.
- The current subscription and its event history are readable only by workspace members through forced RLS. The request-serving `searqon_app` role has SELECT-only access; it cannot create or mutate subscription state.
- The webhook inbox is forced-RLS and has no grants or policies for `searqon_app`. It is reserved for a future dedicated billing worker identity. Provider/event IDs are unique, giving the future worker an idempotency key. Processing state includes bounded attempts, retry time and an expiring lease.
- The inbox stores a SHA-256 digest of the original raw request body and an allowlisted normalized JSON payload capped at 16 KiB. It does not store raw webhook bodies, card data or arbitrary provider payload fields.
- `src/platform/billing-events.js` is the provider-neutral normalization boundary. It requires the caller to attest that signature verification already succeeded and rejects unsupported events, invalid identifiers, plan/status combinations and invalid UTC periods. It is not a provider signature verifier or HTTP endpoint.
- No payment provider is selected or connected. There is no webhook route, subscription writer, billing worker, invoice reconciliation, checkout, payment collection or paid-plan activation. A separate least-privilege worker, provider-specific raw-body signature verifier, replay/idempotency handling and reconciliation process are mandatory before accepting billing events.

The CI PostgreSQL job applies the migration and checks subscription constraints, webhook-event uniqueness, forced RLS and the runtime role's inability to read the privileged inbox. This is schema and normalization groundwork, not a complete billing lifecycle.


## Canonical subscription entitlement resolver

`src/platform/subscription-entitlements.js` resolves the active plan from `searqon.subscriptions` using the caller's already-authenticated tenant transaction. It does not accept a plan, trial date or billing-period boundary from the HTTP request.

- No subscription row resolves to Free with UTC calendar-month boundaries.
- Active subscriptions use the persisted provider billing period, but are downgraded to Free if the period has not started or has expired.
- Trials use the persisted trial start and expiry as the billing period, preserving the one-time trial allowance rather than resetting it monthly.
- Past-due, canceled and expired subscriptions resolve to Free.
- Overage is always disabled until an explicit customer-consent and spend-cap workflow is implemented.
- Forced RLS hides another tenant's subscription row. The runtime role has SELECT-only access and cannot mutate subscription state.

The resolver is a tested source for the usage-ledger entitlement callback, but it is not yet wired into every billable API or worker path. Subscription creation/update, provider webhook processing, overage consent, invoicing and end-to-end billing enforcement remain future work.


## Atomic fixed-quota consumption

Migration `0006_extended_usage_meters.sql` extends the durable usage ledger with `manual_assessments` and `supplied_geo_observations`. These meters have hard platform ceilings and do not support overage.

`createUsageLedger().consume(userId, organizationId, input, operation)` performs quota validation, usage counter mutation, reservation/settlement record creation, immutable usage-event insertion and the supplied database operation inside one tenant-scoped PostgreSQL transaction. If the operation throws, the quota and all operation writes roll back together. An idempotency key cannot consume the same allowance twice; a committed replay returns the prior usage receipt without rerunning the operation.

The workspace assessment service now uses this primitive for manual assessments. Assessment persistence, analyzer result/failure recording, audit event and quota consumption commit atomically. A failed analyzer attempt is recorded and consumes one manual-assessment unit; a database/transaction failure rolls back both the assessment write and usage charge. The analyzer is local and synchronous; the atomic callback must not perform external network or provider side effects.

The PostgreSQL integration suite verifies concurrent quota boundaries, rollback on callback failure, idempotent replay, RLS and the Free plan's one-assessment monthly allowance. Other published entitlements (AI answer checks, crawling, keywords, API requests, scheduled reports, project/team counts and GEO observation limits) are not thereby enforced end-to-end; each product operation must be wired to the appropriate meter before those limits are represented as operational.
