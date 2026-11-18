# Phase 13 — Hosted service and integrations

**Canonical phase:** 13  
**Status:** IN_PROGRESS  
**Implementation branch:** `feat/phase-13-hosted-service-integrations`  
**Base:** Phase 12 merge commit `8199e64df261048733fcac95e161186765fc99a3`

Phase 13 extends the existing hosted identity, PostgreSQL tenant/RLS, subscription, usage-reservation, durable queue, worker and alert-delivery foundations. It must not rebuild those components or imply that the hosted service is production-ready.

## Scope and exit criteria

1. **Billing provider boundary**
   - Select a provider only after a recorded product/commercial decision and terms review.
   - Verify signatures over original raw request bytes with provider-specific adapters.
   - Persist only canonical, minimized events; enforce provider-event idempotency and replay controls.
   - Process events through a privileged, least-privilege worker and reconcile subscription state against the provider's canonical API.
   - Implement checkout, invoice settlement, refunds/disputes and lifecycle transitions only for the approved provider.
2. **End-to-end usage enforcement**
   - Apply the same server-side entitlement contract to every billable API and worker operation.
   - Atomically reserve before dispatch, settle actual usage, release failed work and preserve idempotency across retries.
   - Enforce tenant/provider budgets and customer spend caps before any external provider call.
3. **GEO scheduling and adapters**
   - Add scheduler persistence and bounded queue dispatch only after source policy/terms review, customer consent, labelled evaluation and per-tenant/provider cost caps.
   - Keep consumer-interface observations distinct from official API observations.
   - Do not introduce scraping or unattended collection as a side effect of scheduler infrastructure.
4. **Workspace administration**
   - Add invitation lifecycle, role administration and audit trails with same-tenant constraints.
   - Add MFA/SSO only when validated demand and an approved identity-provider approach exist.
5. **Secrets, retention and recovery**
   - Define KMS/secret-manager adapter contracts without introducing a paid dependency.
   - Implement retention, export/deletion and backup/restore evidence with explicit tenant scope.
6. **Production operations**
   - Production roles, network policy, observability, SLOs, incident response, rollback and deployment verification.
   - Production deployment is a separate approval gate; this phase branch does not authorize deployment or spend.

## Non-negotiable controls

- No new paid infrastructure, provider, plan upgrade or production deployment without explicit approval.
- No payment credentials or raw webhook bodies in logs or durable application tables.
- Browser input, unsigned webhooks, model output and tenant metadata cannot grant entitlements.
- Webhook signature verification must precede normalization and persistence.
- Provider-event IDs are idempotency keys; duplicate deliveries must not create duplicate subscription transitions.
- The application request role must not gain direct read/write access to privileged billing inbox tables.
- Use a separate, narrowly scoped billing-ingest/processor identity or reviewed database function boundary.
- No scheduler may exceed tenant entitlements, provider budgets, retry limits or customer-approved spend caps.
- No production-readiness or commercial-launch claim based on green CI alone.

## Increment 1 — provider-neutral webhook verification boundary

This increment adds a provider adapter interface around the existing canonical `normalizeVerifiedBillingEvent` contract. Each future provider adapter must verify its signature over the exact raw request bytes and return only a normalized provider event. The shared processor enforces:
- bounded raw-body size and strict provider allowlisting;
- signature-verification-before-normalization/persistence ordering;
- a bounded verification timestamp window;
- canonical event validation and SHA-256 digesting of the original bytes;
- minimized persistence input (no raw body or arbitrary provider fields);
- generic error responses that do not leak provider verification details;
- durable-acceptance result validation and duplicate-delivery reporting.

This is an integration boundary, not a live provider integration. No provider-specific cryptographic adapter, HTTP route, database writer credential, checkout, invoice settlement or subscription mutation is included in Increment 1. Provider selection remains an explicit decision.

## Increment 2 — durable billing inbox and canonical reconciliation

Implemented:
- Migration `0018_billing_worker_boundary.sql` creates separate non-login ingest and billing-worker roles with forced RLS and narrowly scoped privileges. The application role cannot read or mutate the billing inbox.
- The inbox stores only canonical allowlisted fields, a SHA-256 digest of original request bytes, verification time, provider event creation time and bounded processing metadata. Raw bodies, payment credentials and arbitrary provider fields are not persisted.
- Duplicate provider/event deliveries are idempotent. Reuse of an event ID with a different tenant or digest is rejected as a collision.
- Worker claims use `FOR UPDATE SKIP LOCKED`, bounded leases, random fencing tokens, bounded attempts and retry delays. A stale worker cannot complete or retry a lease it no longer owns.
- Canonical subscription reconciliation fetches current provider state through an injected provider adapter, applies provider-event ordering, enforces tenant/customer/subscription binding and appends immutable subscription events.
- The generic worker refuses to complete an event unless the injected handler confirms canonical provider reconciliation.

The raw-byte HTTP webhook route is implemented but returns 503 until a provider processor is injected. A Paddle HMAC-SHA256 signature adapter, sandbox/live canonical subscription API adapter and runtime assembly factory are implemented and unit-tested. Still outstanding: explicit provider approval, seller onboarding, real sandbox credentials, production bootstrap wiring, price catalogue approval, checkout, transaction/invoice settlement, refunds and disputes. The dedicated database URLs are placeholders and no production credentials are configured.

## Increment 3 — workspace invitations and administration

Implemented:
- Seven-day, one-time invitation tokens with SHA-256 hashes at rest and verified-email binding on acceptance.
- Invitation creation/reissue/revocation and owner/admin role hierarchy enforced in PostgreSQL security-definer functions.
- Owners may invite administrators; admins may invite analysts/viewers only. Admins cannot modify owner/admin roles. The final workspace owner cannot be demoted.
- Append-only audit events for invitation creation, acceptance, revocation and role changes.
- Authenticated, same-origin APIs for invitation management, acceptance, member listing and role updates.
- Invitation emails use escaped content and idempotency keys. Invite tokens are held in session-scoped browser storage during sign-in and removed from the URL fragment.
- Member listing omits email addresses; invitation history is visible only to owners/admins.

MFA, passkeys, OAuth/OIDC and enterprise SSO remain deferred until customer demand and an identity-provider decision are validated.

## Increment 4 — operational and data-protection runbooks

Added `docs/HOSTED_SERVICE_OPERATIONS.md` with backup/restore, retention, key custody, tenant deletion and restore-test requirements, and `docs/BILLING_WEBHOOKS.md` plus `docs/WORKSPACE_ADMINISTRATION.md` documenting runtime boundaries and operator procedures.

These are runbooks and control requirements, not evidence of a live KMS integration, automatic retention/deletion, production backup, restore drill, production network policy or incident exercise.

## Remaining Phase 13 blockers

1. Explicit payment-provider selection, terms/legal review, seller onboarding/payout verification, provider credentials and provider sandbox verification.
2. Provider-specific signature verification and canonical API adapters; production webhook endpoint and worker process wiring.
3. Checkout, invoice settlement, refunds/disputes and reconciliation of real payment objects.
4. Proof that every billable API and worker operation uses atomic reserve/settle/release under concurrency, retries and billing-period rollover.
5. Permitted GEO source/provider selection, terms review, consent, live adapters, scheduled sampling, labelled quality evaluation and hard tenant/provider spend caps. No scraping or unattended collection is enabled.
6. A managed KMS/secret-manager adapter and production key custody/rotation exercise.
7. Implemented and exercised tenant data export/deletion and retention enforcement, including legal holds and backup expiry.
8. Production roles, network egress, observability, SLOs, incident response, rollback, backup/restore and authorized staging verification.
9. Product-owner acceptance and evidence that the Phase 13 integration works in the authorized staging environment.

Paddle is the research recommendation, not an approved provider selection. No new paid provider, cloud resource, plan upgrade or production deployment is authorized. Provider and GEO integrations remain disabled until their respective policy, cost and credential gates are approved.

## Phase 13 acceptance gates

- Exact-head Node 22/24 CI, PostgreSQL integration, CodeQL and full-history secret scanning pass.
- Provider adapter contract and security review pass; a provider is selected only through an explicit decision.
- Database privileges and webhook replay/idempotency are verified against PostgreSQL integration tests.
- End-to-end metering is proven across API and workers under concurrency, retries, failures and period rollover.
- GEO scheduling remains disabled until terms, consent, evaluation and cost gates pass.
- Invitation/administration authorization and audit coverage pass.
- Retention, deletion, backup/restore, incident response and rollback are exercised.
- Staging verification and product-owner acceptance are recorded.
- Production deployment requires a separate explicit approval.

Phase 13 remains IN_PROGRESS until these gates are evidenced.
