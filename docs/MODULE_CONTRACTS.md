# Searqon Module Contracts and Acceptance Criteria

Status: normative requirements for future implementation. A contract is not evidence of implementation.

## Shared contract

Current published schema identities and version selection are governed by [the contract registry](../schemas/contract-registry.json). Current CLI/programmatic entry points and local persistence limitations are documented in [Public API and Persistence Boundaries](reference/public-api-and-persistence.md). These are implemented boundaries, not promises of hosted API availability.

Every module emits versioned schema-valid outputs; records source/evidence IDs, observation class, timestamps, methodology version, scope and limitations; separates observed facts from inference; explains confidence; bounds input/output/time/concurrency/retries/cost; supports disabled/no-op mode; applies data minimization, retention, deletion and redaction; and has unit, integration, adversarial and regression tests.

## Evidence lifecycle and retention contract

**Current implementation:** the local toolkit exposes a deterministic retention-expiry evaluator and a signed redaction-manifest/export-filter API. The evaluator returns metadata-only purge eligibility; the filter suppresses evidence from generated views only. Neither physically deletes or sanitizes ledger data.

**Acceptance:**
1. Retention evaluation requires an explicit policy interval and evaluation timestamp; it never uses an implicit system clock in deterministic decision tests.
2. Invalid evidence records, duplicate IDs, malformed timestamps and out-of-range policies are rejected.
3. Retention outputs contain only evidence IDs and lifecycle timestamps, not source labels, URLs, content or hashes.
4. Redaction manifests use a versioned strict schema, fixed reason codes, sorted unique evidence IDs and Ed25519 signatures.
5. Requester and approver identifiers are distinct; the caller must authenticate identities and bind approver keys to authorization policy.
6. Export filtering verifies every manifest and fails closed on invalid signatures, duplicate request IDs or invalid evidence records.
7. Source records and ledger entries are never mutated by retention evaluation or export filtering.
8. Logical suppression is not represented as physical deletion, cryptographic erasure or media sanitization.
9. Physical deletion requires separate storage-specific sanitization, backup expiry, legal-hold handling and verification; no such capability is currently claimed.
10. Any future ledger compaction must produce a new chain root and signed custody evidence, and must document the disposition and sanitization of prior copies.
11. Signed redaction manifests are persisted in a separate bounded, fsync'd hash-linked local journal; reopening verifies all manifest signatures and chain links.
12. Journal integrity limitations (recomputed-chain attacks, suffix truncation, full rewrite, no cross-process lock and no WORM guarantee) are disclosed; independent head checkpoint custody remains required.
13. Detached Ed25519 checkpoints bind journal prefix count and head hash; verification accepts later valid appends but rejects truncation or changes to the checkpointed prefix.
14. Checkpoint and trusted public key are stored outside the journal trust domain; caller-supplied createdAt is never represented as a trusted timestamp.


## A. Hallucination & Citation Defense

**Input:** customer-approved canonical entity ID, aliases, approved facts, authoritative source references, validity interval, review timestamp and owner; prompt cohort; permitted observations.

**Output:** claim discrepancy with subject/predicate/object, expected fact, observed claim, attribution, citations, provider/surface, cohort, evidence IDs, confidence, freshness, severity and remediation candidates.

**Acceptance:**
1. Every discrepancy traces to a captured observation and versioned approved fact.
2. Supported, contradicted, ambiguous, stale and unverifiable claims are distinct states.
3. Attribution swaps require entity-resolution confidence above a configurable threshold.
4. Single samples are low-confidence and cannot trigger high-severity alerts by default.
5. Consumer observations and direct model API responses remain separate cohorts.
6. Prompt, locale, region, provider/surface, model/version and timestamp are retained when available.
7. Repeated runs disclose sample size and uncertainty/confidence interval.
8. Correction manifests contain only source-supported proposals; no claim to alter model weights or force corrections.
9. Golden fixtures cover aliases, similar entities, stale pricing, attribution swaps, missing citations and contradictory sources.
10. Raw prompt/answer retention follows customer policy and is excluded from public reports by default.

## B. Competitor Citation-Change Alerts

**Input:** comparable baseline/current cohorts, entity map, alert policy and least-privilege delivery integration.

**Output:** event ID, change type, prior/current citation sets, affected cohort, sample counts, measured delta, uncertainty, threshold policy, evidence IDs, event time and delivery state.

**Acceptance:**
1. Comparability requires matching provider/surface, prompt cohort, locale and relevant collection configuration.
2. Policies support minimum sample, minimum effect, uncertainty threshold, cooldown and deduplication.
3. Citation loss, replacement, mention change and ordering change are separate event types.
4. Wording reports observed samples and cadence; no unsupported real-time claim.
5. Webhook signatures, timestamp tolerance and replay protection are tested.
6. Retries use bounded backoff and idempotency; receipts are auditable.
7. Slack/Teams/PagerDuty integrations are opt-in and disabled until configured.
8. Outages, rate limits, partial samples and stale baselines create degraded states, not false hijack alerts.
9. Labelled evaluation fixtures quantify false positives before release.

**Current implementation increment (not full acceptance):** the local toolkit now compares supplied aggregate snapshots using exact provider/locale/observation-class dimensions, minimum sample/effect thresholds, non-overlapping Wilson 95% intervals, deduplication and cooldown metadata. A raw-observation detector emits evidence-linked citation-domain disappearance events for one comparable cohort. HMAC-signed event envelopes, bounded delivery receipts and Slack/Teams/PagerDuty payload builders are available. This does not yet provide durable alert state, replay storage, source-domain replacement/order events, live collection, outbound delivery, retry queues or labelled false-positive evaluation. The interval rule is a conservative screen, not a multiple-comparison-corrected significance test.

## C. Agent Artifact Compiler

**Input:** authorized repository/revision or documentation scope; OpenAPI/MCP source material; output profile; scoped repository permission.

**Output:** deterministic artifact bundle, source-to-output provenance, validation results, warnings, diff, tests and optional PR metadata.

**Acceptance:**
1. Every generated factual statement maps to source evidence; unsupported content is omitted or marked unresolved.
2. Operations, auth, response semantics, prices and availability are never invented.
3. OpenAPI 3.2.x support and explicit 3.1.x compatibility are fixture-tested; unsupported features are reported.
4. llms.txt generation is optional and labelled convention, not normative standard or ranking guarantee.
5. Identical inputs/configuration produce deterministic output.
6. Links, anchors, code blocks, schemas and spec references are validated.
7. A diff is shown before any write; no overwrite, push, PR or publish without explicit authorization.
8. PR creation uses least privilege, dedicated branch and diff hash; auto-merge prohibited.
9. Prompt injection in source documents cannot change policy, repository scope or execution authority.
10. Fixtures cover malformed specs, broken links, contradictory facts, malicious markup, path traversal and oversized input.

## D. Simulated Agent Sandbox

**Input:** recorded authorization, environment/origins, operation allowlist, journey manifest, test identity and resource limits.

**Output:** journey graph, per-step result, sanitized protocol metadata, status/error classification, timing, evidence, policy decision and reproduction guidance.

**Acceptance:**
1. Passive analysis is default; active simulation requires separate opt-in authorization.
2. Staging and synthetic data are default; production writes disabled.
3. Only explicitly allowlisted hosts, paths and operations are reachable.
4. DNS, redirects and final connection destinations are validated against scope at connection time.
5. Worker cannot access host filesystem, metadata services, control-plane credentials, unrelated tenants or arbitrary egress.
6. Credentials are ephemeral, least privilege and redacted from logs/evidence.
7. Only safe read operations execute by default; mutation requires separate operation-level approval, synthetic fixtures and rollback.
8. Rate, concurrency, timeout, payload, response, CPU, memory and spend caps are enforced.
9. Brute force, credential guessing, destructive calls, privilege escalation and unrestricted fuzzing are prohibited.
10. Adversarial tests cover SSRF, DNS rebinding, redirect escapes, injection, token leakage, tenant isolation and worker escape.
11. Reports state clearly that simulation is not penetration testing or security certification.

## Future domain enums and compatibility

The following are future contract candidates, not current v1 runtime values:

- observationClass: current v1 evidence values are crawl | first_party | consumer_observation | model_api | derived | estimate. agent_simulation is reserved for a separately versioned simulation-run contract. GEO v1 remains consumer_observation | model_api.
- claimVerdict: supported | contradicted | ambiguous | stale | unverifiable. This describes a claim judgment, not a finding lifecycle.
- actionStatus: proposed | validated | approved | applied | verified | rejected | rolled_back. This is a governed recommendation/action lifecycle, not a current v1 finding status.
- executionMode: passive | simulated_read_only. Mutation is a separately approved operation-level capability, not a general execution mode.
- confidenceBand: high | medium | low | insufficient. This is distinct from the existing assessment confidence values none | heuristic | medium | high; no lossy automatic mapping is permitted.

Compatibility and versioning decisions are recorded in [ADR-0001](adr/0001-domain-contracts.md). These candidates must not be added to v1 schemas until a concrete producer/consumer, migration strategy and tests exist.

## Non-functional gates

Security: no unresolved critical/high findings; threat model and abuse cases reviewed. Reliability: bounded execution and explicit degraded states. Privacy: documented minimization, retention, deletion and redaction. Cost: per-run/per-tenant instrumentation and hard budget enforcement. Accessibility: keyboard-operable reports and alert configuration. Operations: secret-free structured logs, metrics, traces, audit events and runbooks.