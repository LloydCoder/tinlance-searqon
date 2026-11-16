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

The input contains `baseline` and `current` arrays produced by `aggregateGeoObservations`, stable snapshot IDs, UTC capture times, and an explicit evaluation time. Aggregation preserves up to 500 evidence IDs per cohort plus the total evidence count and an explicit truncation flag; alerts carry both baseline and current evidence references. Reused evidence IDs across the two windows are rejected. Optional policy fields are `minSampleSize` (default 30), `minAbsoluteChange` (default 0.1), `cooldownSeconds` (default 0), and `previousAlerts` for caller-managed cooldown state.

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

## Labelled quality evaluation

Use `node src/cli.js geo quality-evaluate ./examples/geo-citation-alert-quality-input.json` to evaluate detector output against caller-labelled candidate domains. The report calculates true/false positives and negatives, precision, recall, specificity, false-positive rate and F1. The included fixture is synthetic and exists to verify methodology and regression behavior; it is not customer evidence, market validation or a production false-positive benchmark. Before launch, collect a sufficiently sized, independently reviewed, representative labelled set across providers, locales, prompt classes and time windows.

## Signed webhook events

`createSignedAlertEvent` signs the exact serialized body with HMAC-SHA256 over `timestamp + "." + rawBody`. Deliver the returned body and headers unchanged. Receivers should verify the signature and timestamp against the raw request bytes, then persist the event ID in a durable idempotency store before processing. The library verifier binds the event ID to the envelope but is intentionally stateless; it does not by itself prevent replay.

Use a distinct high-entropy secret (at least 32 bytes) per destination. Store secrets in a secret manager or deployment environment, never in repository files, logs, reports or delivery receipts. Rotate secrets with a coordinated overlap strategy.

## Delivery adapters and retry metadata

Payload builders exist for Slack incoming webhooks, Microsoft Teams Workflows Adaptive Cards and PagerDuty Events API v2. They construct provider payloads only; they do not make network requests or store destination URLs. Delivery receipts record a bounded outcome, HTTP status, provider receipt identifier and retry time without storing credentials. Retry orchestration, durable queueing, destination ownership, encrypted secret storage, delivery idempotency and provider contract tests remain hosted-service work.

## Citation-domain disappearance detection

For raw, normalized observation inputs rather than aggregate snapshots, use:

```bash
node src/cli.js geo citation-changes ./examples/geo-citation-change-input.json
```

This command normalizes each supplied baseline/current observation locally, then detects statistically screened disappearance of previously cited domains within one exact comparable cohort. Provider, model, region, locale, brand, target domain and observation class must match. It links both baseline and current evidence IDs. New citation appearances are retained as context in the underlying snapshots but are not yet emitted as separate alert types.

Reports disclose observation lag and a configurable freshness threshold; stale data is labelled rather than silently treated as real-time.

## Current limitations

This module consumes supplied aggregate snapshots. It does not schedule observations, query AI providers, scrape consumer interfaces, retrieve citation URLs, monitor competitors continuously or send webhook requests. It does not yet detect citation-domain replacement/order changes; the current citation metric measures whether the tracked brand's target domain was cited in each sample. Provider and observation-class provenance must be preserved by upstream collection.


## Provider payload references

Payload envelopes are aligned to the providers' published webhook formats. These adapters construct payloads only; destination registration, secure URL storage, delivery and response handling are separate capabilities.

- [Slack incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks)
- [Microsoft Teams Workflows incoming webhooks](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
- [PagerDuty Events API v2](https://docs.pagerduty.com/developer/events-api-v2-overview)
