# Searqon Repository-to-Roadmap Reconciliation

**Audit date:** 2026-11-18  
**Audited main commit:** `3a92895e08c9db8ad149fb51974132239ea6a025`  
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
| 2 — Open-source foundation | IN PROGRESS | Apache-2.0 repository; contribution/security policies; Node 22/24 CI; 14-package MIT/ISC lockfile license inventory; dependency audit; CodeQL and full-history Gitleaks; CycloneDX SBOM; published GitHub Release `v0.2.0` with package/SBOM/checksums; separate SLSA provenance and CycloneDX SBOM attestations; exact-tag rebuild, checksum and cryptographic verification (runs `44395089461`, `44395298185`). PRs #145–#154 contain the release/security hardening increments; PR #150 was closed as a stale duplicate. See [Phase 2 evidence audit](PHASE_2_OPEN_SOURCE_FOUNDATION.md). | Apply and verify active main-branch ruleset/required checks; complete first-party and third-party source/license provenance review. The Vercel preview quota failure is tracked separately from source CI. See [repository ruleset setup](REPOSITORY_RULESET_SETUP.md). |
| 3 — Domain contracts | IN PROGRESS | Versioned JSON Schemas, observation/evidence contracts, compatibility ADR, contract registry, public API/persistence boundaries and explicit migration registry (PRs #72–#74). | Add cross-version consumer fixtures when a real contract version changes; complete architecture review and record acceptance. Do not invent a v1-to-v2 migration when no v2 contract exists. |
| 4 — Secure acquisition | VERIFIED for bounded one-page acquisition | URL/IP policy, DNS validation and pinning, redirect policy, bounded transport, authorization attestation, robots parser/retrieval/cache and RFC 9309 normalization; regression and live pinned HTTPS/TLS test evidence (PRs #20–#46). | Keep recursive crawl/browser rendering out of the accepted scope until separately threat-modelled. Phase 11 controlled-origin adversarial integration and process isolation remain. Operator attestation is not independent proof of ownership. |
| 5 — Evidence and provenance | IN PROGRESS | Evidence records, digest verification, chained local JSONL ledger, detached Ed25519 checkpoints, signed redaction manifests/journal, legal-hold events and recovery-bundle integrity checks (PRs #49–#78). | Encrypted and tenant-isolated durable custody; authenticated actors/requesters; durable signing-key/approver registry custody; deletion/sanitization; backup expiry and restore exercise; access controls and lifecycle enforcement. Current local ledger/journal are single-process, plaintext and non-WORM. |
| 6 — Passive Agent Readiness Scanner | IN PROGRESS | Local HTML/Markdown/OpenAPI analysis, caller-supplied passive MCP snapshot analysis, bounded authorized one-page scan, evidence-linked findings and deterministic CLI/JSON/HTML output. No MCP tool invocation. | Broader golden fixtures and discipline coverage; recursive acquisition/browser rendering only after separate security design; live MCP metadata acquisition is not part of the passive scanner's current behavior. |
| 7 — GEO measurement | IN PROGRESS | Supplied-observation normalization, provenance, Brand Truth Registry, cohorts, sampling-plan preflight, tenant/project-scoped immutable ingestion, digest verification, deduplication and atomic quota metering (PR #123). | Permitted provider adapters and consumer-observation policy review; scheduled sampling; independently verified provider metadata; repeatability and labelled evaluation; cost/rate caps and customer outcome evaluation. Caller-supplied observations are not live provider acquisition. |
| 8 — Hallucination and Citation Defense | IN PROGRESS | Registry-relative claim/citation checks, freshness and attribution diagnostics, evidence-linked deterministic findings and review-oriented correction artifacts (PR #93 and related work). | Labelled benchmark with precision/recall; stronger entity/claim resolution and contradiction taxonomy; source retrieval where permitted; low-confidence guardrails and human review. Do not claim universal truth verification or model-weight correction. |
| 9 — Citation-change alerts | IN PROGRESS | Comparable supplied-data snapshot comparisons, evidence-linked disappearance alerts, deduplication/cooldowns, signed envelopes, persisted snapshots, encrypted destinations, transactional outbox, DNS-pinned HTTPS transports, lease-fenced handler, job-type-isolated claims and dedicated worker process (PRs #99, #113–#119). | Live permitted GEO acquisition and scheduling; provider/customer-labelled false-positive evaluation; provider sandbox smoke tests; deployed/configured worker; production secrets/egress controls; delivery SLOs and operational monitoring. |
| 10 — Agent Artifact Compiler | IN PROGRESS | Deterministic local artifact compiler foundation, normalized inputs, provenance/digests and bounded reproducible diff proposals (PR #98). | Source-linked artifact map; repository/revision acquisition; controlled patch generation in isolated worktrees; GitHub branch/PR adapter; explicit scoped authorization and human review. No auto-merge. |
| 11 — Simulated Agent Sandbox | IN PROGRESS — bounded read-only foundation | Deterministic snapshot simulator in a per-run Node permission-restricted child; disabled network globals and static import guard; 64 MiB heap/5-second wall-clock limits; bounded manifest/result; durable `agent_simulation` queue; least-privilege database role; tenant-scoped immutable results. CI covers malformed HTML, prototype-shaped metadata, cancellation, lease fencing, tenant isolation, immutable result privileges and simulated child-failure retry. See [AGENT_SANDBOX.md](AGENT_SANDBOX.md). | Authorized staging verification of child-process crash/retry, resource limits and observability; cgroup CPU quotas; customer-visible run history after Phase 1 validates the workflow; product-owner acceptance. OS/container egress denial required before active network adapters or untrusted executable code. No arbitrary code/MCP tool execution; mutation disabled. |
| 12 — Recommendations and verification | IN PROGRESS | Stable finding fingerprints, tenant-scoped persistent recommendations, append-only lifecycle events, human status transitions, authenticated APIs/worklist and comparable-assessment verification (PRs #120–#122). PR #142 adds workspace assignment/due dates, cross-discipline worklist ranking, severity regression history and immutable remediation-plan proposals bound to exact diff digests and successful assessment references. No patch application, test execution or source-control mutation occurs. | Customer evaluation (protocol prepared but not run); integrated staging verification; assignment/ownership and patch/test linkage validation; product-owner acceptance. Verification remains bounded to matching content type, discipline and methodology version. |
| 13 — Hosted service and integrations | IN PROGRESS | PostgreSQL tenant/RLS foundation, passwordless identity, project/assessment persistence, entitlements, usage reservations/settlement, manual quotas, durable queue/workers and alert delivery. PR #143 adds a provider-neutral signed-webhook boundary, redacted idempotent billing inbox, isolated ingest/worker roles, lease-fenced billing worker, canonical subscription reconciliation, secure workspace invitations, verified-email acceptance, role administration and audit trails. Paddle adapter/runtime remains opt-in and disabled. | Provider selection/terms/credentials and sandbox verification; checkout/invoice settlement; complete metering; permitted live GEO scheduler/adapters and labelled evaluation; managed KMS/secrets; retention/export/deletion; backup/restore; production operations; staging and owner acceptance. |
| 14 — Security, reliability, privacy and pilots | IN PROGRESS / BLOCKED on independent and customer evidence | SSRF controls, tenant RLS tests, audit events, CI, CodeQL, dependency audit, secret scanning, bounded worker and queue lease controls. | Independent penetration test; ASVS-aligned assessment; privacy/legal review; production key custody; SLOs, incident response, restore and rollback exercises; design-partner pilots; support load and unit economics. No certification or independent assurance is claimed. |
| 15 — Commercial v1 and enterprise maturity | NOT STARTED | Public website, early workspace, proposed pricing/entitlement contracts and release automation exist. | Accepted pilot outcomes; validated packaging/pricing; production launch approval; support and incident operations; unit economics; enterprise controls justified by validated demand; procurement pack, SLAs, residency and rollback readiness. |


## 2026-11-18 Phase 2 release evidence update

- GitHub Release `v0.2.0` is published with package tarball, CycloneDX SBOM and SHA-256 manifest. Package digest: `sha256:949f91ece9f1198fc7b333ff05fd2c0dcbef87ebc42585c251bdfce0afb76088`; SBOM digest: `sha256:3db9cc8339cf8b9f56aa385acc8516a2f074aa74155d264ee5c5b6d182fb1a19`; manifest digest: `sha256:01650b4ffdc3af4f2727e98d9d87fa69c8be58432c0556e008286be5559c6653`.
- Release repair run `44395089461` passed exact-tag source tests/audit, published checksum validation, rebuilt package file-tree comparison, SLSA provenance and CycloneDX SBOM attestation creation, and cryptographic verification of both attestations.
- Consumer verification run `44395298185` independently passed release checksum, archive, SBOM, provenance and SBOM-attestation checks.
- Latest main CI, CodeQL and full-history secret scanning passed on `3a92895e08c9db8ad149fb51974132239ea6a025` (runs `44394749007`, `44394748914`, `44394748746`).
- Main branch remains unprotected and the rulesets endpoint returns no rulesets. The administrative steps are documented in `docs/REPOSITORY_RULESET_SETUP.md`; Phase 2 remains IN_PROGRESS until applied and reverified. Full source-level provenance/legal review also remains open.

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

On audited main commit `3a92895e08c9db8ad149fb51974132239ea6a025`, Node 22/24 CI and PostgreSQL integration run `44394749007`, CodeQL run `44394748914`, and full-history secret scan `44394748746` passed. Release attestation repair run `44395089461` and consumer-style release verification run `44395298185` also passed for `v0.2.0`. The Vercel preview/deployment status has separately been rate-limited by the Hobby daily quota; it is not represented as green and is not one of the source CI/security workflows. A workflow definition is not evidence that every workflow has run successfully on the current commit. Re-check run status for each new commit/PR and report external deployment checks separately.

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
3. Close the remaining Phase 2 main-branch ruleset and source-provenance gates, then continue serially with Phases 3 and 5 without rebuilding established components.
4. Build and adversarially test the missing Phase 11 sandbox before enabling any simulated agent execution.
5. Connect permitted GEO acquisition to measurement and monitoring only after legal/policy review, cost caps and labelled evaluation are in place.
6. Complete hosted lifecycle and operational controls for Phase 13.
7. Conduct independent security/privacy assurance and design-partner pilots for Phase 14.
8. Make commercial v1 launch decisions only through Phase 15 acceptance.

**Current overall verdict:** substantial early-alpha engineering exists across many phases; canonical Phase 0 and bounded Phase 4 have verified implementation gates; Phase 1 remains commercially unvalidated; Phases 2–10, 12–14 remain in progress to differing degrees; Phase 11 is the major missing engineering capability; Phase 15 has not started. No claim of 100% roadmap completion or production readiness is supported.


## 2026-11-18 — Phase 11 merge and Phase 12 ownership increment

- Phase 11 PR #141 merged to `main` as `837f23f977433ea03094ed6153303b7eddfd5b63`. Exact-head Node 22/24 test/package validation, PostgreSQL tenant isolation, CodeQL and full-history secret scanning passed.
- The Vercel preview check remained rate-limited by the existing Hobby build quota. No plan upgrade, spend, production deployment or worker deployment was performed. Phase 11's authorized staging verification and explicit product-owner acceptance remain outstanding; merge is not a claim of full production acceptance.
- Phase 12 already had its foundational recommendation lifecycle and evidence-gated verification from PRs #120/#121. PR #142 starts the next increment: tenant-member assignment, strict optional calendar due dates, append-only assignment/due-date events, authenticated assignee lookup, and workspace ownership/scheduling controls.
- PR #142 adds migration `0014_recommendation_work_management.sql`, service validation, API routes and unit/API/PostgreSQL integration coverage. It is a draft and remains subject to exact-head CI, security review and customer/product acceptance.
