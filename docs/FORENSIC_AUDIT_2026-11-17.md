# Searqon forensic implementation audit

**Audit date:** 2026-11-17  
**Audited repository:** https://github.com/LloydCoder/tinlance-searqon  
**Audited branch / commit:** `main` / `319dba4267e96c40ebd56f20ed7d70be5fb772f9`  
**Product maturity:** Early alpha — not production-ready  
**Method:** Live repository tree, source files, SQL migrations, tests, phase register, roadmap, architecture/module contracts, recent merged PRs and GitHub Actions run metadata. Prior project decisions were reconciled against the later architecture and current source.

## 1. Executive conclusion

Searqon is no longer just the original local scanner prototype. The repository now contains a substantial local-first analysis toolkit and an early authenticated PostgreSQL workspace foundation. It also contains meaningful GEO measurement, evidence governance, claim-defense, artifact-compilation and billing primitives.

It is not yet the complete hosted intelligence platform described in the 16-phase roadmap. The largest gaps are live/recurring data acquisition, full crawl and agent simulation, durable scheduled processing and alert delivery, complete recommendation-to-verification workflows, subscription/payment lifecycle, tenant-wide usage enforcement, operational controls and external acceptance.

The main branch at the audited commit has green CI, CodeQL and secret-scanning workflows. These are engineering checks, not production assurance.

## 2. Status definitions

- **FULLY IMPLEMENTED (repository scope):** functionality is present and has automated test evidence for its declared scope. This does not imply independent security certification or production operation.
- **PARTIAL:** a bounded implementation, local primitive, UI shell or subset exists; the full product workflow is not delivered.
- **NOT IMPLEMENTED:** no implementation was found in the audited tree for the intended capability.
- **EXTERNAL / BLOCKED:** implementation depends on real customers, approved providers/terms, credentials, legal review, budget or production operations that cannot be fabricated by repository changes.

## 3. Fully implemented and tested within declared boundaries

| Capability | Evidence | Boundary |
|---|---|---|
| Local CLI and deterministic assessment pipeline | `src/cli.js`, `src/analyzer.js`, analyzer/CLI tests | Local inputs; no complete site-wide technical audit |
| HTML, Markdown and OpenAPI assessment | `src/analyzer.js`, examples and analyzer tests | Rule-based coverage; findings disclose limitations |
| Passive MCP snapshot assessment | MCP schema, analyzer, CLI and MCP tests | Caller-supplied snapshot only; no MCP connection or tool invocation |
| Assessment report contract and standalone HTML report | `schemas/assessment-report.schema.json`, `src/report-html.js`, report tests | Local report generation; not full customer reporting |
| Domain contract registry and synchronous migration framework | `schemas/contract-registry.json`, `src/contract-migrations.js`, contract tests | No v2 contract or real v1-to-v2 migration currently exists |
| Bounded remote acquisition security controls | `src/security/url-policy.js`, `src/security/fetch.js`, `src/security/robots.js`, `src/security/robots-fetch.js`, `src/remote-scan.js` | One explicitly authorized public page; no recursive crawl or browser rendering |
| Robots Exclusion Protocol parser/evaluator and retrieval/cache | Security modules and robots/fetch tests | Parser/retrieval behavior is bounded; robots is not authorization |
| GEO supplied-observation normalization and aggregation | `src/geo.js`, GEO schemas and tests | Supplied observations only; no live provider calls |
| GEO Brand Truth Registry and prompt-cohort/sampling-plan generation | `src/geo-registry.js`, `schemas/brand-truth-registry.schema.json`, `schemas/geo-prompt-cohort.schema.json`, `schemas/geo-sampling-plan.schema.json` | Registry/cohort/plan creation is local; sampling plan is preflight, not acquisition |
| Deterministic GEO aggregate alerts and citation-domain disappearance analysis | `src/geo-alerts.js`, alert/citation schemas and tests | Compares supplied snapshots; no durable baseline store or delivery worker |
| Signed alert envelopes, delivery receipts and Slack/Teams/PagerDuty payload builders | `src/geo-alerts.js` and tests | Payload construction only; no outbound delivery |
| Synthetic alert-quality evaluator | `src/geo-alerts.js`, quality fixture and tests | Synthetic fixtures validate mechanics, not real-world precision/recall |
| Brand claim extraction and registry-relative citation/contradiction analysis | `src/claim-defense.js`, schemas and tests | Deterministic/heuristic analysis; no universal hallucination verdict and no citation URL retrieval |
| Deterministic local Agent Artifact Compiler | `src/artifact-compiler.js`, schema and tests | Markdown/OpenAPI input and diff proposals; no GitHub integration or source writes |
| Local evidence integrity primitives | `src/evidence.js`, `src/evidence-ledger.js`, checkpoint modules and tests | Local plaintext JSONL, single-process and not WORM |
| Signed redaction and legal-hold event primitives | evidence redaction/legal-hold modules, schemas and tests | Export suppression and signed journals do not perform physical deletion or independently authenticate humans |
| Passwordless authentication core | `src/platform/auth.js`, migrations 0001–0003, auth integration tests | Magic-link auth; no MFA/passkeys/OIDC or recovery workflow |
| PostgreSQL tenant isolation and role-aware project access | `src/platform/database.js`, `src/platform/workspaces.js`, migration 0001, PostgreSQL integration tests | Basic membership/RLS model; administration surface is incomplete |
| Durable usage ledger | `src/platform/usage-ledger.js`, migration 0004, usage-ledger integration tests; PR #104 | Reservation/settlement primitive only; not wired across all billable paths |
| Pricing/entitlement evaluator | `src/platform/entitlements.js`, `config/entitlements.v1.json`, PR #103 | Proposal and policy engine; not a subscription or payment system |
| Public marketing website and proposed pricing page | `apps/web/public/`, pricing tests, PR #105 | Pricing is informational and unavailable for purchase |
| CI and static security workflows | `.github/workflows/ci.yml`, `codeql.yml`, `secret-scan.yml` | CI does not equal production deployment, independent security review or operational readiness |

## 4. Partially implemented capabilities

| Capability | Implemented portion | Missing to complete |
|---|---|---|
| SEO | Local HTML/page signals, metadata and structural diagnostics | Full-site crawling, canonical/indexation analysis at scale, Search Console, Core Web Vitals, multilingual validation, backlink/rank datasets and verified remediation |
| AEO | Answer/content structure and source-oriented diagnostics | Broader question/entity methodology, reliable answer testing, provider/surface measurement and outcome verification |
| GEO | Provenance-aware analysis of supplied observations, cohorts, brand registry, sampling plans and deterministic snapshot comparisons | Approved live provider adapters, consumer-observation capture policy, recurring collection, durable history and monitoring |
| AgEO | OpenAPI and documentation diagnostics plus passive MCP metadata validation | Full OAuth protected-resource and authorization-server discovery, token audience/PKCE validation, live protocol interoperability, runtime auth checks and agent-journey testing |
| Remote scanning | Secure single-page fetch with authorization attestation and robots checks | Crawl scope/depth/concurrency controls, cross-page deduplication, browser rendering, parser isolation and stronger ownership verification |
| Evidence lifecycle | Local hash chain, signatures/checkpoints, retention evaluation, redaction and legal-hold records | Encrypted durable multi-tenant store, immutable custody, physical deletion/sanitization, backup expiry, restore exercise and identity-bound approval |
| Citation-change alerting | Local comparison, confidence screening, HMAC event construction and destination payload formatting | Persistent baselines/events/cooldowns/replay store, encrypted destination management, outbound delivery, retry/outbox and SLOs |
| Claim/citation defense | Sentence/claim extraction, registry-relative fact matching, freshness and citation attribution heuristics | Labelled benchmark, precision/recall validation, richer semantic/attribution analysis, permitted citation acquisition and reviewed remediation lifecycle |
| Agent Artifact Compiler | Local Markdown/OpenAPI normalization, source digests and deterministic diff proposals | Statement-level source maps, repository/revision acquisition, patch application in disposable worktrees, GitHub branch/PR adapter and approval enforcement |
| Web application | Marketing site, auth pages, workspace shell, project create/list/detail and synchronous project assessment history | Full dashboard/reporting, project update/archive/delete, invitations, role administration, user administration, background jobs, settings and accessibility/browser QA |
| Authentication | Email magic-link registration/login, single-use token, session digest, rate limits, logout | MFA/WebAuthn, recovery, email-change re-auth, device/session management, admin recovery, OAuth/OIDC and enterprise SSO |
| Billing | Pricing proposal, pure entitlement evaluation and PostgreSQL usage reservation/settlement | Canonical subscription persistence, provider-neutral webhook inbox, verified payment webhooks, invoice/payment reconciliation, customer overage consent, full API/worker metering, provider budget enforcement and billing notices |
| Hosted platform | PostgreSQL schema, restricted runtime role, RLS, audit events and local server adapter | Durable scheduler/queue, workers, retries, operational telemetry, secrets/key management, backups, restore and production deployment |
| Open-source release engineering | License, contribution/security docs, CI, CodeQL, secret scan, SBOM and attestation workflow | Full provenance/license audit, actual tagged release, repository ruleset/required-check verification and published release evidence |
| Security/privacy | Self-assessment and automated controls | Independent penetration test, ASVS 5.0 assessment, AI-specific AISVS review, privacy/legal review, data-flow/subprocessor assessment and closure of high-risk findings |

## 5. Not implemented

1. **Live GEO acquisition:** official model-provider API adapters, consumer-facing AI observation collection, provider terms approval, provider credential management and live sampling.
2. **Continuous monitoring:** scheduler, durable queue, worker fleet, recurring scans, retries, durable GEO history and monitoring controls.
3. **Outbound alerting:** webhook delivery, Slack/Teams/PagerDuty dispatch, encrypted destination secrets, retry/outbox workers, dead-letter handling and delivery monitoring.
4. **Full-site crawling:** recursive link discovery, crawl budget, canonical URL deduplication, sitemap ingestion, browser rendering and JavaScript execution.
5. **Simulated Agent Sandbox:** disposable isolated workers, egress policy, protocol adapters, ephemeral credentials, read-only journey simulation and adversarial isolation tests.
6. **End-to-end recommendation lifecycle:** prioritization, remediation approval, patch/test linkage, before/after reassessment, regression detection and verified outcome tracking.
7. **Repository remediation integration:** GitHub source acquisition, branch/PR creation, patch application, reviewer workflow and human-approved merge (no auto-merge).
8. **Complete hosted administration:** workspace invitations, role changes, membership removal, user administration, audit export, project update/archive/delete and administrative recovery.
9. **Subscription/payment lifecycle:** subscription and contract source of truth, webhook verification/inbox/reconciliation, invoice settlement, payment failure/dunning, cancellation/renewal, overage consent and payment-provider adapter.
10. **End-to-end commercial metering:** entitlement/usage reservation and settlement are not yet enforced across every API and future worker dispatch path.
11. **Enterprise controls:** SAML SSO, SCIM, customer-managed keys, contractual residency, dedicated environments, full audit export and SLA tooling.
12. **Production operations:** production database/email/secrets configuration, backup and restore, monitoring/alerting, SLOs, incident response, deployment rollback, on-call and support workflows.
13. **Independent assurance:** third-party penetration testing, ASVS/AISVS verification, privacy counsel review, customer security review and documented remediation retest.
14. **Validated commercial launch:** real design-partner pilots, paid-pilot commitments, measured provider/storage/worker/support cost-to-serve, gross-margin validation and explicit launch approval.

## 6. External blockers and non-code dependencies

These cannot be truthfully marked complete by writing code:

- Fifteen buyer interviews, five design partners and three paid-pilot commitments (or evidence-based pivot).
- Permission/terms review and approved collection approach for every AI provider and consumer interface.
- Provider API credentials and a measured budget for live sampling.
- Explicit approval for any new paid database, hosting, email, provider or worker infrastructure.
- Production secrets, domain verification, security contacts, data-processing agreements and privacy/legal review.
- Independent security assessment and real restore/incident-response exercises.
- Customer-labelled alert and claim-defense evaluation data.

The project constraint remains: no new paid infrastructure or provider spend without explicit approval. The local/open-source toolkit must remain useful without paid providers.

## 7. Product decisions reconciled from project history

- Searqon owns SEO, AEO, GEO and AgEO methodology, evidence normalization, findings, recommendations and verification.
- Tinlyt is an optional acquisition/retrieval integration; TAS remains the authority for agent identity, authorization and execution; FadeReach is an optional prospecting integration.
- Earlier discussion proposed a separate private Searqon Cloud repository. The later ADR-0002 and current architecture explicitly supersede that proposal: the complete hosted product stays in this same repository.
- The open-source local toolkit remains independently useful; hosted features must not be faked by browser-only state or hard-coded demo accounts.
- Pricing tiers are proposals, not a public offer. The public pricing page must not imply that unimplemented entitlements are live or purchasable.
- No consumer AI scraping, MCP tool execution, automatic publishing, repository merge or consequential action may be enabled without explicit policy and human authorization.

## 8. Recommended implementation sequence

1. **Correct subscription and webhook foundations:** canonical subscription/contract persistence, provider-neutral verified webhook inbox, replay protection, out-of-order reconciliation and audit trail. No live provider integration until approved.
2. **Wire entitlements and usage:** enforce backend quotas/reservations/settlement on every billable API and worker path; fail closed; add provider-level budget checks.
3. **Build durable jobs/outbox:** PostgreSQL-backed scheduler/queue, idempotent workers, retries, expiry/reaping and dead-letter operations.
4. **Complete workspace administration:** invitations, role administration, project lifecycle, audit views and recovery flows with RLS-backed negative tests.
5. **Complete durable GEO monitoring:** permitted adapters, sampling policies, stored baselines/events, destination encryption and delivery retries.
6. **Complete recommendation and compiler workflows:** review/approval state machine, isolated patch verification and least-privilege GitHub PR adapter.
7. **Implement isolated agent sandbox:** only after threat model, egress isolation, disposable workers and adversarial tests are accepted.
8. **Close evidence lifecycle and production operations:** encryption, deletion, legal holds, backup/restore, observability, incident response and rollback.
9. **Complete external validation and commercial launch gates:** pilots, measured unit economics, independent security/privacy review and explicit launch approval.

## 9. Current verification snapshot

On audited main commit `319dba4267e96c40ebd56f20ed7d70be5fb772f9`:

- Node 22/24 tests and package validation: passed in main CI run `44034473134`.
- PostgreSQL tenant isolation, auth, workspace and usage-ledger integration: included in CI and passed.
- CodeQL: passed in run `44034473215`.
- Full-history secret scan: passed in run `44034473111`.
- No production deployment, paid provider activation or public checkout was performed as part of this audit.

## 10. Admin login clarification

The browser login route is `/auth/login/`. The authenticated workspace is `/app/`. There is no separate `/admin/` console or complete organization-administration interface in the audited route tree. Workspace roles exist in the database, but invitations, role management and administrative recovery remain unimplemented.

---
This audit records observed implementation and explicit limitations. It does not claim that the roadmap, production launch or any externally dependent phase is complete.
