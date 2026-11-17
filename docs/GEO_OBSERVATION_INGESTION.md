# Caller-supplied GEO observations

Searqon can accept observations that a workspace member collected from an AI answer surface or an official model API. This is an ingestion and analysis path for caller-supplied evidence. It is not a live AI search crawler, browser automation, provider integration or claim that Searqon independently queried the provider.

## Submit

POST /api/v1/projects/{projectId}/geo/observations

Required JSON fields:

- idempotencyKey: stable caller-generated key (8–128 safe characters).
- prompt and answer: the observed prompt and returned answer.
- brand: the brand name used for mention analysis.
- provider.name: caller-supplied provider label.
- provider.observationClass: consumer_observation or model_api.
- citations: zero or more absolute HTTP(S) URLs.
- sampledAt: optional canonical UTC timestamp; defaults to submission time.
- targetDomain: optional DNS hostname for brand-domain citation analysis.
- provider.model, provider.region and provider.locale: optional caller-supplied context.

The service normalizes citations, removes URL fragments, counts brand mentions, checks target-domain citations, and creates a deterministic evidence digest. It stores the raw prompt/answer/citation payload and normalized observation under tenant RLS so the evidence can be re-verified later. Raw answers are returned only by the authenticated evidence endpoint, not by the observation list.

## Read

- GET /api/v1/projects/{projectId}/geo/observations?limit=50
- GET /api/v1/geo-observations/{observationId}/evidence

Observation list limits are 1–100. Evidence retrieval recomputes the observation digest from the stored raw payload and checks it against the immutable evidence record.

## Usage and idempotency

Each new, unique observation consumes one supplied_geo_observations unit in the workspace's canonical subscription period. The operation and usage ledger settlement commit in the same database transaction. Free and paid limits are enforced server-side; this meter has no overage path.

- Repeating the same idempotency key and same payload returns the original record without consuming another unit.
- Reusing an idempotency key with different content returns a conflict.
- Submitting the same evidence content with a different idempotency key is deduplicated by evidence identity and does not consume another unit.
- Evidence records are immutable and tenant/project scoped.

## Provenance and interpretation

Provider name, model, region, locale, observation class, prompt and answer are supplied by the caller. Searqon does not independently verify that the named provider generated the answer or that the supplied capture is complete. The system keeps consumer-facing observations separate from direct model API observations when aggregating results; these populations must not be blended into one visibility rate.

This ingestion path does not collect observations automatically. Live provider adapters require documented permission/terms review, provider-specific integration, credentials, cost controls and a separate scheduled-worker implementation. No provider credentials or paid infrastructure are configured by this feature.

## Data handling

Raw prompt and answer content is retained in PostgreSQL as evidence. Only authenticated workspace members can read it; writers can submit observations. The table is append-only. Production activation requires a published retention schedule, privacy/DPA review, database backup/restore controls and a customer deletion/legal-hold policy. Those operational controls are not provided by this API alone.
