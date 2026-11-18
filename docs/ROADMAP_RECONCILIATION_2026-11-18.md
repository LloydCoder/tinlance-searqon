# Searqon Repository-to-Roadmap Reconciliation

**Audit date:** 2026-11-18  
**Audited main commit:** `c2dbd3d182ed502cfc0063e77af3f81156012d90`  
**Canonical roadmap:** [ROADMAP_16_PHASE.md](ROADMAP_16_PHASE.md)  
**Status register:** [EXECUTION_STATUS.md](EXECUTION_STATUS.md)  
**Product maturity:** Early alpha; not production-ready.

## 1. Purpose and authority

This document reconciles source-controlled implementation with the canonical 16-phase product roadmap. The canonical phase names and numbering in `ROADMAP_16_PHASE.md` remain authoritative.

The later rows in the existing `EXECUTION_STATUS.md` table (its rows labelled 8–15) are legacy implementation workstreams, not the canonical product phases. They must not be interpreted as a renumbering of the canonical roadmap. In particular:

- Legacy “Interfaces and reporting” supports several phases; it is not canonical Phase 8.
- Legacy “Hosted service foundation” is a cross-cutting foundation for canonical Phase 13; it is not canonical Phase 9.
- Legacy “Security/privacy assurance”, “Reliability and operations” and “Design-partner pilots” are cross-cutting tracks supporting canonical Phases 4, 5, 9, 11, 13, 14 and 15; they are not canonical Phases 10–12.
- Legacy “Commercial v1”, “SEO/AEO expansion” and “Advanced AgEO” are not canonical Phases 13–15.

This reconciliation does not change the product scope, authorize external provider spending, authorize production deployment, or accept any phase on behalf of the product owner.

## 2. Evidence standard

A capability is classified as:

- **VERIFIED (bounded):** implementation and relevant automated checks support the explicitly stated bounded behavior. This is not independent security assurance or production acceptance.
- **IMPLEMENTED / IN PROGRESS:** meaningful code or contracts exist, but one or more roadmap exit criteria remain.
- **NOT IMPLEMENTED:** no complete implementation of the canonical deliverable was found in the audited repository.
- **BLOCKED:** progress depends on external participation, approval, credentials, legal review or another unmet prerequisite.

Green CI is necessary for code changes but does not establish product correctness, external data quality, production readiness, commercial demand or phase acceptance.

The audit reviewed the canonical roadmap, execution-status register, README, package scripts, CI/CodeQL/secret-scan workflows, Phase 1 validation plan and trackers, recent commit history, and the source/PR evidence referenced by the status register. This is a repository evidence reconciliation, not a fresh independent penetration test or clean-room local test run.

## 3. Canonical 16-phase status

| Canonical phase | Reconciled status | Implemented evidence | Remaining exit work |
|---|---|---|---|
| 0 — Product governance | VERIFIED | PR #138; charter, discipline definitions, personas, ownership boundaries, risk register and decision log. | Explicit product-owner acceptance should be recorded. |
| 1 — Customer validation | IN PROGRESS / external dependency | Desk research, competitor map, interview protocol, pain rubric, outreach process and evidence trackers in `docs/validation/`. A later campaign sent 61 individual invitations; last recorded status was 51 delivered, 7 bounced and 3 processing. One explicit opt-out was received and must remain suppressed. | 15 completed qualifying interviews; pain ranking; 5 written design-partner agreements; 3 paid-pilot commitments or an evidence-based pivot; procurement objections; owner acceptance. Invitations/delivery/replies are not interviews or commitments. Refresh the three processing statuses and reconcile campaign-level outcomes without placing personal contact data in the public repository. |
| 2 — Open-source foundation | IN PROGRESS | Apache-2.0 repository; contribution/security policies; Node 22/24 CI; dependency audit; CodeQL; full-history secret scan; SBOM and release-attestation workflow. | Complete license/provenance review; execute and verify a tagged reproducible release; verify repository rulesets and required checks. |
| 3 — Domain contracts | IN PROGRESS | Versioned JSON Schemas, observation/evidence contracts, compatibility ADR, contract registry, public API/persistence boundaries and explicit migration registry (PRs #72–#74). | Add cross-version consumer fixtures when a real contract version changes; complete architecture review and record acceptance. Do not invent a v1-to-v2 migration when no v2 contract exists. |
| 4 — Secure acquisition | VERIFIED for bounded one-page acquisition | URL/IP policy, DNS validation and pinning, redirect policy, bounded transport, authorization attestation, robots parser/retrieval/cache and RFC 9309 normalization; regression and live pinned HTTPS/TLS test evidence (PRs #20–#46). | Keep recursive crawl/browser rendering out of the accepted scope until separately threat-modelled. Phase 11 controlled-origin adversarial integration and process isolation remain. Operator attestation is not independent proof of ownership. |
| 5 — Evidence and provenance | IN PROGRESS | Evidence records, digest verification, chained local JSONL ledger, detached Ed25519 checkpoints, signed redaction manifests/journal, legal-hold events and recovery-bundle integrity checks (PRs #49–#78). | Encrypted and tenant-isolated durable custody; authenticated actors/requesters; durable signing-key/approver registry custody; deletion/sanitization; backup expiry and restore exercise; access controls and lifecycle enforcement. Current local ledger/journal are single-process, plaintext and non-WORM. |
| 6 — Passive Agent Readiness Scanner | IN PROGRESS | Local HTML/Markdown/OpenAPI analysis, caller-supplied passive MCP snapshot analysis, bounded authorized one-page scan, evidence-linked findings and deterministic CLI/JSON/HTML output. No MCP tool invocation. | Broader golden fixtures and discipline coverage; recursive acquisition/browser rendering only after separate security design; live MCP metadata acquisition is not part of the passive scanner's current behavior. |
| 7 — GEO measurement | IN PROGRESS | Supplied-observation normalization, provenance, Brand Truth Registry, cohorts, sampling-plan preflight, tenant/project-scoped immutable ingestion, digest verification, deduplication and atomic quota metering (PR #123). | Permitted provider adapters and consumer-observation policy review; scheduled sampling; independently verified provider metadata; repeatability and labelled evaluation; cost/rate caps and customer outcome evaluation. Caller-supplied observations are not live provider acquisition. |
| 8 — Hallucination and Citation Defense | IN PROGRESS | Registry-relative claim/citation checks, freshness and attribution diagnostics, evidence-linked deterministic findings and review-oriented correction artifacts (PR #93 and related work). | Labelled benchmark with precision/recall; stronger entity/claim resolution and contradiction taxonomy; source retrieval where permitted; low-confidence guardrails and human review. Do not claim universal truth verification or model-weight correction. |
| 9 — Citation-change alerts | IN PROGRESS | Comparable supplied-data snapshot comparisons, evidence-linked disappearance alerts, deduplication/cooldowns, signed envelopes, persisted snapshots, encrypted destinations, transactional outbox, DNS-pinned HTTPS transports, lease-fenced handler, job-type-isolated claims and dedicated worker process (PRs #99, #113–#119). | Live permitted GEO acquisition and scheduling; provider/customer-labelled false-positive evaluation; provider sandbox smoke tests; deployed/configured worker; production secrets/egress controls; delivery SLOs and operational monitoring. |
| 10 — Agent Artifact Compiler | IN PROGRESS | Deterministic local artifact compiler foundation, normalized inputs, provenance/digests and bounded reproducible diff proposals (PR #98). | Source-linked artifact map; repository/revision acquisition; controlled patch generation in isolated worktrees; GitHub branch/PR adapter; explicit scoped authorization and human review. No auto-merge. |
| 11 — Simulated Agent Sandbox | IN PROGRESS — bounded read-only foundation | Deterministic snapshot simulator in a per-run Node permission-restricted child; disabled network globals and static import guard; 64 MiB heap/5-second wall-clock limits; bounded manifest/result; durable `agent_simulation` queue; least-privilege database role; tenant-scoped result persistence. See [AGENT_SANDBOX.md](AGENT_SANDBOX.md). | Adversarial parser/lease/tenant and child-crash tests; cgroup CPU quotas/observability; customer-facing run history; staging authorization and product-owner acceptance. OS/container egress denial required before active network adapters or untrusted executable code. No arbitrary code/MCP tool execution; mutation disabled. |
| 12 — Recommendations and verification | IN PROGRESS | Stable finding fingerprints, tenant-scoped persistent recommendations, append-only lifecycle events, human status transitions, authenticated APIs/worklist and later comparable-assessment verification (PRs #120–#122). | Assignment/ownership; patch/test linkage; richer regression detection and cross-engine prioritization; customer evaluation; acceptance. Verification only proves bounded finding absence under matching content type, discipline and methodology version. |
| 13 — Hosted service and integrations | IN PROGRESS | PostgreSQL tenant/RLS foundation, passwordless identity, project/assessment persistence, entitlements, usage reservations/settlement, manual assessment quotas, durable queue, bounded worker, alert delivery infrastructure and pricing information (PRs #87–#119, #123). | Provider-specific signed billing webhook verification and inbox processing; checkout/invoice settlement; end-to-end metering; GEO scheduler/adapters; admin/invitations; MFA/SSO as validated; KMS/secrets; retention; backup/restore; production deployment and operations. |
| 14 — Security, reliability, privacy and pilots | IN PROGRESS / BLOCKED on independent and customer evidence | SSRF controls, tenant RLS tests, audit events, CI, CodeQL, dependency audit, secret scanning, bounded worker and queue lease controls. | Independent penetration test; ASVS-aligned assessment; privacy/legal review; production key custody; SLOs, incident response, restore and rollback exercises; design-partner pilots; support load and unit economics. No certification or independent assurance is claimed. |
| 15 — Commercial v1 and enterprise maturity | NOT STARTED | Public website, early workspace, proposed pricing/entitlement contracts and release automation exist. | Accepted pilot outcomes; validated packaging/pricing; production launch approval; support and incident operations; unit economics; enterprise controls justified by validated demand; procurement pack, SLAs, residency and rollback readiness. |

## 4. Engineering inventory: preserve, integrate, do not rebuild

The following are established foundations and should be extended rather than replaced:

- Secure one-page acquisition, DNS pinning, redirect checks and robots policy.
- HTML, Markdown, OpenAPI and passive MCP snapshot analyzers.
- Versioned observation/evidence schemas and migration registry.
- Evidence records, hash-linked local ledger and signed checkpoints.
- Brand Truth Registry, GEO observation normalization, cohorts and supplied-data ingestion.
- Claim-defense foundation and citation-change comparison.
- Alert snapshot/cooldown store, encrypted destinations, outbox and dedicated worker.
- Agent Artifact Compiler local deterministic foundation.
- Recommendation lifecycle and comparable-assessment verification.
- PostgreSQL tenant/RLS model, passwordless identity, projects and assessment persistence.
- Usage ledger, entitlement resolution, manual quotas and durable queue/worker primitives.
- Marketing site and authenticated workspace surfaces.

These capabilities are not automatically production-ready. Their stated limitations and remaining exit criteria above remain binding.

## 5. Cross-cutting workstreams (not phase numbers)

The following must be tracked as workstreams that support multiple canonical phases:

1. **Interfaces and reporting:** supports Phases 6–10, 12–13 and 15.
2. **Hosted identity/database/queue foundation:** preparatory and partial implementation for Phase 13; does not complete Phase 13.
3. **Security and privacy assurance:** supports Phases 4, 5, 9, 11, 13, 14 and 15.
4. **Reliability and operations:** supports Phases 5, 9, 11, 13–15.
5. **Customer validation and pilots:** Phase 1 is the discovery gate; Phase 14 includes pilot execution and assurance; Phase 15 requires launch acceptance.
6. **SEO/AEO/AgEO discipline expansion:** capabilities within Phase 6 and the measurement/verification phases, not separate canonical phases.

## 6. CI/CD evidence boundary

The repository defines:
- Node 22 and Node 24 test/package validation, actionlint, CLI smoke tests, dependency audit and CycloneDX SBOM validation in `.github/workflows/ci.yml`.
- CodeQL analysis in `.github/workflows/codeql.yml`.
- Full-history Gitleaks scanning in `.github/workflows/secret-scan.yml`.
- A release workflow for signed/provenance-bearing release artifacts.

At the audited main commit, the previous execution record reports the three GitHub Actions workflows passing while the Vercel deployment/preview check was rate-limited by the current Hobby deployment quota. A workflow definition is not evidence that every workflow has run successfully on the current commit. Re-check run status for each new commit/PR and report external deployment checks separately.

Do not bypass a required check, disable a test, weaken security policy, or mark a workflow green based on a retry that did not complete.

## 7. External dependencies and execution constraints

The final roadmap cannot be completed by code changes alone:

- Phase 1 requires real buyers to participate, provide evidence and make commercial commitments or support a documented evidence-based pivot.
- Phase 14 requires independent security/legal review and real pilot outcomes.
- Phase 15 requires customer outcomes, validated economics and operational launch approval.
- Provider integrations require terms/permission review, authorized credentials and bounded budgets.
- Production hosting, paid services, DNS changes, production deployments and customer-system mutations remain prohibited without the relevant explicit approval.

The existing user instruction to avoid new spend remains in force. No paid provider, infrastructure upgrade or production deployment is authorized by this reconciliation.

## 8. Next execution sequence

1. Correct the status register so its canonical phase table matches this document and the canonical roadmap; move legacy engineering categories into cross-cutting workstreams.
2. Refresh campaign delivery states and record invitations/replies/opt-outs in a private campaign ledger; never count them as completed interviews.
3. Complete the smallest missing evidence and integration gates in Phases 2, 3 and 5 without rebuilding established components.
4. Build and adversarially test the missing Phase 11 sandbox before enabling any simulated agent execution.
5. Connect permitted GEO acquisition to measurement and monitoring only after legal/policy review, cost caps and labelled evaluation are in place.
6. Complete hosted lifecycle and operational controls for Phase 13.
7. Conduct independent security/privacy assurance and design-partner pilots for Phase 14.
8. Make commercial v1 launch decisions only through Phase 15 acceptance.

**Current overall verdict:** substantial early-alpha engineering exists across many phases; canonical Phase 0 and bounded Phase 4 have verified implementation gates; Phase 1 remains commercially unvalidated; Phases 2–10, 12–14 remain in progress to differing degrees; Phase 11 is the major missing engineering capability; Phase 15 has not started. No claim of 100% roadmap completion or production readiness is supported.
