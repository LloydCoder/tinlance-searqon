# Searqon Implementation Status

**Last reconciled:** 2026-11-16  
**Base commit for this status revision:** `49bbbfe150ba222f15c67c1ab7cc132fd3e604a0`  
**Product maturity:** Early alpha; not production-ready.

This register separates implemented repository capabilities from customer, security, operational, and commercial acceptance. Green CI and CodeQL are necessary engineering gates, not production-readiness certification. Status is evidence-based; implementation does not imply independent assurance or product-owner acceptance.

## Phase status

| Phase | Status | Evidence and remaining exit gates |
|---|---|---|
| 0 — Product control | IMPLEMENTED | Product charter, four-discipline positioning, constraints, product boundaries, and roadmap are documented. Formal product-owner acceptance is not recorded. |
| 1 — Customer validation | BLOCKED | Interviews, five design partners, and paid-pilot commitments require real customer participation. No interviews or commitments are fabricated or claimed. |
| 2 — Open-source foundation | IN_PROGRESS | Public Apache-2.0 repository, contribution/security policies, Node 22/24 CI, npm lockfile/audit, package dry-run, CodeQL v4, checksum-verified full-history Gitleaks scan, weekly Dependabot updates, and a published-release workflow that generates CycloneDX SBOM/checksums and GitHub artifact attestations. Full license/provenance review, an executed tagged release, and repository ruleset/required-check verification remain. |
| 3 — Domain contracts | IN_PROGRESS | Evidence provenance runtime contract, seven original published JSON Schemas plus signed redaction-manifest/journal/checkpoint and legal-hold event/journal/checkpoint schemas are registered. ADR-0001 freezes current v1 observation semantics; the contract registry records exact IDs, versions, consumers and compatibility policy. Public API/persistence boundaries and an explicit synchronous migration registry are implemented and tested. No real v1-to-v2 schema migration is registered because no v2 contract exists; cross-version consumer fixtures remain a future version-bump gate. |
| 4 — Secure remote acquisition | VERIFIED | URL/IP policy, public DNS validation, pinned socket lookup, manual redirect validation, hard per-request deadlines, DNS/socket inactivity timeouts, bounded response headers/bytes, robots parser/retrieval/cache, RFC 9309 path normalization, and robots-aware one-page scanning are implemented and regression-tested. PR #29 supplies a live pinned IPv4 HTTPS/TLS smoke test. PR #38 adds deterministic DNS-rebinding tests for same-host and cross-host redirect hops; PR #40 covers IPv6 SRv6 non-global destinations; PR #42 enforces explicit caller authorization at the exported API and CLI; PR #43 denies cross-origin redirects by default and requires an explicit public-origin allowlist; PR #45 distinguishes unsafe redirect-policy rejection from robots failures; PR #46 implements RFC 9309 percent-encoding normalization and octet-based specificity. The remote scanner is deliberately one-page and does not recursively crawl or render browser content. Phase 4 acceptance covers this bounded acquisition model. Controlled-origin live redirect/DNS-rebinding/timeout integration is tracked under Phase 11; stronger authorization/ownership verification and browser/process isolation remain under Phases 10–11. Operator attestations and origin allowlists are not independent proof of ownership. No recursive crawl is enabled. |
| 5 — Evidence and provenance | IN_PROGRESS | Runtime evidence records, SHA-256 ledger chaining, persistent local JSONL storage, detached Ed25519 ledger checkpoints, deterministic retention-expiry evaluation, signed redaction manifests, a hash-linked redaction journal and detached Ed25519 checkpoints, an offline recovery-bundle integrity verifier, and signed legal-hold place/release events, actor-bound approver registry, bounded hash-linked journal, detached journal checkpoints and recovery-bundle verification are implemented and tested. Retention and recovery evaluation are metadata/integrity decisions only; redaction suppresses exports but does not delete source entries. Legal-hold events are persisted in a local hash-linked journal with detached checkpoints. An optional in-memory approver registry binds signing keys to `approvedBy` actor IDs and supports revocation/rotation; actor authentication, requester identity proof and durable registry custody remain external. The ledger/journal remain local, single-process, plaintext and non-WORM. Physical deletion/sanitization, backup expiry/restore exercise, requester identity proof, durable/distributed registry custody, access controls and tenant isolation remain. |
| 6 — Passive Agent Readiness Scanner | IN_PROGRESS | Local HTML, Markdown, OpenAPI, and caller-supplied normalized MCP snapshot analysis plus a bounded one-page remote scanner with robots checks, redirect destination policy checks, a 2 MiB response cap, and explicit operator authorization attestation. OpenAPI diagnostics cover security requirements, operation readiness, OpenAPI 3.2 URI-reference semantics, and duplicate `operationId` detection. MCP snapshot diagnostics cover duplicate and invalid tool names, descriptions, input-schema root shape, capability consistency, untrusted side-effect hints, 2026-07-28 request metadata and tools/list cache metadata, and Streamable HTTP x-mcp-header token/uniqueness/type/static-reachability rules; no MCP connection or tool invocation occurs. Findings are evidence-linked with explicit partial coverage. Recursive crawling, browser rendering, MCP metadata acquisition, and complete discipline audits remain. |
| 7 — GEO intelligence | IN_PROGRESS | Existing supplied-observation normalization, provider/channel provenance, brand mention/citation extraction, cohort-safe aggregation, Wilson 95% intervals and evidence-record integrity remain intact. PR #92 merged: versioned Brand Truth Registry (owner assertions, aliases, fact provenance, review state and content digest), deterministic locale/market prompt cohorts, and policy-reviewed GEO sampling plans with JSON Schemas, contract-registry entries and CLI commands. Consumer observations are manual-capture only; model API observations require a named official API adapter and remain separate. Plans enforce reviewer provenance, per-provider sample limits, a 10,000-task ceiling and an explicit USD cost cap. No live provider adapters, consumer-interface automation, scheduling, durable GEO history, alerting or monitoring. |
| 8 — Interfaces and reporting | IN_PROGRESS | PR #86 merged as `f835d2fb4250df7a787c1076e8c713fa1e167207`: editorial landing page, responsive four-discipline dashboard preview, same-origin Node HTTP API for caller-supplied HTML/Markdown/OpenAPI assessments, security headers, bounded JSON input, API regression tests, and single-repository architecture. PR #90 merged as `4e7a8677d7a37d557e8bdf4b748e1f0790cae653`: registration/login/verification pages, authenticated workspace shell, session-aware browser flow and official favicon. Dashboard figures remain illustrative. PR #91 merged: organization-scoped project APIs and UI, project-scoped synchronous persisted assessments, audit history, role-gated writes and four-discipline findings/coverage overview. Dashboard figures remain illustrative. This branch adds deterministic claim sentence extraction, brand/alias resolution, registry-relative contradiction and freshness classification, citation/source attribution analysis, a correction manifest that cannot auto-publish, JSON Schema contracts, and a CLI workflow. This is not a universal hallucination verdict; no citation URLs are fetched. Accessibility audit, browser visual QA, complete customer reporting and live GEO observation remain. |
| 9 — Hosted service foundation (cross-cutting; product roadmap Phase 13) | IN_PROGRESS | PostgreSQL 16 schema and checksum-verified migration runner; tenant RLS and append-only audit; pinned `pg@8.23.1` TLS-aware pool; every tenant transaction assumes restricted `searqon_app` and sets authenticated identity locally. Passwordless registration, one-time magic links, token replacement/consumption, 30-minute inactivity and 24-hour absolute session expiry, session creation/lookup/revocation, HMAC-based distributed rate limits, Resend/local-only email adapters, same-origin auth endpoints, HttpOnly/SameSite/Secure production cookies, authenticated workspace shell, project creation/list/detail, project-scoped synchronous assessment persistence/history, role-gated writes, public-target URL policy, and PostgreSQL 16 integration coverage are implemented and merged in PR #91. Assessment reports and audit events are tenant-scoped through RLS and stored transactionally. Not production deployed. Project update/archive/delete, async queue/scheduler, durable retries, quotas, billing, invitations/admin flows, MFA/SSO, email webhooks/cleanup, backups/recovery, encryption/key management and deployment remain. |
| 10 — Security/privacy assurance | IN_PROGRESS | Security policy, URL/DNS/robots primitives, CodeQL v4, npm audit, full-history Gitleaks secret scanning, and regression tests exist. CodeQL completed successfully on the exact heads of PRs #38–#46, #57–#63, #65, and #66. The latest main merge commit's CodeQL workflow also passed. Alert disposition has not been independently reviewed here. Full-history Gitleaks secret scanning runs on pull requests, main pushes, and a daily schedule; no independent penetration test, ASVS assessment, privacy/legal review, or production threat-model closure. |
| 11 — Reliability and operations | IN_PROGRESS | CI tests Node.js 22/24, source syntax, full tests, CLI examples including standalone HTML report generation, actionlint workflow validation, npm audit, package dry-run, CycloneDX SBOM generation, a live pinned HTTPS/TLS smoke test, and full-history secret scanning; CodeQL is configured for PRs/main and weekly runs. The release workflow adds CycloneDX SBOMs, checksums, and GitHub artifact attestations; CI validates SBOM generation on Node.js 22/24. PR #38 CI and CodeQL both passed on its exact head; PR #40 CI and CodeQL both passed on its exact head; PR #41 CI and CodeQL both passed on its exact head; PR #42 CI and CodeQL both passed on its exact head; PR #43 CI and CodeQL both passed on its exact head; PRs #57–#63, #65, and #66 also passed Node.js 22/24 CI and CodeQL on their exact final heads. Latest main CI, CodeQL and secret-scan runs `43866741449`, `43866741408` and `43866741518` passed on commit `2342bb9ed31e7d8e6a09bfa7c83562f88e15513e`. Controlled-origin live redirect/DNS-rebinding/timeout integration tests remain an explicit exit gate. Published releases are configured to carry CycloneDX SBOMs, checksums, and GitHub artifact attestations; no production SLOs, deploy/rollback, incident response, backups, or recovery exercise. Push-triggered CI and CodeQL workflows were verified green on the merge commits for PRs #38 through #46; exact run IDs are recorded below. |
| 12 — Design-partner pilots | BLOCKED | Requires recruited organizations and real pilot participation. No pilots or outcomes are claimed. |
| 13 — Commercial v1 | NOT_STARTED | No production service, accepted customer outcomes, support operations, validated pricing, or measured unit economics. |
| 14 — SEO/AEO expansion | IN_PROGRESS | HTML SEO/AEO diagnostics and a small local HTML/Markdown/OpenAPI rule set exist, with a versioned expanded HTML methodology. Search Console integration, technical crawl, Core Web Vitals measurement, broader entity/answer methodology, multilingual validation, and verified remediation remain. |
| 15 — Advanced AgEO | IN_PROGRESS | Partial OpenAPI and documentation heuristics plus explicit observation coverage exist. OpenAPI security and operation-readiness diagnostics are implemented, including 3.2 URI-reference handling. Passive MCP metadata compatibility now includes 2026-07-28 protocol version, server identity, cache metadata, and custom-header annotation checks. Live protocol interoperability, OAuth protected-resource and authorization-server discovery, token audience/PKCE validation, runtime auth/authorization validation, reliability, transaction safety, governance, and enterprise assurance remain. |

## Merged implementation increments

- [PR #86](https://github.com/LloydCoder/tinlance-searqon/pull/86) — Searqon marketing site, local assessment API, brand-aligned dashboard preview, and single-repository architecture decision.
- [PR #69](https://github.com/LloydCoder/tinlance-searqon/pull/69) — standalone accessible HTML assessment reports and local report CLI.
- [PR #71](https://github.com/LloydCoder/tinlance-searqon/pull/71) — approved architecture expansion, painkiller module contracts and 16-phase roadmap.
- [PR #72](https://github.com/LloydCoder/tinlance-searqon/pull/72) — runtime/schema observation-class alignment and domain compatibility ADR.
- [PR #73](https://github.com/LloydCoder/tinlance-searqon/pull/73) — versioned contract registry, schema identity/reference checks and public API boundaries.
- [PR #74](https://github.com/LloydCoder/tinlance-searqon/pull/74) — explicit contract migration registry and tests.
- [PR #75](https://github.com/LloydCoder/tinlance-searqon/pull/75) — deterministic evidence retention evaluation.
- [PR #76](https://github.com/LloydCoder/tinlance-searqon/pull/76) — signed redaction manifests, schema and fail-closed export suppression.
- [PR #77](https://github.com/LloydCoder/tinlance-searqon/pull/77) — persistent signed redaction journal with hash-chain verification and local file controls.
- [PR #78](https://github.com/LloydCoder/tinlance-searqon/pull/78) — detached Ed25519 checkpoints for redaction-journal prefixes.

- [PR #1](https://github.com/LloydCoder/tinlance-searqon/pull/1) — repository foundation and governance.
- [PR #2](https://github.com/LloydCoder/tinlance-searqon/pull/2) — local HTML/OpenAPI scanner and CLI.
- [PR #3](https://github.com/LloydCoder/tinlance-searqon/pull/3) — evidence provenance contract.
- [PR #4](https://github.com/LloydCoder/tinlance-searqon/pull/4) — distinct SEO/AEO/GEO/AgEO coverage reporting.
- [PR #5](https://github.com/LloydCoder/tinlance-searqon/pull/5) — Markdown API documentation readiness checks.
- [PR #6](https://github.com/LloydCoder/tinlance-searqon/pull/6) — assessment report JSON Schema.
- [PR #7](https://github.com/LloydCoder/tinlance-searqon/pull/7) — phase status and local scanner examples.
- [PR #8](https://github.com/LloydCoder/tinlance-searqon/pull/8) — evidence source-label privacy hardening.
- [PR #9](https://github.com/LloydCoder/tinlance-searqon/pull/9) — CodeQL and dependency audit workflow foundation.
- [PR #10](https://github.com/LloydCoder/tinlance-searqon/pull/10) — CodeQL action v4.
- [PR #11](https://github.com/LloydCoder/tinlance-searqon/pull/11) — provenance-aware GEO observation and aggregation engine.
- [PR #12](https://github.com/LloydCoder/tinlance-searqon/pull/12) — GEO CLI and observation schema.
- [PR #13](https://github.com/LloydCoder/tinlance-searqon/pull/13) — SSRF-resistant URL/IP policy primitives.
- [PR #14](https://github.com/LloydCoder/tinlance-searqon/pull/14) — public DNS validation and pinned lookup callback.
- [PR #15](https://github.com/LloydCoder/tinlance-searqon/pull/15) — bounded robots.txt parser and evaluator.
- [PR #16](https://github.com/LloydCoder/tinlance-searqon/pull/16) — GEO aggregation fixtures and documentation.
- [PR #17](https://github.com/LloydCoder/tinlance-searqon/pull/17) — GEO cohort integrity and validation.
- [PR #18](https://github.com/LloydCoder/tinlance-searqon/pull/18) — citation provenance hardening and CLI smoke tests.
- [PR #20](https://github.com/LloydCoder/tinlance-searqon/pull/20) — DNS-pinned bounded HTTP acquisition transport with redirect, timeout, encoding, and response-size regression coverage.
- [PR #22](https://github.com/LloydCoder/tinlance-searqon/pull/22) — bounded robots.txt retrieval, failure policy, and process-local cache.
- [PR #24](https://github.com/LloydCoder/tinlance-searqon/pull/24) — robots-aware authorized single-page remote scanner and redirect destination policy enforcement.
- [PR #26](https://github.com/LloydCoder/tinlance-searqon/pull/26) — standalone versioned Evidence Record JSON Schema and runtime contract regression tests.
- [PR #28](https://github.com/LloydCoder/tinlance-searqon/pull/28) — remote scan result JSON Schema and runtime result contract tests.
- [PR #29](https://github.com/LloydCoder/tinlance-searqon/pull/29) — live pinned IPv4 HTTPS/TLS integration test in GitHub Actions.
- [PR #34](https://github.com/LloydCoder/tinlance-searqon/pull/34) — hard HTTP acquisition deadlines and Azure WireServer/local special-use SSRF blocking.
- [PR #35](https://github.com/LloydCoder/tinlance-searqon/pull/35) — reconcile SSRF hardening and scanner implementation status.
- [PR #36](https://github.com/LloydCoder/tinlance-searqon/pull/36) — expanded HTML SEO/AEO diagnostics and methodology versioning.
- [PR #37](https://github.com/LloydCoder/tinlance-searqon/pull/37) — OpenAPI security and agent-readiness diagnostics, including OpenAPI 3.2 URI-reference semantics.
- [PR #38](https://github.com/LloydCoder/tinlance-searqon/pull/38) — deterministic same-host and cross-host DNS-rebinding redirect regression tests.
- [PR #39](https://github.com/LloydCoder/tinlance-searqon/pull/39) — reconcile phase status and verification limitations through PR #38.
- [PR #40](https://github.com/LloydCoder/tinlance-searqon/pull/40) — explicit IPv6 SRv6 non-global address boundary regression tests.
- [PR #42](https://github.com/LloydCoder/tinlance-searqon/pull/42) — explicit authorization attestation enforced by the remote scanner API and CLI.
- [PR #43](https://github.com/LloydCoder/tinlance-searqon/pull/43) — cross-origin redirect allowlist, distinct unauthorized-redirect result, CLI option, and versioned schema.
- [PR #44](https://github.com/LloydCoder/tinlance-searqon/pull/44) — reconcile security policy and workflow evidence through PR #43.
- [PR #45](https://github.com/LloydCoder/tinlance-searqon/pull/45) — classify unsafe redirect destinations separately from robots failures.
- [PR #46](https://github.com/LloydCoder/tinlance-searqon/pull/46) — RFC 9309 path normalization, percent-encoding comparison, and octet-based rule specificity.
- [PR #49](https://github.com/LloydCoder/tinlance-searqon/pull/49) — evidence record/content verification and digest integrity checks.
- [PR #50](https://github.com/LloydCoder/tinlance-searqon/pull/50) — tamper-evident sequence-numbered evidence ledger chain.
- [PR #51](https://github.com/LloydCoder/tinlance-searqon/pull/51) — persistent local JSONL evidence ledger store with bounded writes and single-process writer protection.
- [PR #53](https://github.com/LloydCoder/tinlance-searqon/pull/53) — reject hard-linked and foreign-owned evidence-ledger files.
- [PR #57](https://github.com/LloydCoder/tinlance-searqon/pull/57) — detect duplicate OpenAPI `operationId` values and report the diagnostic as evidence-linked AgEO readiness coverage.
- [PR #58](https://github.com/LloydCoder/tinlance-searqon/pull/58) — revalidate GEO evidence records at aggregation and reject forged content-addressed identifiers.
- [PR #59](https://github.com/LloydCoder/tinlance-searqon/pull/59) — add passive MCP tool-catalog snapshot analysis, schema, CLI support, fixture, and CI smoke coverage.
- [PR #60](https://github.com/LloydCoder/tinlance-searqon/pull/60) — reject duplicate GEO evidence identifiers to protect independent sample counts.
- [PR #61](https://github.com/LloydCoder/tinlance-searqon/pull/61) — reject non-canonical and duplicate citation URLs during GEO aggregation.
- [PR #62](https://github.com/LloydCoder/tinlance-searqon/pull/62) — add optional UTC-day grouping to GEO aggregation while preserving all-time grouping by default.
- [PR #63](https://github.com/LloydCoder/tinlance-searqon/pull/63) — validate provider dimensions, brand labels, and canonical target-domain cohort values at aggregation.
- [PR #65](https://github.com/LloydCoder/tinlance-searqon/pull/65) — add passive MCP 2026-07-28 protocol metadata, cache-result validation, x-mcp-header safety checks, and snapshot schema v1.1.0.
- [PR #66](https://github.com/LloydCoder/tinlance-searqon/pull/66) — add detached Ed25519 signatures over verified evidence-ledger roots and a versioned checkpoint schema.
- [PR #68](https://github.com/LloydCoder/tinlance-searqon/pull/68) — add full-history Gitleaks scanning, Dependabot automation, pinned GitHub Actions, actionlint, CycloneDX SBOM generation, and GitHub release artifact attestations.
- [PR #67](https://github.com/LloydCoder/tinlance-searqon/pull/67) — reconcile evidence and MCP documentation.
## Verification gates and limitations

- CI: Node.js 22 and 24; pinned actionlint workflow validation; syntax checks for root and nested source modules; full Node test suite; smoke tests for HTML, Markdown, OpenAPI, GEO analysis, and GEO aggregation examples; `npm audit --audit-level=high`; `npm pack --dry-run`; CycloneDX SBOM generation and schema-format check.
- CodeQL: v4 JavaScript/TypeScript analysis configured for pull requests, main pushes, and weekly schedule. PR #38's exact head passed. Review any reported alerts separately.
- PR #39 exact head: CI run 43641539310 and CodeQL run 43641539343 both completed successfully. Merge commit: `25286677f04e8c38712e2f7d04b0e474c898d1e9`; push CI 43641645247 and CodeQL 43641645277 both passed.
- PR #41 exact head: CI run 43641797102 and CodeQL run 43641797079 both completed successfully. Merge commit: `eec9cedd9329fb29cab827a9a40cdaa72be930c8`; push CI 43641890290 and CodeQL 43641890275 both passed.
- PR #42 exact head: CI run 43642145934 and CodeQL run 43642145938 both completed successfully. Merge commit: `69aa86e3f02b525873a81b332455ba05ff5ee8cb`; push CI 43642251274 and CodeQL 43642251323 both passed.
- PR #43 exact head: CI run 43642434475 and CodeQL run 43642434580 both completed successfully. Merge commit: `80841c1982326b566071aeec2d0035a1612a2950`; push CI 43642541922 and CodeQL 43642541899 both passed.
- PRs #57–#63: Node.js 22/24 CI and CodeQL passed on the exact final heads before merge. Latest main commit `601607d927c9ccc3f5a657c54880a059190249bc`: CI run `43652783235` and CodeQL run `43652783234` both completed successfully.
- PR #38 exact head: CI run 43639506465 and CodeQL run 43639506501 both completed successfully. Merge commit: `5013fe4ab6a3cb2599c6339f832ae88417307583`; push CI 43641380749 and CodeQL 43641380688 both passed.
- PR #40 exact head: CI run 43641633078 and CodeQL run 43641632965 both completed successfully. Merge commit: `a96c4db8962d4dc0e1f2e95db47e79dfa103401c`; push CI 43641727293 and CodeQL 43641727309 both passed.
- PR #39 and PR #41 through #43 exact-head and merge-commit checks are listed above; all named CI and CodeQL runs completed successfully.
- Dependency Review: not enabled because GitHub Dependency Graph is disabled for this repository; npm audit is the active dependency vulnerability check. Enable Dependency Graph in repository security settings before restoring Dependency Review.
- Secret scanning: no dedicated workflow has been added or independently verified.
- Branch protection: required status checks and ruleset enforcement have not been inspected or configured in this execution.
- Deployment: no deployment workflow exists because no production target, credentials, or budget approval have been configured.

## Remaining release blockers

1. Complete controlled-origin live integration tests for redirect handling, DNS rebinding, and timeout behavior (Phase 11); deterministic injected tests and the live pinned HTTPS/TLS smoke test do not replace this.
2. Replace operator self-attestation with a stronger authorization/ownership model before enabling unattended or multi-page acquisition; add crawl scope/depth/concurrency controls and browser/process isolation before broader crawling.
3. Extend the local evidence store with retention, deletion/redaction policy and recovery tests; define out-of-band checkpoint custody and future database adapter contracts. Multi-tenant access controls remain a hosted-service concern. The local append-only JSONL adapter is not WORM storage; detached signed checkpoints do not make the ledger file itself immutable.
4. Add permitted GEO provider adapters only after terms, reproducibility, sampling, rate limits, and cost controls are verified.
5. Recruit design partners and conduct customer interviews; validate willingness to pay and actual outcomes.
6. Build hosted tenancy, billing, monitoring, and operations only after validation and explicit infrastructure approval.
7. Complete independent security, privacy, operational, and commercial acceptance before GA.

- PR #44 exact head: CI run 43642728217 and CodeQL run 43642728216 passed. Merge commit: `1b7129c4c06b0cefab09580f12615326d33a4ef1`; push CI 43642821620 and CodeQL 43642821632 passed.
- PR #45 exact head: CI run 43643006972 and CodeQL run 43643007066 passed. Merge commit: `f889a807ea6cc86cf990c1f63bd1a7377f1b909a`; push CI 43643100523 and CodeQL 43643100508 passed.
- PR #46 exact head: CI run 43643603194 and CodeQL run 43643603192 passed. Merge commit: `56610e0595d905d95afe084b050916d73befce7d`; push CI 43643706462 and CodeQL 43643706450 passed.
- PR #51 exact head `bc574dfc0f767df0094e4fbfe33e7ffdce222fe3`: merged after the persistent local JSONL ledger tests and implementation; the merge commit is `5dec145f93546e97ef5a91d10c169cc71e159f93`.
- PR #53 exact head `67ecce63f0f7ab4e7ff7326db614efedd5c7ed53`: merged hard-link and current-user ownership checks; merge commit `da935e3141ab72d37bccff351d0025d8cae49547`.
- PR #54 reconciled evidence-store ownership documentation.
- PR #55 exact main commit `ea4e08482168c78c21ec7bfe51bcc4cd7c8970f3`: push CI run `43649309732` passed on Node.js 22 and 24; CodeQL run `43649309697` passed. The main head at the time of this revision is green for CI and CodeQL.


## 2026-11-15 — Approved architecture expansion (documentation only)

- Added `docs/ARCHITECTURE_SPEC.md`, `docs/MODULE_CONTRACTS.md`, and `docs/ROADMAP_16_PHASE.md` on branch `docs/painkiller-modules-architecture-roadmap`.
- Updated forward architecture to include Brand Hallucination & Citation Defense, Competitor Citation-Change Alerts, Agent Artifact Compiler, and Simulated Agent Sandbox.
- Reconciled protocol targets to OpenAPI 3.2.1 and MCP 2026-07-28; llms.txt remains an optional community proposal, not a guaranteed discovery/ranking mechanism.
- No feature implementation is claimed by this documentation change. Phase status remains governed by existing code, CI evidence, forensic audit and explicit acceptance records.


## 2026-11-16 — Phase 3 domain contract reconciliation (in progress)

- PR #72 adds regression tests comparing runtime observation-class constants with the evidence, assessment and GEO JSON Schema enums.
- Runtime modules now export frozen canonical observation-class arrays; internal validators consume those arrays.
- ADR-0001 records v1 compatibility decisions: `agent_simulation` is reserved for a future versioned run contract; claim verdicts are separate from finding lifecycle; mutation approval is separate from execution mode; future confidence bands do not overwrite legacy assessment confidence.
- PR #72 merged as `9ea611bcb567f233df4312f82d4b47882ef804e2`; exact-head Node.js 22/24 CI, CodeQL and full-history secret scan all passed.
- Follow-on Phase 3 work adds a seven-schema contract registry, explicit version/compatibility rules, API/persistence boundary documentation and regression tests for registry completeness, schema identity/reference integrity and documented exports.
- PR #73 added the versioned schema registry and identity/reference tests; PR #74 added the explicit migration framework. PR #74 exact-head Node.js 22/24 CI, CodeQL and full-history secret scanning passed, as did the merge commit workflows.
- Phase 3 remains IN_PROGRESS only for real cross-version consumer fixtures when a future schema version is introduced; no v2 contract currently exists to migrate.


## 2026-11-16 — Phase 3 migration framework (in progress)

- Added `ContractMigrationRegistry` with explicit version edges, exact semantic-version inputs, no implicit upgrades, ambiguous-route rejection, deep-frozen cloned inputs, JSON-only outputs, synchronous transforms and schemaVersion preservation when present.
- Added unit coverage for unregistered/ambiguous routes, duplicate edges, source/target version mismatches, non-mutation, frozen input, async transform rejection, sparse arrays and non-JSON values. Added the registry to the documented public API.
- Added migration framework reference documentation. No actual published schema has a v2 migration; the framework is infrastructure only and does not claim schema validation or deterministic/lossless migration by itself.
- PR #74 merged as `068242e01e4ab22f5247f0b584e50d56ec89cb69`; exact-head Node.js 22/24 CI, CodeQL and full-history secret scanning passed. The merge commit's CI, CodeQL and secret-scan workflows also passed.
- Phase 3 remains IN_PROGRESS only for real versioned consumer/migration fixtures when a future contract version is introduced; the migration framework itself is merged and tested.


## 2026-11-16 — Phase 5 retention evaluation (in progress)

- Added a pure retention evaluator requiring an explicit UTC evaluation time and a bounded positive retention interval.
- Evaluator rejects malformed timestamps and duplicate evidence IDs, calculates deterministic expiry instants, returns metadata-only sorted decisions and never mutates or deletes source records.
- Added regression coverage for expiry boundaries, future-dated evidence, duplicate IDs, invalid policies/timestamps, immutable results, source non-mutation and policy bounds.
- PR #75 merged as `2b64e2bd675c2bc55d41df9c457a0992fac20d61`; exact-head Node.js 22/24 CI, CodeQL and full-history secret scanning passed.
- This is eligibility evaluation only. Physical deletion, legal holds, backup expiration and storage sanitization remain separate controls. The current JSONL ledger remains plaintext, non-WORM and single-process.
- PR #75 exact-head Node.js 22/24 CI, CodeQL and full-history secret scanning passed; the merge commit workflows passed.


## 2026-11-16 — Phase 5 signed redaction manifest (in progress)

- Added a versioned JSON Schema and contract-registry entry for signed evidence redaction manifests.
- Added Ed25519 manifest creation/verification, fixed reason codes, sorted unique evidence IDs, separate requester/approver identifiers, signature/key-fingerprint checks, and fail-closed export filtering.
- The filter suppresses records from export views only. It does not rewrite the ledger, physically delete records, sanitize storage, or authenticate the human identities behind key IDs.
- PR #76 exact-head Node.js 22/24 CI, CodeQL and full-history secret scanning passed; the merge commit workflows passed.
- Phase 5 remains IN_PROGRESS because export suppression is not physical deletion and approver-key identity binding, legal holds, backup expiry and recovery controls are not yet implemented.


## 2026-11-16 — Phase 5 redaction audit journal (in progress)

- Added a strict v1.0.0 journal-entry schema that references the signed redaction-manifest schema and is registered in the contract registry.
- Added a local JSONL journal that verifies manifest signatures and the full retained hash chain on open; appends are serialized within one process, bounded, fsync'd, owner-only and reject symlink/hard-link targets and unsafe parent directories.
- The journal hash chain detects unrecomputed tampering but cannot detect a recomputed chain, valid suffix truncation or full replacement without a separately trusted checkpoint. It is not WORM or cross-process safe.
- PR #77 exact-head Node.js 22/24 CI, CodeQL and full-history secret scanning passed; the merge commit workflows passed.


## 2026-11-16 — Phase 5 redaction journal checkpoints (in progress)

- Added a strict v1.0.0 detached checkpoint schema and contract-registry entry.
- Checkpoints sign the journal entry count and prefix head hash with Ed25519; verification checks the checkpoint signature, the complete supplied journal and the anchored prefix, allowing later valid appends while detecting truncation or altered checkpointed history.
- Checkpoint signing and manifest approval support separate Ed25519 keys. Checkpoint objects are portable, but independent storage of the checkpoint and trusted public key remains an operator/custody responsibility. The createdAt value is not a trusted timestamp.
- PR #78 exact-head Node.js 22/24 CI, CodeQL and full-history secret scanning passed; merge-commit CI, CodeQL and secret scanning also passed.
- Phase 5 remains IN_PROGRESS pending physical deletion/sanitization, legal holds, backup lifecycle, identity binding and verified recovery procedures.


## 2026-11-16 — Phase 5 recovery verification gate (in progress)

- Added `verifyEvidenceRecoveryBundle` to validate the evidence-ledger chain and detached checkpoint, signed redaction journal and detached checkpoint, duplicate evidence IDs, and redaction-to-ledger references before a restored bundle is exposed.
- Added fail-closed tests for missing/invalid checkpoints, unknown redaction references, duplicate evidence identifiers and malformed input.
- This is an offline integrity gate only. It does not restore files, verify backup completeness against a remote source, sanitize storage, enforce legal holds, expire backups or authenticate human/key custody.


## 2026-11-16 — Phase 5 legal-hold precedence (in progress)

- Added a versioned Ed25519-signed legal-hold event contract with per-hold sequence numbers, fixed evidence scope, place/release transitions, monotonic timestamps and unique request IDs.
- Added a fail-closed state reducer and retention integration. Active held evidence remains in the retained set and is excluded from purge eligibility; released holds permit normal expiry evaluation.
- Added schema-registry alignment, state-transition/signature tests and documentation of key-identity, key-rotation and caller-managed journal limitations.
- This does not create a durable legal case system, authenticate actor identity, execute deletion, implement key rotation or replace data-controller/legal review.


## 2026-11-16 — Roadmap Phase 9 citation-change alert foundation (in progress)

- Added deterministic GEO baseline/current aggregate comparisons with strict matching across observation class, provider, model, region, locale, brand, target domain and sample period. Aggregates preserve up to 500 evidence IDs per cohort, total counts and truncation metadata; emitted alerts carry baseline/current references and reject reused evidence IDs.
- Added minimum sample/effect thresholds, conservative non-overlapping Wilson 95% interval screening, explicit new/missing cohort evaluations, stable deduplication keys and caller-managed cooldown suppression.
- Added raw observation citation-domain disappearance detection with evidence-record integrity/provenance verification, strict same-cohort checks and baseline/current evidence references.
- Added signed HMAC-SHA256 webhook event envelopes, timestamp tolerance, raw-body/event-ID binding, bounded delivery receipts, and Slack/Teams Workflows/PagerDuty payload builders.
- Added CLI commands `geo alerts` and `geo citation-changes`, synthetic fixtures, versioned JSON Schemas, contract registry entries, docs and CI smoke tests.
- These are deterministic local capabilities over supplied observations; no provider acquisition, consumer UI automation, scheduled sampling, durable alert state, outbound webhook delivery, retry worker or live monitoring is implemented. Stateless signature verification requires receiver-side durable event-ID replay deduplication. The Wilson interval non-overlap rule is a conservative screening heuristic, not a formal multi-comparison-corrected hypothesis test.
- Roadmap Phase 9 remains IN_PROGRESS pending citation replacement/ordering semantics, persisted baselines/events/cooldowns, opt-in encrypted destinations, durable delivery/retry queues, replay/idempotency integration tests, labelled false-positive evaluation, cadence/latency disclosures and hosted scheduling/monitoring.


### Phase 9 follow-up — evaluation, replay and latency controls

- Added a caller-labelled quality evaluator that reports TP/FP/FN/TN, precision, recall, specificity, false-positive rate and F1 across bounded cases.
- Added a synthetic positive/negative regression fixture and CI CLI smoke test. This verifies the evaluator mechanics only; representative customer/provider-labelled evaluation is still an external acceptance gate.
- Added an in-memory, bounded webhook replay guard for deterministic tests/prototypes. Production replay protection still requires a durable shared event-ID store with a unique constraint and retention beyond timestamp tolerance.
- Both aggregate and raw-observation reports now disclose observation lag and classify data as fresh/stale against an explicit age threshold.
- Delivery payload/receipt tests cover formatting and retry metadata, but actual provider delivery, durable retries, idempotent outbox processing and delivery-latency SLOs remain unimplemented.


## 2026-11-16 — Phase 9 implementation increment merged

- PR #96 merged to main as `8d6c8e106872ab29a50ebd6ff62f07715e570f51`.
- Exact-head verification passed: Node.js 22 and 24 test/package pipelines, PostgreSQL 16 tenant/auth/workspace integration, CodeQL and full-history Gitleaks.
- Implemented aggregate snapshot alerts, raw-observation citation-domain disappearance, evidence provenance checks, cohort comparability, freshness disclosure, labelled synthetic quality evaluation, in-memory replay guard, HMAC event envelopes, bounded delivery receipts and Slack/Teams/PagerDuty payload builders.
- The quality fixture is synthetic regression data only. No real-world false-positive/recall claim is made.
- Phase 9 remains IN_PROGRESS. Live provider collection, consumer-interface automation, citation appearance/replacement/order, durable alert state, persistent replay dedupe, encrypted destination management, outbound delivery, durable retry/outbox, scheduling, monitoring and customer-labelled validation remain.
- The merge does not change the overall product maturity: Searqon remains early alpha and is not production-ready.


## 2026-11-16 — Roadmap Phase 10 Agent Artifact Compiler increment

- PR #98 merged to main as `b02688382d81113970783169e4483711ab03ece6`.
- Exact-head verification passed: Node.js 22/24 tests and package validation, PostgreSQL 16 tenant/auth/workspace integration, CodeQL and full-history Gitleaks.
- Added deterministic local compilation for caller-supplied Markdown and OpenAPI 3.1/3.2 sources; source/evidence digests; passive analyzer quality findings; opt-in llms.txt; bounded deterministic diff proposals; versioned output schema and CLI.
- The compiler performs no repository/network acquisition, source-file writes, patch application, GitHub branch/PR creation, merge or publishing.
- Phase 10 remains IN_PROGRESS pending explicit repository/revision scope, statement-level source maps, richer OpenAPI/link/schema validation, prompt-injection/adversarial fixtures, disposable-worktree patch verification and a least-privilege GitHub PR adapter with human approval/no auto-merge.


## 2026-11-17 — Roadmap Phase 9 evidence integrity follow-up

- PR #99 adds bounded evidence references to aggregate rows (up to 500 IDs, total count and truncation state), baseline/current evidence links in alerts, and rejects evidence-ID reuse across snapshots.
- Adds a versioned GEO aggregate-row schema and expands aggregate alert schema and examples.
- Adds citation-change canonical observation validation and replay-guard TTL/timestamp-tolerance invariants.
- Adds/updates regression coverage for bounded evidence retention, cross-window ID reuse, missing evidence references and CLI fixtures.
- The PR's latest head has passed Node.js 22 and 24 test/package validation plus PostgreSQL 16 tenant/auth/workspace integration. CodeQL and full-history secret scanning must be verified on the synchronized final PR head before merge.
- This remains a local supplied-data capability; durable event persistence, durable replay storage, outbound delivery, live provider acquisition and representative customer-labelled quality validation remain open.
