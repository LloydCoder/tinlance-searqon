# Searqon Product and Architecture Decision Log

**Last reconciled:** 2026-11-18  
**Purpose:** Index durable product/security decisions and their evidence. Detailed technical decisions remain in ADRs. A log entry records a decision only when it is supported by an existing approved artifact or an explicit owner instruction; proposed work is not silently recorded as approved.

| ID | Date | Decision | Authority / evidence | Status | Consequence |
|---|---|---|---|---|---|
| SD-001 | 2026-11-18 | Use the canonical 16-phase sequence in `ROADMAP_16_PHASE.md`; historical roadmap numbering does not replace it. | Product owner selected the 16-phase plan in project direction; canonical repository roadmap. | RECORDED | Phase identity is stable; subtracks remain within canonical phases. |
| SD-002 | 2026-11-16 | Keep all Searqon product source in `LloydCoder/tinlance-searqon`; evolve as a modular monolith/monorepo and avoid premature microservices. | Accepted ADR-0002. | ACCEPTED | One source of truth; independently deployable workloads only when justified. |
| SD-003 | 2026-11-16 | Preserve v1 observation, confidence and action semantics; introduce future concepts through versioned contracts rather than overloading enums. | Accepted ADR-0001. | ACCEPTED | Contract compatibility and migration tests are mandatory. |
| SD-004 | 2026-11-18 | Searqon owns discoverability methodologies and evidence interpretation; Tinlyt is optional acquisition; TAS owns agent authorization/execution; FadeReach is optional prospecting. | Existing `ARCHITECTURE.md`, `ARCHITECTURE_SPEC.md` and product charter. | RECORDED | No cross-product dependency or authority transfer without a versioned contract and security review. |
| SD-005 | 2026-11-18 | No new paid infrastructure/provider spend, plan upgrade or quota workaround without explicit budget approval. | Canonical roadmap non-negotiables and project owner cost constraint. | RECORDED | Prefer local/open-source and existing free-tier capabilities; do not incur spend autonomously. |
| SD-006 | 2026-11-18 | No production deployment during the current repair/development hold; production remains unchanged until separately authorized release checks. | Explicit project instruction in current Searqon execution context. | RECORDED | No Vercel deploy/preview attempt or production alias mutation in this work sequence. |
| SD-007 | 2026-11-18 | Phase completion requires exit evidence, forensic review and explicit product-owner acceptance; green CI alone is insufficient. | Canonical roadmap status definitions and acceptance rules. | RECORDED | Implementation progress is not reported as phase acceptance. |
| SD-008 | 2026-11-18 | The hosted Report Composer and Delivery Center is a mandatory Phase 13 subtrack, including printable/exportable report cards and multiple document formats. | Explicit product owner requirement recorded in project execution brief. | RECORDED | Implement canonical report model, secure export, print/PDF and other required formats; no external delivery without user action. |
| SD-009 | 2026-11-18 | Build a separate Searqon Platform Control Center; platform staff roles and permissions must not reuse customer organization membership roles. | Product owner requested full admin-side implementation; forensic audit found customer roles only. | RECORDED | Staff identity, MFA, permission matrix and audit foundation precede privileged UI/actions. |
| SD-010 | 2026-11-18 | Keep the product evidence-first and separate SEO, AEO, GEO and AgEO coverage, confidence and limitations; never manufacture scores or live observations. | Product charter, architecture and canonical roadmap. | RECORDED | All dashboards, reports and marketing claims must preserve provenance and unavailable/not-assessed states. |

## Decision change protocol

- A decision may be changed only through a new dated entry that identifies the superseded decision and rationale.
- Security, data, contract, provider and deployment changes require a corresponding ADR or implementation-specific review where appropriate.
- An entry marked RECORDED is a traceability record, not proof that its consequences have been implemented.
- No entry grants permission to spend money, access third-party systems, send external communications, merge unrelated work or deploy production.
