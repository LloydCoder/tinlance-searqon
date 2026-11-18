# Searqon Product and Security Risk Register

**Register version:** 1.0  
**Last reviewed:** 2026-11-18  
**Scope:** Product-wide risks across the canonical 16-phase roadmap.  
**Status semantics:** OPEN, MITIGATING, BLOCKED, ACCEPTED (risk owner approval required), CLOSED (evidence required).

This is a working register, not a claim that every risk has been fully quantified or independently assessed. Likelihood and impact are qualitative triage ratings, not statistical estimates.

| ID | Risk | Likelihood | Impact | Current controls / evidence | Required treatment and exit evidence | Status |
|---|---|---|---|---|---|---|
| SR-001 | False confidence from partial or heuristic SEO/AEO/GEO/AgEO coverage | High | High | Discipline-specific coverage and limitations; deterministic methodology versions; evidence-linked findings | Golden datasets, labelled evaluation, calibration, clear unavailable/not-assessed states and customer review | MITIGATING |
| SR-002 | Unauthorized or terms-incompatible acquisition from public sites or AI providers | Medium | Critical | Bounded single-page scanner, authorization attestation, DNS/redirect controls; provider collection not enabled | Per-provider terms/legal review, scoped authorization, collection policy, rate/cost limits and audit evidence | MITIGATING |
| SR-003 | SSRF, DNS rebinding, redirect abuse or access to private/control-plane networks | Medium | Critical | URL/IP policy, DNS pinning, redirect checks, robots controls and regression suite | Continue adversarial IPv4/IPv6, redirect, resolver, proxy and controlled-origin testing; independent security review | MITIGATING |
| SR-004 | Cross-tenant exposure through APIs, persistence, jobs, reports or exports | Medium | Critical | PostgreSQL RLS, restricted runtime role, tenant-scoped services and integration tests | Tenant-isolation tests for every new endpoint, worker, report, support and admin operation; independent review | MITIGATING |
| SR-005 | Prompt injection or untrusted external content influencing privileged actions | High | Critical | Passive scanner boundary; TAS execution authority boundary; untrusted-data policy | Adversarial fixtures, policy isolation, tool/output taint handling, explicit approvals and sandbox tests | MITIGATING |
| SR-006 | GEO observations are incomplete, biased, non-repeatable or misrepresented as equivalent | High | High | Observation-class separation, supplied-data provenance, cohorts and freshness disclosure | Approved acquisition, sampling design, labelled repeatability/quality study and provider/surface separation | MITIGATING |
| SR-007 | Customer data, prompts, answers or evidence retained longer or more broadly than intended | Medium | Critical | Local evidence primitives, redaction and legal-hold event records; limitations documented | Durable tenant retention controls, physical deletion/backup expiry, access audit, privacy/legal review | BLOCKED |
| SR-008 | Hosted asynchronous work runs with stale authorization or excessive privilege | Medium | Critical | Tenant-scoped queue, lease-fenced handlers, restricted worker role and runtime authorization patterns | Complete worker authorization re-resolution, permission matrix, isolation/egress controls and adversarial tests | MITIGATING |
| SR-009 | Billing, usage or provider costs exceed customer consent or unit-economic limits | High | High | Entitlement evaluator, atomic usage reservations, project/manual assessment limits, supplied GEO metering | Meter all billable paths, signed provider webhooks, overage consent, budgets, reconciliation and measured unit economics | MITIGATING |
| SR-010 | Incomplete backup, restore, incident response or operational monitoring causes unrecoverable loss | Medium | Critical | CI, bounded queue foundations, documented deployment boundaries | Production backup/restore exercise, SLOs, alerting, incident playbooks, rollback and ownership | BLOCKED |
| SR-011 | Staff/admin privilege compromise enables cross-tenant or destructive operations | Medium | Critical | No complete platform admin surface found in current audited code; customer roles are distinct | Staff identity, phishing-resistant MFA, least-privilege permissions, dual approval, just-in-time access and tamper-evident audit | BLOCKED |
| SR-012 | Commercial product is built without validated buyer pain, willingness to pay or delivery economics | High | High | Defined buyer hypotheses and informational pricing only | 15 interviews, 5 design partners, 3 paid-pilot commitments or evidence-based pivot | BLOCKED |
| SR-013 | Open-source dependency/license/provenance obligations are missed | Medium | High | Apache-2.0 license, npm audit, SBOM/attestation workflows and security policy | Full transitive license/provenance review, release evidence and repository ruleset verification | MITIGATING |
| SR-014 | Vercel Hobby commercial-use restrictions or deployment quotas block lawful/operational commercial launch | High | High | No paid commercial launch claim; deployment hold and no-upgrade constraint documented | Verify current hosting terms and quota; select commercially permitted hosting/plan before paid launch, with explicit spend approval | BLOCKED |
| SR-015 | Report/export/share functionality leaks sensitive evidence or produces inconsistent artifacts | Medium | Critical | Existing local HTML report and tenant-scoped foundations; full composer not complete | Canonical report model, redaction, tenant authorization, secure expiry, format equivalence and adversarial export tests | BLOCKED |
| SR-016 | Platform administration and support access are implemented without strong separation from customer tenancy | Medium | Critical | Existing customer membership roles; no verified platform-admin API/console | Separate staff identity/roles, admin DB boundary, permission matrix, scoped support grants and two-person approval | BLOCKED |
| SR-017 | Product scope and phase status drift across competing roadmaps or stale documentation | High | High | Canonical 16-phase roadmap and status vocabulary documented | Single status register, reconcile historical roadmap references and require evidence-linked phase updates | MITIGATING |

## Risk governance

1. Each risk needs a named accountable owner before it can be accepted or closed. Do not invent owners or approvals.
2. Risk acceptance requires a recorded rationale, scope, expiry/review date and explicit approval by the authorized owner.
3. A mitigation is not closure. Closure requires test, operational or customer evidence appropriate to the risk.
4. Critical/high risks affecting customer data, authorization, acquisition or production operations block the relevant release gate.
5. Re-review the register when architecture, provider terms, data classes, threat model, hosting or commercial model changes.
6. This register does not replace a formal threat model, privacy impact assessment, ASVS assessment or independent penetration test.
