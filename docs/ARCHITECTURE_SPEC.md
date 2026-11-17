# Searqon Architecture Specification

Status: Proposed architecture baseline. This document extends the existing passive scanner and evidence-first design; it does not mark future modules as implemented.

## Product boundary

Searqon measures and improves how businesses are discovered, represented and safely consumed across traditional search, answer engines, generative engines and autonomous agents. It owns SEO, AEO, GEO and AgEO methodologies, evidence normalization, findings, recommendations and verification.

- Tinlyt remains an optional acquisition/retrieval integration.
- TAS remains the authority for agent identity, authorization, orchestration and execution.
- FadeReach remains an optional prospecting/sales integration.
- Searqon must operate independently and provide useful local/open-source functionality without paid providers or cloud services.

## Architecture

Published v1 contracts are enumerated in [schemas/contract-registry.json](../schemas/contract-registry.json). The registry records exact schema identities, version-field semantics, consumers and compatibility policy. The supported programmatic and persistence boundaries are documented in [Public API and Persistence Boundaries](reference/public-api-and-persistence.md); this is a local toolkit contract, not a hosted API.

1. Domain contracts: versioned assessments, observations, findings, evidence, confidence, recommendation and action states.
2. Acquisition gateway: bounded, policy-compliant public HTTP acquisition with SSRF, redirect, DNS and parser isolation controls.
3. Evidence ledger: provenance from source and acquisition through parser, methodology, assessment, recommendation and verification.
4. Independent assessment engines: SEO, AEO, GEO and AgEO. Each declares coverage, limitations, confidence and evidence.
5. Brand Truth Registry: customer-approved entities, aliases, product/feature ownership, canonical facts, authoritative sources, validity intervals and review timestamps.
6. Hallucination & Citation Defense: claim extraction, entity attribution, contradiction analysis and evidence-backed correction proposals.
7. Citation Change Detection: comparable cohort baselines, change events, alert policies and delivery adapters.
8. Agent Artifact Compiler: documentation normalization, optional llms.txt proposal, OpenAPI/MCP metadata validation and deterministic diffs.
9. Agent Journey Sandbox: disposable, isolated, policy-constrained read-only protocol simulations.
10. Recommendation and Verification: approval lifecycle, before/after evidence and regression detection.
11. Interfaces: CLI and JSON/HTML artifacts first; hosted API/UI after validation.
12. Hosted control plane (later product capability, same repository): tenant isolation, roles, billing, quotas, scheduling, integrations, retention and audit. Implement as internal packages and independently deployable applications/workers in this single repository; do not split into a separate Searqon Cloud repository.

## Module specifications

### Hallucination & Citation Defense

Inputs: approved Brand Truth Registry facts; versioned prompt cohorts; permitted provider observations; observation class; surface/provider; region/locale; model/product/version where available; timestamps; citations and evidence references.

Flow: bounded prompt variants → terms-compliant observation → evidence preservation → atomic claim extraction → entity/attribute resolution → supported/contradicted/ambiguous/unverifiable classification → attribution-swap detection → citation freshness analysis → confidence and repeatability calculation → reviewable remediation.

Output: discrepancy record with claim, subject/predicate/object, expected and observed values, source citations, provider/surface, cohort, sample count, confidence, evidence IDs and proposed correction.

Hard boundary: Searqon cannot inspect or change model weights. Correction manifests propose source-grounded changes to first-party facts, structured data, docs, feeds and API descriptions; they cannot force model retraining or guarantee a corrected answer. llms.txt and robots changes are optional proposals, not guaranteed controls.

### Competitor Citation-Change Alerts

Inputs: comparable baseline/current cohorts, tracked entities, prompt set, locale/provider/surface and customer-defined alert policy.

Output: event with before/after citations and mentions, cohort definition, sample sizes, observed delta, confidence/uncertainty, evidence references, timestamp and delivery receipt.

Alerting must distinguish citation disappearance, replacement, mention change and ordering change. Require configurable minimum samples/effect, confidence threshold, cooldown and deduplication. Never claim real-time detection unless actual observation cadence and latency support it. Webhook, Slack, Teams and PagerDuty adapters remain opt-in; sign requests, prevent replay and record receipts.

### Agent Artifact Compiler

Inputs: explicitly scoped docs URLs or repository/revision; supplied OpenAPI descriptions and MCP metadata snapshots; output profile; optional repository permission.

Flow: bounded acquisition → canonical document model → source/output provenance → optional Markdown and llms.txt proposal → OpenAPI validation and semantic lint → link/security checks → deterministic diff → tests → optional authorized branch/PR.

Output: artifact bundle, validation report, warnings, unsupported-feature list, provenance map, diff and optional PR metadata.

Never invent operations, auth schemes, response semantics, pricing or availability. Do not overwrite, publish, push or create a PR without explicit scoped authorization. Human review and merge are mandatory. llms.txt is an emerging convention, not a normative standard or ranking guarantee.

### Simulated Agent Sandbox

Inputs: recorded customer authorization, explicit environment/origin/operation scope, approved journey manifest, test identity and resource limits.

Default is passive analysis. Active mode uses disposable isolated workers, staging and synthetic data, egress allowlists, DNS/redirect revalidation, no metadata/control-plane access, ephemeral least-privilege credentials and strict CPU/memory/time/request/response/spend caps.

Read-only operations only by default. Mutations require separate operation-level approval, dedicated staging, synthetic accounts/data, idempotency and rollback. No brute force, credential guessing, destructive actions, privilege escalation or unrestricted fuzzing. Output includes journey graph, step results, sanitized protocol metadata, errors, latency, evidence and reproduction guidance. This is not a penetration test or security certification.

## Shared evidence and measurement rules

Current v1 evidence observation classes are crawl, first_party, consumer_observation, model_api, derived and estimate. The v1 GEO observation contract is intentionally limited to consumer_observation and model_api. agent_simulation is reserved for a separately versioned future simulation-run contract and is not accepted by current v1 evidence or GEO records. Never pool consumer-surface observations and direct model API responses as equivalent measurements. See [ADR-0001: Domain Observation, Finding, Action and Confidence Contracts](adr/0001-domain-contracts.md) for compatibility rules.

Each observation records source identity, acquisition method, capture time, provider/surface, model/product/version where available, region, locale, prompt cohort, sampling configuration, methodology/parser versions, evidence references and limitations. A content digest alone is not proof of authenticity, immutability or trusted time.

Evidence lifecycle is explicit and separate from ledger integrity. `evaluateEvidenceRetention` computes metadata-only expiry eligibility from a caller-supplied retention interval and UTC evaluation time; it does not purge. Ed25519-signed redaction manifests can suppress approved evidence IDs from generated exports after verification. Requester and approver identifiers must differ, but the library does not authenticate identities or bind approvers to keys; the calling application owns that authorization mapping. Export suppression does not remove the original record from the append-only JSONL ledger, filesystem snapshots or backups. Signed manifests can be persisted in a separate hash-linked local JSONL journal; its chain detects unrecomputed interior tampering but needs an independently trusted head checkpoint to detect a recomputed chain, suffix truncation or full replacement. Searqon can create and verify detached Ed25519 checkpoints over journal prefixes; independent checkpoint/public-key custody remains an operator responsibility. Physical deletion, cryptographic erasure, legal holds, backup expiry, storage sanitization and restore validation remain separate controls. Never rewrite a hash-chained ledger in place and call it a deletion; any future compaction must define a new chain root, signed custody evidence, old-copy disposition and independently verified sanitization. Follow NIST SP 800-88 Rev. 2 for media-sanitization program design.

Findings carry stable ID, dimension, rule/methodology version, severity, status, evidence IDs, scope, confidence, limitations, recommendation and verification method. Distinguish observed facts, extracted claims, model-assisted interpretations, derived statistics and estimates.

Recommendation lifecycle: proposed → validated → approved → applied → verified, or rejected/rolled_back. Approval binds actor, target, scope, diff hash and expiry. Searqon may prepare a patch/PR but never auto-merge or deploy.

## Security invariants

- Treat crawled pages, docs, repository files, prompts, model outputs and tool metadata as untrusted data, never instructions.
- Prevent SSRF, DNS rebinding, redirect escape, IPv4/IPv6 special-range access, metadata access, decompression bombs and parser abuse.
- Discovery never implies authorization. Active tests require explicit scope and time-bounded authorization.
- Sandbox workers are disposable and isolated from host filesystem, control-plane secrets and other tenants.
- Secrets are short-lived, least-privilege, redacted and never stored in evidence.
- Retention evaluation is not deletion; signed export suppression is not physical erasure. Key custody, identity binding, legal holds, backup lifecycle and storage sanitization must be independently designed and verified.
- Webhooks are signed, replay-protected, idempotent and auditable.
- Repository automation is branch-scoped and diff-hash-bound; auto-merge is prohibited.
- Hosted multi-tenancy requires tenant isolation tests at every storage and job boundary.
- No model or prompt can override authorization or policy.

## Cost and implementation policy

Use TypeScript for domain logic, contracts, adapters and orchestration. Consider Rust only after profiling identifies a material CPU/memory bottleneck. Prefer a modular monolith before microservices. Every paid adapter declares pricing, cost estimator, quota, timeout, retry, cache, retention and fallback behavior. Enforce per-tenant budgets, hard spend caps, sampling limits and circuit breakers. Continuous monitoring is opt-in.

Standards policy: Support OpenAPI 3.2.1 (and the 3.2 feature line) with explicit 3.1.x compatibility where required; pin the official schema revision and conformance fixtures. Target MCP specification revision 2026-07-28 through a versioned adapter and maintain compatibility with 2025-11-25 only where supported and tested. MCP tool descriptions/annotations are untrusted; require explicit consent and validate OAuth token audience; never pass tokens through to upstream servers. Treat robots rules as crawler guidance, not authorization. Treat llms.txt as an optional community convention. Evaluate OAuth/MCP audience binding and never forward client tokens upstream.

## Decision record

Accepted direction: modular TypeScript-first architecture; evidence-ledger methodology; four distinct engines; optional ecosystem integrations; narrow passive AgEO scanner first; the four painkiller modules are approved architectural extensions but remain unimplemented until their phase gates pass. Existing v1 observation enums are frozen; future claim verdict, action lifecycle, confidence-band and simulation-run contracts follow [ADR-0001](adr/0001-domain-contracts.md).

## External specification references

- OpenAPI 3.2.1 is the current published patch version as of this architecture review; pin official schemas and follow the normative specification text where schema validation differs: https://spec.openapis.org/oas/v3.2.1.html
- MCP target revision: 2026-07-28. Its security guidance treats tool descriptions as untrusted and requires user consent; authorization guidance requires resource/audience binding and token validation: https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/docs/specification/2026-07-28
- Robots Exclusion Protocol: RFC 9309 defines crawler access guidance; it is not an authorization or access-control mechanism: https://www.rfc-editor.org/rfc/rfc9309.html
- llms.txt: the llmstxt.org document is a community proposal. Searqon treats it as an optional artifact and makes no guarantee that engines consume it: https://llmstxt.org/
- NIST SP 800-88 Rev. 2: media sanitization program guidance, including cryptographic erase considerations: https://csrc.nist.gov/pubs/sp/800/88/r2/final
