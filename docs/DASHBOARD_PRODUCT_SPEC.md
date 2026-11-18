# Searqon Workspace Dashboard — Product and Engineering Specification

Status: incremental implementation specification. This document describes the target experience and its delivery gates; future capabilities are not implied to be implemented.

## 1. Product outcome

The authenticated workspace should help a team answer, in one place:

1. What has Searqon actually measured for each property?
2. Which findings and recommendations deserve attention first?
3. Which work is open, accepted, in progress, dismissed, unresolved or verified?
4. What evidence supports each conclusion, and what was outside the assessment scope?
5. What changed after a fix, using a comparable later assessment?

The dashboard is an operating surface for discoverability work, not a decorative analytics wall. Its primary loop is:

**Measure → preserve evidence → prioritize → assign/approve → implement → reassess → verify → monitor for regression.**

The current product only supports the implemented subset of this loop. The UI must disclose those boundaries.

## 2. Forensic baseline (main at 2026-11-18)

Repository: `LloydCoder/tinlance-searqon`

Production baseline: `main` commit `78e1970a372be4e2cb6e0d40fd44efe6b2105636`; Vercel deployment `dpl_Bq5XKxTPxFYG4h4nsig6n7VNKwbb` was observed READY on `searqon.tinlance.com`.

Existing authenticated workspace:
- `apps/web/public/app/index.html`
- `apps/web/public/app/workspace.js`
- `apps/web/public/app/workspace.css`
- `apps/web/server.js`
- `src/platform/workspaces.js`
- `src/platform/recommendations.js`

Existing backend-supported workflows:
- Tenant-scoped workspace and project listing/creation.
- Project assessment history (up to 100 records per project).
- Persisted assessment reports and evidence IDs.
- Durable recommendations with stable finding fingerprints.
- Human status transitions and append-only recommendation events.
- Verification against a later successful assessment with matching project, tenant, content type, discipline and methodology version.
- Explicitly partial SEO/AEO/AgEO diagnostics and supplied-observation GEO analysis.

Existing gaps:
- No complete cross-project command center or full reporting workspace.
- No assignment, due-date, team ownership or approval workflow on recommendations.
- No full-site recursive crawl or browser rendering.
- No live GEO provider acquisition or recurring GEO sampling.
- Alert worker components are not deployed/configured with provider credentials.
- No live agent-journey sandbox.
- No complete organization administration or invitations.
- No claim of production launch readiness, independent penetration testing or commercial acceptance.

## 3. Dashboard principles

### 3.1 Evidence over vanity metrics
- Do not invent 0–100 SEO/AEO/GEO/AgEO scores.
- Do not convert missing or unassessed data into zero visibility.
- Distinguish `full`, `partial` and `none` coverage.
- Distinguish successful assessments from failed attempts.
- Show methodology version, assessment time, content type and evidence identity where available.
- Label derived counts as summaries of stored records, not provider measurements.
- Do not display trend charts until there are comparable time-series observations.

### 3.2 One recommendation is not one completed fix
Recommendation states are:
- `open`
- `accepted`
- `in_progress`
- `dismissed`
- `not_resolved`
- `verified`

Only the backend verification endpoint may mark a recommendation verified. A verified state means the original deterministic finding was absent from one later comparable assessment. It is not a full-page certification, ranking improvement, causal proof or guarantee of no related issues.

### 3.3 Provenance and observation class
The UI should retain distinctions among first-party/crawl evidence, supplied consumer observations, model API observations, derived results and estimates. Provider/model/locale metadata supplied by a caller is not independently verified provenance.

### 3.4 Human authority
The dashboard may organize evidence and recommendations. It must not apply patches, publish content, write to repositories, merge pull requests, execute MCP tools or perform consequential actions without a separately authorized and explicitly approved workflow. A model, prompt, stored memory or tool result never grants execution authority.

## 4. First increment: Workspace Command Center

The first increment is additive and uses existing authenticated, tenant-scoped APIs only.

### Summary metrics
- Project count in the selected workspace.
- Successful assessment count from the latest 100 returned records per project.
- Findings in each project's latest successful assessment.
- Open action count (open, accepted, in progress and not resolved).
- Verified recommendation count.

### Decision queue
- Show the highest-priority persisted recommendations.
- Display title, project, discipline, severity, lifecycle state, priority and occurrence count.
- Link back to the corresponding project workspace.
- Preserve backend priority and lifecycle rules; the UI does not create a new priority score.

### Recent assessment activity
- Include successful and failed assessment attempts.
- Show project, state, finding count where a report exists, methodology version and timestamp.
- Never present failed attempts as successful baselines.

### Measurement coverage
For each discipline (SEO, AEO, GEO and AgEO), count projects whose latest successful assessment reported:
- Full coverage.
- Partial coverage.
- No coverage / not assessed.

A project with no successful assessment contributes to `none`. The count is a coverage summary, not a score.

### Refresh and organization scope
- All data is read through same-origin authenticated APIs.
- Organization switching refreshes the summary.
- Project history/recommendation requests use bounded concurrency.
- Partial API failures are disclosed; incomplete results are never labelled complete.
- No data is written by the dashboard summary.

## 5. Future dashboard modules

These are product targets, not current implementation claims.

### A. Project intelligence
- Property inventory, target URLs, scope, ownership and last successful run.
- Page-level assessment inventory after a safe recursive crawler exists.
- Canonical, indexability, sitemap, robots, rendering and crawl diagnostics only when their acquisition evidence is available.
- Search Console connection and organic search performance after OAuth, consent, token security, quota handling and API ingestion are implemented.

### B. Findings and remediation operations
- Search, filters, saved views and bulk triage.
- Assignment, due dates, team ownership and approval records.
- Impact, implementation effort and approval friction only when explicitly scored with a documented rubric.
- Remediation plans linked to exact findings and evidence.
- Before/after content fingerprints and regression detection.
- No direct patch/publish until an isolated, reviewed and explicitly authorized implementation workflow exists.

### C. AEO and GEO intelligence
- Prompt cohort management by market, locale, topic and persona.
- Provider/surface coverage and observation freshness.
- Brand mentions, citations, citation domains, citation share and competitor comparisons only from actual permitted observations.
- Prompt-level history and answer evidence.
- Distinguish provider API observations from consumer-interface observations.
- Do not imply real-time monitoring without measured collection cadence and delivery SLOs.

### D. AgEO intelligence
- OpenAPI and passive MCP metadata diagnostics.
- Explicitly separate discoverability from authentication, authorization and execution.
- Live OAuth protected-resource discovery and isolated read-only agent simulation remain gated on the security design and sandbox.
- No MCP tool execution in the passive workspace.

### E. Evidence and audit
- Evidence detail with source, acquisition method, content digest, methodology, timestamps and chain of derivation.
- Recommendation event timeline and verification pair.
- Exportable technical and executive reports.
- Redaction/retention controls only when backed by implemented storage lifecycle controls.

### F. Monitoring and alerts
- Scheduled assessments and recurring GEO sampling after scheduler/worker deployment and provider approval.
- Alert delivery status, retries, replay protection, cooldown and destination health.
- Fresh/stale/degraded states based on actual observation age and configured policy.

## 6. Data contract and metric semantics

The UI should consume existing response contracts without inventing new server-side meanings.

- Project list: `GET /api/v1/projects?organizationId=...`
- Assessment history: `GET /api/v1/projects/{projectId}/assessments`
- Recommendation list: `GET /api/v1/projects/{projectId}/recommendations`
- Recommendation events: `GET /api/v1/recommendations/{recommendationId}/events`
- Recommendation lifecycle writes and verification remain backend-controlled.

Summary calculations:
- Latest successful assessment is selected by `completedAt`, not array position.
- Latest findings are summed from each project's latest successful report only.
- Severity totals are aggregated only when the report supplies non-negative integer counts.
- Assessment history count is bounded by the API's 100-record per-project limit and must be labelled accordingly.
- Open actions include `open`, `accepted`, `in_progress` and `not_resolved`.
- Verified actions count only persisted `verified` recommendations.
- Recommendation ordering uses the existing backend priority value; no unsupported impact/ROI score is inferred.

## 7. UX, accessibility and responsive quality

- Follow the supplied Searqon Brand Usage Guide: ivory `#F6F3EC`, ink navy `#12203A`, signal amber `#E8A33D`, slate `#4A5670`, mist `#D9D5CA` and amber-deep `#8A5200`.\n- Use Instrument Sans for interface/body and DM Mono for labels/data. Keep labels tracked uppercase.\n- Use flat color and clear borders; no gradients, shadows or glow. Signal amber is decorative on ivory, never body text; use amber-deep for readable amber text.
- Use semantic landmarks, visible focus, keyboard-operable controls and status announcements.
- Do not rely on color alone for severity or lifecycle state.
- Support narrow mobile viewports without horizontal overflow.
- Respect reduced-motion preferences.
- Maintain readable contrast and practical touch target sizes.
- Avoid unnecessary chart decoration; every visualization must answer a decision question.

Target: WCAG 2.2 AA review for the workspace. Passing automated checks alone is not a conformance claim.

## 8. Security, privacy and performance

- Same-origin API calls with credentials; no token or secret exposure to browser storage.
- Continue to rely on server-side tenant membership, role checks and RLS; hiding controls is not authorization.
- Render user-controlled assessment/finding/recommendation text using text nodes, never unsafe HTML.
- Bound concurrent project requests and disclose partial failures.
- Do not fetch target URLs from the browser as a substitute for the approved acquisition service.
- No new paid infrastructure, provider spend or dependencies for the first increment.
- Avoid polling; refresh on user action or known local workflow completion.
- Preserve existing routes and project/assessment/recommendation behavior.

## 9. Delivery sequence and gates

1. **Command Center** — cross-project summary, priority queue, recent assessment activity and discipline coverage. Gate: deterministic model tests, asset/syntax tests, Node 22/24 CI, PostgreSQL integration, CodeQL, secret scan and browser QA.
2. **Project workspace** — focused project overview, assessment detail, findings filters and evidence navigation. Gate: API-contract tests and tenant-negative tests.
3. **Recommendation operations** — assignment, due dates, review/approval and verified remediation evidence. Gate: schema/authorization decisions, append-only event tests and explicit human approval.
4. **Visibility intelligence** — Search Console and permitted GEO provider adapters, trends and competitor comparison. Gate: OAuth security, provider terms, provenance, quotas, cost caps and representative data.
5. **AgEO and agent readiness** — passive interface view first; isolated simulation only after sandbox threat model and egress isolation acceptance.
6. **Monitoring and reporting** — scheduled jobs, durable history, alerts and report exports. Gate: worker deployment, retries, delivery SLOs, retention and restore controls.
7. **Production UX assurance** — keyboard, screen reader, mobile, performance, accessibility and security review.

Each increment is a separate reviewable PR. Production deployment occurs only after final-head checks pass and the Vercel Hobby deployment quota is available. No production alias is changed by a preview deployment.

## 10. External research informing the design

- Google Search Console API provides performance and sitemap data, but query results have row limits, quota constraints and data latency; it is a future data integration, not a current dashboard source. See [Google Search Console API performance data guidance](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data) and [usage limits](https://developers.google.com/webmaster-tools/limits).
- Enterprise SEO workflows benefit from baselines, prioritized issue backlogs, implementation ownership, stakeholder reporting and reassessment. See [Semrush's enterprise SEO workflow guidance](https://www.semrush.com/blog/enterprise-seo/).
- AI visibility products increasingly expose page-level citations, prompt-level visibility, competitor comparison and historical views. Searqon should adopt the decision workflow, not copy unsupported metrics or imply those provider feeds are already available. See [Profound's page-level visibility workflow](https://www.tryprofound.com/features/pages) and [competitive benchmarking](https://www.tryprofound.com/features/answer-engine-insights/competitors).
- Accessibility requirements should be evaluated against [W3C WCAG 2.2](https://www.w3.org/TR/wcag/), including keyboard operation, contrast, focus visibility and target size.

---

This specification is a product and engineering target. A capability is only marked implemented when code, tests, evidence and the current phase register support that status.
