# Delivery Roadmap and Acceptance Protocol

This roadmap is a controlled sequence, not a claim that work is complete. Each phase must have an owner, scope, risk review, test evidence, and explicit acceptance record.

## Status vocabulary

- `NOT_STARTED`: no implementation work accepted.
- `IN_PROGRESS`: work is underway; deliverables are incomplete.
- `BLOCKED`: a dependency, decision, permission, or control prevents safe progression.
- `IMPLEMENTED`: code or documentation exists, but verification is incomplete.
- `VERIFIED`: required checks and forensic review passed with recorded evidence.
- `ACCEPTED`: the designated product owner has accepted the verified deliverables.

A green CI run is necessary for applicable code changes, but is not sufficient for phase acceptance or production readiness.

## Phases

| Phase | Scope | Exit evidence |
|---|---|---|
| 0 | Charter, constraints, ownership, decision records | Approved charter, scope, risk register, decision log |
| 1 | Customer and commercial validation | 15 interviews, 5 design partners, 3 paid pilot commitments or an explicit evidence-based pivot |
| 2 | Open-source governance and repository foundation | License/provenance review, contribution/security policies, CI, release conventions |
| 3 | Domain contracts and architecture | Versioned contracts, threat model, ADRs, testable boundaries |
| 4 | Secure acquisition | SSRF regression suite, DNS/redirect defenses, bounded fetch tests, explicit cross-origin redirect authorization, controlled-origin integration evidence |
| 5 | Evidence and provenance | Reproducible evidence records, retention/deletion/redaction tests |
| 6 | Passive Agent Readiness Scanner | Deterministic checks, fixtures, CLI report, JSON output |
| 7 | GEO Intelligence Engine | Permitted observation adapters, sampling methodology, citation/mention analysis, cost controls |
| 8 | User interfaces and reporting | Accessible CLI/API/report experience and end-to-end tests |
| 9 | Hosted service | Tenant isolation, roles, billing, quotas, scheduling, audit, backups, recovery |
| 10 | Security and privacy assurance | Threat-model closure, ASVS-aligned evidence, privacy/retention review, independent testing |
| 11 | Reliability and operations | CI, observability, SLOs, incident/recovery exercises, signed release artifacts |
| 12 | Design-partner pilots | Measured outcomes, usability evidence, provider cost and support data |
| 13 | Commercial v1 launch | Security, reliability, documentation, support, pricing, and pilot gates accepted |
| 14 | SEO and AEO expansion | Versioned methodologies, authorized integrations, verified recommendations |
| 15 | Advanced AgEO and enterprise maturity | Protocol/auth readiness, governance controls, enterprise evidence and approved integrations |

## Global release gates

- No unresolved critical or high severity security issue.
- No known SSRF path to private, loopback, link-local, or cloud metadata targets.
- No cross-tenant data exposure.
- Evidence can be traced to source and methodology version.
- Tests are deterministic and run in CI; no skipped security tests to obtain a green build.
- Backup and recovery are exercised before hosted GA.
- Provider costs, quotas, and gross-margin assumptions are measured, not inferred from illustrative spreadsheets.
- Customer validation and support readiness are documented.
- Production deployment has a rollback plan, monitoring, and incident ownership.

## Mandatory non-negotiables

- No new AWS or other paid infrastructure spend without explicit budget approval.
- No full fork of OpenSEO or Elmo; adapt patterns with license and provenance review.
- No consumer AI scraping without an approved, terms-compliant method.
- No MCP tool execution in the initial scanner.
- No production release based only on a green workflow.
- No claiming a phase is complete without implementation, verification, forensic review, and acceptance evidence.

## Immediate execution order

1. Establish product and security decision records.
2. Validate customer demand before committing to broad hosted infrastructure.
3. Define domain contracts and threat model.
4. Implement a small, testable, passive scanner slice.
5. Prove evidence provenance and safe acquisition before adding scale.
6. Add GEO providers only after method, terms, repeatability, and unit costs are validated.
