# Searqon alert delivery worker

The alert delivery worker is a separate Node.js process. It is not part of the web/API process and must not be deployed as a Vercel serverless function.

## Runtime

- Node.js 22 or newer.
- A dedicated PostgreSQL login that can SET LOCAL ROLE searqon_worker.
- Migrations through 0010_alert_delivery_outbox.sql applied.
- A runtime-injected destination encryption keyring.
- Outbound HTTPS egress to the provider hosts configured by customers.

The process claims only the alert_delivery job type. It cannot consume assessment, crawl, GEO sampling, or scheduled-report jobs.

## Environment

| Variable | Required | Description |
|---|---|---|
| SEARQON_WORKER_DATABASE_URL | Yes | Dedicated PostgreSQL login URL. Remote PostgreSQL connections require certificate verification. |
| SEARQON_WORKER_ID | Yes | Stable, auditable worker identifier (3–64 safe characters). |
| SEARQON_ALERT_DESTINATION_KEYRING_JSON | Yes | JSON keyring used to decrypt tenant-bound AES-256-GCM destination credentials. |
| SEARQON_WORKER_CONCURRENCY | No | Parallel alert jobs, default 2, range 1–10. |
| SEARQON_WORKER_POLL_MS | No | Idle poll interval, default 1000 ms, range 100–60000. |
| DATABASE_SSL_CA | No | PEM CA bundle for a private database CA. |

Keyring structure (illustrative; inject real 32-byte random keys from a secret manager, never commit them):

~~~json
{
  "currentVersion": "v1",
  "keys": {
    "v1": "<base64-encoded-32-byte-key>"
  }
}
~~~

Retain old key versions during rotation until every destination encrypted with them has been re-encrypted. The worker validates the keyring at startup and does not print it.

## Database role

The migrations create searqon_worker as a non-login, non-superuser, non-bypass-RLS role. Create a dedicated login using your database's secret-management procedure, then grant it membership:

~~~sql
GRANT searqon_worker TO searqon_alert_worker_login;
~~~

Do not reuse the API login. The worker performs a startup preflight using SET LOCAL ROLE searqon_worker and checks its required table, column, and sequence privileges. Startup fails closed if the login cannot assume the role or is missing privileges.

The worker reads a destination credential only while holding the current queue lease and fencing token. The request/API role cannot read destination ciphertext.

## Run

~~~sh
npm run start:alert-worker
~~~

Use a process supervisor or container orchestrator to restart the process after an unexpected exit and deliver SIGTERM for graceful shutdown. Shutdown stops new polling after the active worker cycle finishes.

## Egress policy

Allow outbound TCP 443 only to the exact provider hosts required by configured destinations:

- Slack: hooks.slack.com
- Microsoft Teams Workflows: customer workflow host under .logic.azure.com
- PagerDuty Events API: events.pagerduty.com

The sender resolves and validates public DNS addresses, pins the validated addresses to the TLS connection, verifies TLS certificates, rejects redirects, and bounds request/response sizes and timeouts. Do not permit arbitrary customer-supplied hosts or unrestricted outbound access at the network layer. Keep the host allowlist synchronized with provider documentation and customer configuration.

Microsoft retired Office 365 Connector-based Teams incoming webhooks in May 2026. Use a Teams Workflows webhook URL. The current payload is an Adaptive Card message.

## Delivery semantics

- The outbox and worker queue are durable and lease-fenced.
- PagerDuty receives the stable alert event ID as dedup_key.
- Slack and Teams incoming webhooks do not provide a general idempotency contract. A provider may accept a request while the response is lost; a later retry can produce a duplicate. Delivery is therefore at-least-once for these channels.
- The worker does not log destination URLs, credentials, alert payloads, or provider response bodies. Logs contain aggregate counters and bounded machine error codes only.

## Production readiness boundary

This process bootstrap and CI tests do not provision or deploy a worker. Before production activation, configure an external secret manager/KMS-backed key distribution, a dedicated restricted database login, network egress policy, process supervision, alerting on dead letters/retries, provider sandbox smoke tests, restore/rotation drills, and an independent security review. No provider credentials or paid infrastructure are created by this repository change.
