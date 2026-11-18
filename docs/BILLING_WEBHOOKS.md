# Billing webhook ingestion and reconciliation

**Status:** Provider-neutral implementation foundation. No payment provider is selected or configured.

## Security boundary

The billing flow is deliberately split into three independent trust boundaries:

1. A provider adapter verifies the signature against the exact original HTTP request bytes and returns a minimal event containing `providerCreatedAt`, `verifiedAt`, provider event ID, event type and normalized subscription identity.
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

The Paddle adapter and runtime factory are implemented but are not activated. No checkout session, invoice settlement, refund, dispute or payment-method flow is enabled until Paddle (or another provider) and its commercial/legal terms are explicitly approved. The current canonical event contract is not proof of money received; settlement requires the provider's canonical invoice/payment object and reconciliation policy.

## Runtime integration

The raw-byte HTTP route `POST /api/v1/billing/webhooks/:provider` is implemented and accepts a processor by dependency injection. The Paddle runtime factory wires the signature adapter, inbox, canonical reconciler and worker, but the route returns 503 until the application bootstrap injects that runtime. No Paddle credentials or price IDs are configured; sandbox verification and provider selection remain outstanding. Do not expose the ingest database role to the general request-serving process.

The webhook worker handler must return `{ reconciled: true }` only after it has successfully queried canonical provider state and committed the subscription update plus append-only event in one transaction. Failed reconciliation is retried with bounded exponential backoff; expired leases are fenced from completing or retrying another worker's event.

## Verification

- Unit tests cover signature-verification ordering, freshness windows, malformed/oversized bodies, generic failures and data minimization.
- PostgreSQL integration tests cover duplicate event delivery, event-ID collision rejection, app-role denial, inbox lease fencing and canonical subscription ordering.
- The CI PostgreSQL job applies migrations in order against a disposable database.

These tests do not prove a real provider signature, provider API behavior, a real invoice settlement, or production operations. Provider sandbox smoke tests and independent review remain mandatory.
