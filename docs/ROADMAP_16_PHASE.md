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
| 2 | Open-source foundation | Apache-2.0 provenance; license inventory; contribution/security policy; CI; CodeQL; secret scan; SBOM; signed release and attestation | Reproducible governed release |
| 3 | Domain contracts | Assessment/evidence schemas; observation/action enums; confidence semantics; compatibility ADR; API boundaries; threat model | Schema and migration tests; architecture review |
| 4 | Secure acquisition | SSRF; DNS rebinding; IPv4/IPv6 special ranges; redirects; robots policy; limits; parser isolation; authorized source scope | Adversarial acquisition suite passes |
| 5 | Evidence and provenance | Append-oriented ledger; source maps; content digest; custody; signed checkpoints; retention/deletion/redaction; audit events | Provenance and lifecycle tests pass |
| 6 | Passive Agent Readiness scanner | HTML/Markdown; OpenAPI 3.2 and 3.1 compatibility; passive MCP metadata; auth/docs diagnostics; deterministic CLI/JSON/HTML reports | Golden fixtures; no active tool invocation |
| 7 | GEO measurement | Brand Truth Registry; prompt cohorts; provider/surface taxonomy; permitted adapters; mention/citation extraction; confidence; sampling and cost caps | Repeatability and labelled evaluation; API and consumer observations separated |
| 8 | Hallucination & Citation Defense | Claim extraction; entity resolution; attribution swaps; freshness; contradiction taxonomy; correction manifests; review/verification | Precision/recall on labelled set; low-confidence guardrails; no model-weight claims |
| 9 | Citation-change alerts | **Partial:** deterministic caller-supplied cohort comparison, provider/channel comparability, minimum sample/effect thresholds, Wilson intervals, evidence-linked appearance/disappearance/prevalence events, JSON Schema and CLI. Remaining: acquisition, persistence, cross-run dedupe/cooldown, signed webhook delivery, Slack/Teams/PagerDuty adapters, false-positive evaluation and latency disclosure. | False-positive evaluation; replay and delivery tests; latency disclosure |
| 10 | Agent Artifact Compiler | Docs normalization; provenance; optional llms.txt; OpenAPI lint; deterministic diffs; patch generation; GitHub branch/PR adapter | Reproducible source-linked artifacts; explicit authorization; no auto-merge |
| 11 | Simulated Agent Sandbox | Threat model; disposable worker; egress isolation; DNS/redirect validation; protocol adapters; read-only journeys; ephemeral credentials; quotas; audit | Isolation and adversarial tests; staging authorization; mutation disabled absent separate approval |
| 12 | Recommendations and verification | Prioritization; approval lifecycle; patch/test linkage; before/after assessment; regression detection; cross-engine recommendations | Complete evidence chain from finding to verified result |
| 13 | Hosted service and integrations | Tenant model; RBAC; billing/quotas; scheduler/queue; provider adapters; encryption; retention; backup/restore; integrations; admin audit | Tenant isolation, budget and restore tests |
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