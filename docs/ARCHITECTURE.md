# Architecture and System Boundaries

## Architectural posture

Build Searqon as **one repository and one product codebase**. All product surfaces and runtime components—including the open-source toolkit, marketing site, authenticated application, API, workers, persistence adapters, integrations, billing, and operations—belong in this repository. Use a modular TypeScript-first monorepo with explicit package and domain contracts; do not create a separate Searqon Cloud repository. Keep deployment units independently deployable from this repository where operationally justified, without splitting source ownership. Local development and the open-source toolkit must continue to work without cloud credentials or paid APIs.

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
8. **Application and control plane:** in this same repository, implement tenant isolation, roles, billing, quotas, scheduling, audit trails, managed retention, and customer-facing workspace capabilities. These are internal modules and deployable workloads, not a separate product repository.

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

Evidence ledger entries wrap records in a sequence-numbered SHA-256 hash chain (`previousHash` → `entryHash`). This detects accidental or partial modification, reordering, and deletion within the verified chain. The chain is not a digital signature, trusted timestamp, WORM guarantee, or protection against an attacker who can rewrite the entire chain and replace its trusted root. The current local JSONL adapter serializes appends and enforces a single active writer only within one Node.js process. It bounds file and entry sizes, uses owner-only file permissions, syncs appends, rejects symlink and hard-link targets, checks existing-file ownership where supported, requires the immediate parent directory to be owned by the current user and not group/world-writable on POSIX, and verifies the full chain when reopening. It stores metadata and digests, not raw content bytes. It is not encrypted, cross-process coordinated, remotely replicated, or WORM-immutable. The local ledger file itself is not digitally signed; detached signed checkpoints are a separate, caller-managed control and do not prevent a rewrite if the attacker can also replace the checkpoint or compromise the signing key. Detached Ed25519 checkpoints can sign the verified ledger root using a caller-supplied private key. A checkpoint detects subsequent ledger replacement only when the checkpoint and trusted public key are stored separately from the ledger. The signing key is never stored by the ledger adapter. The checkpoint creation time is an application timestamp, not a trusted timestamp. Out-of-band checkpoint custody, retention, redaction, deletion, and tenant access controls remain separate controls.

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


## Single-repository product structure

The repository is the source of truth for the complete Searqon product. Organize it as a modular monorepo with independently testable packages and deployable applications:

- `apps/web`: public marketing website and authenticated customer application.
- `apps/api`: versioned HTTP API, authentication/session boundary, workspace and project endpoints.
- `apps/worker`: scheduled and asynchronous assessment execution; isolated browser work only behind explicit policies.
- `apps/cli`: existing local and CI command-line interface.
- `packages/domain`: canonical domain entities, identifiers, contracts and invariants.
- `packages/assessment`: SEO, AEO, GEO and Agent-readiness assessment engines.
- `packages/evidence`: evidence ledger, provenance, integrity, retention and redaction contracts.
- `packages/acquisition`: bounded acquisition and provider adapters.
- `packages/recommendations`: explainable prioritization, remediation and verification.
- `packages/auth`: identity integration, sessions, RBAC and organization membership.
- `packages/persistence`: database schema, migrations, repositories and tenant-scoped data access.
- `packages/integrations`: approved search, analytics, AI-answer observation and external integrations.
- `packages/billing`: plans, entitlements, metering and billing-provider adapters.
- `packages/ui`: shared accessible design system and product components.
- `infra`: deployment definitions, environment templates, monitoring and operational runbooks.
- `docs`: ADRs, threat models, API contracts, product decisions and phase acceptance evidence.

This is the target structure, not a claim that every listed package already exists. Introduce each package when its first real consumer is implemented. Avoid placeholder packages and duplicate domain logic. Internal package boundaries must be enforced through imports, tests and ownership rules. Keep tenant authorization in API, worker and persistence boundaries; a shared repository does not weaken isolation requirements.

The public/local mode and hosted mode are two supported operating modes of the same product codebase. Public modules may remain Apache-2.0 where appropriate; secrets, customer data, credentials and deployment environments are never committed. Any future licensing boundary is a release/legal decision, not a reason to split the repository.
