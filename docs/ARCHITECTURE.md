# Architecture and System Boundaries

## Architectural posture

Start as a modular TypeScript-first codebase with explicit domain contracts. Introduce services, queues, databases, browser workers, and provider dependencies only when a measured requirement justifies them. The initial public repository must run locally without cloud credentials or paid APIs.

## Ownership boundaries

- **Searqon owns:** SEO/AEO/GEO/AgEO assessment models, readiness rules, observation interpretation, explainable scoring, recommendations, verification logic, and discoverability-specific monitoring.
- **Tinlyt owns:** general web discovery, retrieval, extraction, and reusable evidence acquisition infrastructure. Searqon may integrate through a versioned adapter later; Tinlyt is not a runtime prerequisite.
- **TAS owns:** governed agent identity, authorization, orchestration, policy evaluation, and execution. Searqon must not grant execution authority, infer authorization from model output, or treat discovered endpoints as permission to act.
- **FadeReach owns:** approved prospecting and sales workflows. Any future integration is explicit and opt-in.

These boundaries are product contracts, not merely deployment choices.

## Logical components

1. **Domain contracts:** typed identifiers, observation classes, finding structures, confidence, severity, and methodology versioning.
2. **Acquisition adapters:** bounded public HTTP retrieval and later approved provider integrations.
3. **Evidence ledger:** append-oriented records linking source, acquisition, observation, parser, rule, and assessment versions.
4. **Assessment engine:** deterministic, versioned rules for scanner dimensions.
5. **GEO observation adapters:** provider-specific collection with explicit separation between consumer-facing observations and model API calls.
6. **Recommendation and verification:** actionable remediation and repeatable reassessment.
7. **Interfaces:** CLI and machine-readable output first; API and web application when user validation supports them.
8. **Hosted control plane (later):** tenant isolation, roles, billing, quotas, scheduling, audit trails, and managed retention.

## Observation classes

Every observation must use one explicit class:

- `crawl`
- `first_party`
- `consumer_observation`
- `model_api`
- `derived`
- `estimate`

Do not combine consumer-facing product observations with direct model API responses as if they were equivalent measurements. Provider, model, region, locale, prompt, sampling time, and relevant configuration must be recorded where applicable.

## Evidence record minimum

Evidence ledger entries wrap records in a sequence-numbered SHA-256 hash chain (`previousHash` → `entryHash`). This detects accidental or partial modification, reordering, and deletion within the verified chain. The chain is not a digital signature, trusted timestamp, WORM guarantee, or protection against an attacker who can rewrite the entire chain and replace its trusted root. Persistent storage, external root anchoring, retention, redaction, and deletion are separate controls.

An evidence record should preserve:

- stable evidence identifier and target scope
- source URL or source identifier
- acquisition method and observation class
- observed-at and collected-at timestamps
- provider/model/region/locale where relevant
- content digest and safe content reference
- parser, extractor, rule, and methodology versions
- configuration and sampling metadata
- links from evidence to finding, recommendation, and verification result
- retention, redaction, and deletion state

A digest supports integrity checks; it does not by itself make storage immutable. Hosted immutability requires a separately designed and verified storage/control mechanism. HTTP(S) source URLs are canonicalized and stored without query strings or fragments, and URLs containing embedded credentials are rejected. `verifyEvidenceRecord` checks the record shape and content-address identifier; `verifyEvidenceContent` additionally checks the supplied bytes against the recorded length and SHA-256 digest. These checks do not authenticate mutable metadata or replace signatures, append-only storage, or independent custody controls. The runtime factory and JSON Schema must remain aligned: source labels are limited to 2,048 Unicode code points, normalized media types to 255 characters, methodology versions to 128 characters, and content payloads to 2 MiB. Raw content is never included in the evidence record.

## Proposed implementation direction

TypeScript is the default for domain logic and integrations. A likely later stack is Node.js, PostgreSQL, a typed query layer, a PostgreSQL-backed job queue, and an isolated browser worker only where browser rendering is necessary. Framework selection is deferred until the first executable slice and its deployment needs are demonstrated.

Rust is not a default rewrite target. Consider it only after profiling identifies a CPU- or memory-bound component whose performance materially affects unit economics or reliability.

## Security invariants

- Network acquisition must defend against SSRF, DNS rebinding, redirect abuse, IP-literal tricks, IPv4-mapped IPv6, and metadata endpoints.
- Validate every redirect and retry destination; bind outbound connections to validated addresses where supported. A caller's authorization for the initial origin does not authorize a different origin reached through a redirect; cross-origin destinations require an explicit allowlist.
- Apply response-size, decompression, timeout, depth, concurrency, and content-type limits.
- Treat fetched pages, documents, metadata, prompts, and model outputs as untrusted data, never as executable instructions.
- Discovery of an API or MCP server confers no permission to authenticate, invoke tools, or transact.
- Tenant identifiers must be enforced at every data-access boundary before hosted multi-tenancy is introduced.
- Secrets must not be stored in source, logs, test fixtures, or evidence payloads.
- Provider outputs cannot override authorization, policy, or security controls.

## Evolution rules

Use versioned interfaces and migration notes. Avoid premature microservices. Do not make Searqon dependent on Tinlyt, TAS, a single LLM provider, or AWS. Cross-product integrations require explicit contracts, threat models, and acceptance tests.
