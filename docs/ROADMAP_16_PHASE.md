# Searqon 16-Phase Completion Roadmap

This roadmap consolidates the original 16-phase delivery sequence with the four approved painkiller modules. It is dependency-aware. The existence of this roadmap does not mean any phase or module is implemented or accepted.



> **Cross-cutting implementation tracks:** the repository's implementation-status workstreams (for example, the early web interface and hosted identity/database foundation) do not renumber this 16-phase product roadmap. Hosted identity/database foundations are preparatory work for Phase 13; they do not mark Phases 7–12 complete or satisfy Phase 13 exit criteria. Web UI/reporting is a shared surface across the roadmap.

## Status definitions

- NOT_STARTED: no accepted implementation.
- IN_PROGRESS: work exists but exit criteria remain.
- BLOCKED: required dependency/control is missing.
- IMPLEMENTED: code/docs exist; verification incomplete.
- VERIFIED: required checks and forensic audit passed with evidence.
- ACCEPTED: product owner accepted verified deliverables.

A green CI workflow is necessary for applicable code changes, not sufficient for production readiness.

## Phases

| # | Phase | Granular subtracks | Exit gate |
|---|---|---|---|
| 0 | Product governance | Charter; four-discipline definitions; non-goals; personas; ownership boundaries; ADRs; risk register; decision log | Scope and security decisions recorded |
| 1 | Customer validation | 15 buyer interviews; pain ranking; 5 design partners; 3 paid-pilot commitments or evidence-based pivot; competitor map; procurement objections | Interview evidence and paid-pilot decision |
| 2 | [Open-source foundation](PHASE_2_OPEN_SOURCE_FOUNDATION.md) ([provenance inventory](PHASE_2_SOURCE_PROVENANCE_REVIEW.md)) | Apache-2.0 provenance; 14-package license inventory; contribution/security policy; Node 22/24 CI; CodeQL; full-history secret scan; CycloneDX SBOM; published and independently verified `v0.2.0` release with package/checksums/SLSA provenance/SBOM attestations | Verified release plus active main-branch ruleset/required checks and completed source-level provenance review |
| 3 | Domain contracts | Assessment/evidence schemas; observation/action enums; confidence semantics; compatibility ADR; API boundaries; threat model | Schema and migration tests; architecture review |
| 4 | Secure acquisition | SSRF; DNS rebinding; IPv4/IPv6 special ranges; redirects; robots policy; limits; parser isolation; authorized source scope | Adversarial acquisition suite passes |
| 5 | Evidence and provenance | Append-oriented ledger; source maps; content digest; custody; signed checkpoints; retention/deletion/redaction; audit events | Provenance and lifecycle tests pass |
| 6 | Passive Agent Readiness scanner | HTML/Markdown; OpenAPI 3.2 and 3.1 compatibility; passive MCP metadata; auth/docs diagnostics; deterministic CLI/JSON/HTML reports | Golden fixtures; no active tool invocation |
| 7 | GEO measurement | Brand Truth Registry; prompt cohorts; provider/surface taxonomy; permitted adapters; mention/citation extraction; confidence; sampling and cost caps | Repeatability and labelled evaluation; API and consumer observations separated |
| 8 | Hallucination & Citation Defense | Claim extraction; entity resolution; attribution swaps; freshness; contradiction taxonomy; correction manifests; review/verification | Precision/recall on labelled set; low-confidence guardrails; no model-weight claims |
| 9 | Citation-change alerts | Implemented increment: comparable supplied-data snapshot comparisons; evidence-linked citation-domain disappearance; bounded evidence references; deterministic dedupe/cooldown; signed envelopes; persisted alert snapshots/cooldown state; encrypted tenant-scoped destinations; transactional outbox; secure Slack, Teams Workflows and PagerDuty sender; lease-fenced handler; job-type-isolated queue claims; dedicated alert worker process. Worker code is not deployed or configured with credentials. | Live permitted GEO provider acquisition; scheduled sampling; provider/customer-labelled false-positive evaluation; provider sandbox smoke tests; delivery SLOs and production egress/secrets configuration |
| 10 | Agent Artifact Compiler | Docs normalization; provenance; optional llms.txt; OpenAPI lint; deterministic diffs; patch generation; GitHub branch/PR adapter | Reproducible source-linked artifacts; explicit authorization; no auto-merge |
| 11 | Simulated Agent Sandbox | Implemented increment: deterministic read-only snapshot journey simulator in a per-run Node permission-restricted child; network-free trusted-code path (disabled network globals and static import guard; Node 22/24 Permission Model is **not** an egress control); 64 MiB heap and 5-second wall-clock caps; bounded inputs/outputs; queue-lease cancellation kills the child; durable `agent_simulation` jobs; dedicated least-privilege worker role; tenant-scoped immutable results. See [AGENT_SANDBOX.md](AGENT_SANDBOX.md). | Remaining: actual child-process crash/retry verification in authorized staging; staging resource-limit/observability verification; product-owner acceptance; customer-visible run history after Phase 1 validates the workflow. Current CI covers bounded malformed-HTML stress, prototype-shaped metadata, cancellation, lease fencing, tenant isolation, immutable result privileges and simulated child-failure retry. OS/container egress denial and CPU quotas are mandatory before any active network adapter, untrusted executable code or extension is introduced. Mutation remains disabled. |
| 12 | Recommendations and verification | Implemented increment: stable finding fingerprints; tenant-scoped persistent recommendations; severity priority; idempotent synchronization; append-only lifecycle events; human-controlled lifecycle and comparable-assessment verification; workspace assignment and due dates; deterministic cross-discipline ranking across SEO/AEO/GEO/AgEO; severity escalation/de-escalation regression events for stable findings; immutable tenant-scoped multi-step remediation-plan proposals binding recommendation IDs, exact patch SHA-256 digests, dependency graphs and successful same-project assessment references. No patch application, test execution or source-control mutation occurs. Customer evaluation protocol is prepared in docs/validation/PHASE_12_RECOMMENDATION_EVALUATION.md but no customer sessions are recorded. | Real customer evaluation and product-owner acceptance; staging verification of the integrated workflow. Green CI alone is not acceptance. |
| 13 | Hosted service and integrations | Existing PostgreSQL tenant/RLS, passwordless identity, subscriptions/entitlements, usage reservations, durable jobs/workers and alert delivery; plus provider-neutral signed-webhook processing boundary, redacted idempotent billing inbox, isolated ingest/worker roles, lease-fenced billing worker, provider-canonical subscription reconciliation, workspace invitation lifecycle, verified-email acceptance, role administration and audit trails (PR #143 implementation branch). | Provider selection/terms/credentials and sandbox verification; checkout and invoice settlement; complete end-to-end metering across every API/worker; permitted GEO scheduler/live adapters and labelled evaluation; managed KMS/secret manager; automated retention/export/deletion and backup/restore evidence; production deployment/operations; authorized staging and product-owner acceptance. |
| 14 | Security, reliability and pilots | ASVS-aligned assessment; independent penetration test; privacy/legal review; SLOs; incident response; design-partner pilots; support load; unit economics | No unresolved critical/high issues; pilot outcomes and margins measured |
| 15 | Commercial v1 and enterprise maturity | Release process; packaging/pricing; docs/support; SSO/SCIM only if validated; audit exports; residency; SLAs; procurement pack; rollback | Launch approval and operational readiness |

## Dependency sequence

Phases 0–3 establish scope, demand, governance and contracts. Phase 4 gates all remote acquisition and active network testing. Phase 5 gates trustworthy GEO, alerts, compiler provenance and verification. Phase 6 establishes passive AgEO baseline; Phase 7 establishes GEO measurement. Phase 8 depends on the truth registry and GEO observations. Phase 9 depends on comparable cohorts. Phase 10 depends on contracts, provenance and repository authorization. Phase 11 depends on acquisition security and isolated workers. Phase 12 integrates all engines. Phase 13 requires tenant-safe persistence and cost controls. Phase 14 precedes launch; Phase 15 is the final commercial gate.

## Cross-phase non-negotiables

- No new paid infrastructure/provider spend without explicit budget approval.
- Open-source local toolkit remains useful without paid APIs.
- Reuse OpenSEO/Elmo patterns only after file-level license/provenance review; no wholesale fork.
- No consumer AI scraping without approved, terms-compliant collection.
- No MCP tool execution in passive scanner.
- No publishing, repository writes, merge or deployment without explicit scoped human authorization.
- No model grants execution authority.
- No claim that llms.txt forces model behavior or that correction manifests alter model weights.
- No phase acceptance based on green CI alone; record implementation, tests, forensic review and product-owner acceptance.

## Commercial validation and launch gates

Unit economics include provider collection, retries, storage, queue/worker time, alert delivery, support and refunds. Gross-margin targets remain hypotheses until measured. Continuous monitoring is opt-in and bounded by per-tenant budgets.

Production readiness additionally requires threat-model closure, independent security testing, privacy/legal review, tenant isolation, backup/restore evidence, incident response, observability, rollback, support ownership and documented service objectives.

## 2026-11-18 QA remediation note

- Phase 1 analyzer hardening: visible-content HTML analysis now excludes comments and non-rendered script/style/textarea/noscript/template content, handles empty-title fallback and unquoted attributes, and preserves JSON-LD detection separately. Methodology version: 2026-11-18.1.
- Phase 4 acquisition hardening: the robots product token is shared with the wire User-Agent, validated against RFC 9309 token characters, and included in robots-policy cache keys. Redirect-origin robots checks preserve the same token. Cross-origin robots redirects are deliberately denied and fail closed; this is stricter than RFC 9309's SHOULD-follow-across-authorities guidance.
- OpenAPI 3.2 security requirements now distinguish explicit URI-like references from bare component names and reject malformed references; multiple undefined schemes receive unique finding IDs.
- Local CLI scans reject symlink and non-regular inputs, using lstat, O_NOFOLLOW where supported, and device/inode rechecks.
- QA implementation PRs #127–#133 are merged. The exact production deployment boundary and remaining auth end-to-end gate are recorded in docs/EXECUTION_STATUS.md; green CI is not a substitute for production verification or product-owner phase acceptance.
