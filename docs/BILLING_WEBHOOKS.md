# Billing webhook ingestion and reconciliation

**Status:** Paddle adapter and provider-neutral ingestion foundation implemented. Paddle remains unselected and disabled pending seller onboarding, credentials, price mapping and sandbox verification.

## Security boundary

The billing flow is deliberately split into three independent trust boundaries:

1. The Paddle adapter verifies `Paddle-Signature` over the exact original HTTP request bytes using HMAC-SHA256 and returns a minimal event containing `providerCreatedAt`, `verifiedAt`, provider event ID, event type and normalized subscription identity. Other providers require their own reviewed adapters.
2. `createBillingWebhookProcessor` enforces provider allowlisting, body limits, verification freshness, canonical schema validation and a raw-body SHA-256 digest. It does not persist raw bytes and does not grant entitlements.
3. `createBillingWebhookStore` accepts the canonical event into the redacted inbox using the dedicated ingest role. Provider/event IDs are unique; a repeated ID with a different tenant or raw-body digest is rejected as an event-ID collision.

A separate worker claims inbox rows using `FOR UPDATE SKIP LOCKED`, a bounded lease and a random fencing token. Completion and retry require the current worker identity and lease token. The worker handler must fetch the current subscription from the provider's canonical API; a signed webhook payload alone is not sufficient evidence to grant or revoke entitlements. `createBillingSubscriptionReconciler` applies the canonical snapshot with provider-event ordering and appends an immutable subscription event.

## Database roles

Migration `0018_billing_worker_boundary.sql` creates non-login, non-superuser, non-owner, non-`BYPASSRLS` roles:

- `searqon_billing_ingest`: insert canonical redacted events and read only the minimal columns needed to compare duplicate deliveries.
- `searqon_billing_worker`: claim/update inbox leases and reconcile tenant subscription snapshots and append-only subscription events.
- `searqon_app`: no inbox access and no subscription mutation privileges.

Create dedicated login roles using the database's secret-management procedure, then grant membership:

```sql
CREATE ROLE searqon_billing_ingest_login LOGIN INHERIT PASSWORD '<managed-secret>';
GRANT searqon_billing_ingest TO searqon_billing_ingest_login;

CREATE ROLE searqon_billing_worker_login LOGIN INHERIT PASSWORD '<managed-secret>';
GRANT searqon_billing_worker TO searqon_billing_worker_login;
```

Use separate connection URLs for the ingest and worker pools. Do not reuse `DATABASE_URL`, `MIGRATION_DATABASE_URL`, the application login or a superuser. Remote PostgreSQL connections must retain TLS certificate verification. Keep credentials in an external secret manager; never put them in repository files, logs or support tickets.

## Hosted checkout

The authenticated `POST /api/v1/workspaces/:organizationId/billing/checkout` endpoint is owner/admin-only and same-origin. It accepts a client-generated UUID request ID, a Searqon plan and a monthly/annual interval. The service resolves the configured Paddle price ID server-side; browser input cannot select an arbitrary price.

The service records a tenant-scoped checkout intent before calling Paddle, then creates an automatically-collected transaction with workspace and intent metadata. It validates the returned transaction ID, metadata and checkout URL against the configured HTTPS return origin/path before exposing the URL. A signed `subscription.created` event must carry the matching checkout intent ID and originating Paddle transaction ID; the worker also fetches the canonical subscription and verifies workspace/customer/subscription binding before marking that intent completed.

Paddle's transaction creation call is not assumed to be idempotent. Searqon requires a stable client request ID and persists it locally. If the provider call times out or returns an ambiguous response, the intent is marked `unknown` and is never automatically retried with the same request ID. This avoids accidentally creating multiple checkout transactions. A new request ID is not a recovery mechanism for an unknown provider outcome; reconcile the original intent first.

The checkout service is disabled unless `SEARQON_BILLING_WEBHOOKS_ENABLED=true` and the Paddle API/notification secrets, dedicated database URLs, price-to-plan map, checkout plan/interval map and approved HTTPS return URL are configured. No price IDs or provider credentials are committed.

## Provider adapter contract

A future provider adapter must:

- verify the signature over the exact raw bytes before parsing;
- enforce the provider's signed timestamp/replay window;
- validate the provider's event ID and event creation timestamp;
- map provider customer/subscription IDs to a workspace using provider-owned metadata or a separately verified mapping—not a caller-supplied organization ID;
- return only fields accepted by `normalizeVerifiedBillingEvent`;
- fetch canonical subscription state from the provider API before any subscription mutation;
- enforce provider request timeouts, response-size limits and safe error handling;
- never log authorization headers, webhook signatures, raw payloads or provider response bodies.

The Paddle adapter, hosted checkout service and runtime factory are implemented but are not activated. The checkout service creates a provider transaction, but Searqon does not yet maintain a complete invoice/transaction ledger or process refunds, disputes or payment-method changes. Those flows remain disabled until Paddle (or another provider) and its commercial/legal terms are explicitly approved. The current canonical event contract is not proof of money received; settlement requires the provider's canonical invoice/payment object and reconciliation policy.

## Runtime integration

The raw-byte HTTP route `POST /api/v1/billing/webhooks/:provider` is wired into the web process only when `SEARQON_BILLING_WEBHOOKS_ENABLED=true` and all Paddle secrets, dedicated database URLs and price mappings are configured. The worker runs separately with `npm run start:paddle-billing-worker`. Both processes use dedicated ingest/worker pools; remote URLs require `sslmode=verify-full` or `verify-ca`. Billing remains disabled by default. No Paddle credentials or price IDs are configured; sandbox verification and provider selection remain outstanding. Do not expose the ingest database role to the general request-serving process.

The webhook worker handler must return `{ reconciled: true }` only after it has successfully queried canonical provider state and committed the subscription update plus append-only event in one transaction. Failed reconciliation is retried with bounded exponential backoff; expired leases are fenced from completing or retrying another worker's event.

## Verification

- Unit tests cover signature-verification ordering, freshness windows, malformed/oversized bodies, generic failures and data minimization.
- PostgreSQL integration tests cover duplicate event delivery, event-ID collision rejection, app-role denial, inbox lease fencing and canonical subscription ordering.
- The CI PostgreSQL job applies migrations in order against a disposable database.

These tests do not prove a real provider signature, provider API behavior, a real invoice settlement, or production operations. Provider sandbox smoke tests and independent review remain mandatory.
