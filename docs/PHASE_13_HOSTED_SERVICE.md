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
