# Compare GEO snapshots and generate alerts

Searqon can compare two caller-supplied GEO aggregate snapshots and emit deterministic, evidence-labelled change events.

## Run

```bash
node src/cli.js geo alerts ./examples/geo-alert-input.json
```

Write the report without overwriting an existing file:

```bash
node src/cli.js geo alerts ./examples/geo-alert-input.json --out ./geo-alert-report.json
```

The input contains `baseline` and `current` arrays produced by `aggregateGeoObservations`, stable snapshot IDs, UTC capture times, and an explicit evaluation time. Optional policy fields are `minSampleSize` (default 30), `minAbsoluteChange` (default 0.1), `cooldownSeconds` (default 0), and `previousAlerts` for caller-managed cooldown state.

## Comparison rules

- Cohorts must match observation class, provider, model, region, locale, brand, target domain and sample period.
- Consumer observations and direct model API observations are never compared or pooled.
- Duplicate cohorts, inconsistent counts, malformed timestamps and non-normalized provider metadata are rejected.
- A metric alert requires both samples to meet the minimum sample size, the absolute rate change to meet the configured threshold, and the two Wilson 95% intervals not to overlap.
- Mention rate and brand-domain citation rate are separate metrics.
- New and missing cohorts are reported as evaluations, not as wins or losses.
- Cooldown suppresses repeated notifications without hiding the underlying evaluations.
- Output includes sample counts, measured rate delta, cohort dimensions, baseline/current identifiers and observation lag.

The non-overlapping-Wilson rule is a conservative deterministic screening heuristic, not a full two-proportion hypothesis test. It does not correct for multiple comparisons. Treat results as operational signals for human review, not causal proof or a guarantee of AI search behavior.

## Signed webhook events

`createSignedAlertEvent` signs the exact serialized body with HMAC-SHA256 over `timestamp + "." + rawBody`. Deliver the returned body and headers unchanged. Receivers should verify the signature and timestamp against the raw request bytes, then persist the event ID in a durable idempotency store before processing. The library verifier binds the event ID to the envelope but is intentionally stateless; it does not by itself prevent replay.

Use a distinct high-entropy secret (at least 32 bytes) per destination. Store secrets in a secret manager or deployment environment, never in repository files, logs, reports or delivery receipts. Rotate secrets with a coordinated overlap strategy.

## Delivery adapters and retry metadata

Payload builders exist for Slack incoming webhooks, Microsoft Teams Workflows Adaptive Cards and PagerDuty Events API v2. They construct provider payloads only; they do not make network requests or store destination URLs. Delivery receipts record a bounded outcome, HTTP status, provider receipt identifier and retry time without storing credentials. Retry orchestration, durable queueing, destination ownership, encrypted secret storage, delivery idempotency and provider contract tests remain hosted-service work.

## Current limitations

This module consumes supplied aggregate snapshots. It does not schedule observations, query AI providers, scrape consumer interfaces, retrieve citation URLs, monitor competitors continuously or send webhook requests. It does not yet detect citation-domain replacement/order changes; the current citation metric measures whether the tracked brand's target domain was cited in each sample. Provider and observation-class provenance must be preserved by upstream collection.
