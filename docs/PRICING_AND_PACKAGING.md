# Searqon Pricing, Packaging and Entitlements

**Status:** Commercial proposal and implementation contract; not an offer currently available for purchase.  
**Version:** 1.0.0  
**Source of truth:** `config/entitlements.v1.json`  
**Runtime evaluator:** `src/platform/entitlements.js`  
**Schema:** `schemas/entitlements.schema.json`

This document defines the proposed hosted SaaS packaging. The repository's local/open-source toolkit remains independently useful and is not paywalled. Publishing this specification does not mean the corresponding hosted capabilities are implemented, available, or approved for sale.

## 1. Commercial positioning

Searqon is an evidence-first discoverability and agent-readiness intelligence platform across four distinct disciplines:

- **SEO:** technical discovery, indexability, site structure and content signals.
- **AEO:** answer structure, entity clarity, question coverage and source-oriented content.
- **GEO:** observed brand representation, mentions, citations and changes across explicitly identified generative systems.
- **AgEO:** public documentation, API, OpenAPI and published agent-interface readiness. AgEO is Searqon's proposed discipline, not a universal industry standard.

A plan grants access and capacity across the four disciplines; customers do not buy four separate products. Usage-intensive monitoring, portfolio scale, history, collaboration, governance and integrations are the upgrade levers.

The current product is early alpha. Its existing scanner analyzes supplied documents and performs a bounded single-page remote scan. It does not yet provide live provider acquisition, full-site crawling, recurring hosted GEO collection, durable alert delivery, scheduled workers, billing or production SaaS operations. Entitlements for those capabilities are future commercial contracts and MUST remain unavailable until the relevant product and operational gates have passed.

## 2. Subscription prices

All prices are USD. Monthly prices are billed monthly. Annual prices are paid upfront and apply a 15% discount to twelve months of monthly list price, rounded to the nearest whole dollar.

| Plan | Monthly | Annual prepaid | Effective monthly | Primary buyer |
|---|---:|---:|---:|---|
| Free | $0 | $0 | $0 | Individual developer or evaluator |
| Starter | $79 | $806 | $67.17 | Individual site owner / consultant |
| Growth | $199 | $2,030 | $169.17 | Growing business / in-house team |
| Agency | $499 | $5,090 | $424.17 | Agency / multi-client operator |
| Business | $999 | $10,190 | $849.17 | Larger multi-brand organization |
| Enterprise | From $2,500 | Contract | Contract | Enterprise technology organization |

Enterprise is quoted and contracted. The $2,500 figure is a starting monthly contract value, not an unconditional promise of every custom entitlement. Enterprise annual pricing, discounts, capacity and service commitments require a signed order form.

Free is permanent. There is no credit card requirement and no automatic conversion to paid.

## 3. Free trial policy

A new eligible workspace may receive one 14-day Growth-oriented trial:

- No payment card required.
- No automatic conversion or charge at expiry.
- One project, one user, one locale and up to three AI engines.
- Up to 25 tracked prompts.
- **500 successful AI answer observations total for the entire trial**, not 500 per month.
- Up to 500 crawl page credits during the trial.
- Trial history is available for 14 days.
- No API access, SSO, white-label reporting, client portal or overages.
- Trial eligibility and abuse controls are enforced per workspace and verified billing identity; creating another workspace must not reset trial eligibility.

At expiry, the subscription state resolves to Free. Paid-only scheduled work is paused. Existing data is retained according to the Free retention and deletion policy; downgrade does not silently delete customer evidence. A user must explicitly purchase a paid subscription to continue paid features.

Trial answer-check usage uses a lifetime trial counter with a unique trial ID. It MUST NOT reset at a calendar-month boundary.

## 4. Exact included entitlements

The canonical numeric values and feature booleans are in `config/entitlements.v1.json`. The table below is the human-readable contract.

| Entitlement | Free | Starter | Growth | Agency | Business | Enterprise baseline |
|---|---:|---:|---:|---:|---:|---:|
| Projects / properties | 1 | 2 | 5 | 20 | 50 | 100 |
| Team members | 1 | 1 | 3 | 10 | 25 | 50 |
| Tracked prompts | 0 | 25 | 75 | 200 | 500 | 1,000 |
| Selectable AI engines | 0 | 3 | 5 | 8 | 10 | 20 |
| Locales per project | 1 | 1 | 2 | 5 | 10 | 25 |
| AI answer checks / month | 0 | 1,500 | 6,000 | 18,000 | 45,000 | 100,000 |
| Crawl pages / month | 1 manual page | 500 | 2,500 | 10,000 | 50,000 | 250,000 |
| Tracked keyword-months | 0 | 250 | 1,000 | 5,000 | 20,000 | 100,000 |
| Evidence history (days) | 30 | 90 | 365 | 730 | 1,095 | 1,095 baseline |
| Scheduled reports / month | 0 | 3 | 15 | 50 | 150 | 1,000 |
| API requests / month | 0 | 0 | 0 | 10,000 | 250,000 | 250,000 |
| Manual assessments / month | 1 | 100 | 500 | 2,000 | 10,000 | 50,000 |
| Supplied GEO observations / month | 10 | 100 | 1,000 | 5,000 | 25,000 | 100,000 |

The Enterprise column is a standard starting allocation. A signed contract may lower or raise eligible values, subject to the hard safety ceilings in the machine configuration. No entitlement is unlimited by implication.

### Feature access by plan

| Feature | Free | Starter | Growth | Agency | Business | Enterprise |
|---|---|---|---|---|---|---|
| Manual SEO/AEO/AgEO assessment | Yes | Yes | Yes | Yes | Yes | Yes |
| Supplied GEO observation analysis | Yes | Yes | Yes | Yes | Yes | Yes |
| Recurring GEO monitoring | No | Yes | Yes | Yes | Yes | Yes |
| Competitor analysis | No | No | Yes | Yes | Yes | Yes |
| Citation-change alerts | No | No | Yes | Yes | Yes | Yes |
| Advanced AgEO diagnostics | No | No | Yes | Yes | Yes | Yes |
| API access | No | No | No | Yes | Yes | Yes |
| White-label reports | No | No | No | Yes | Yes | Yes |
| Client portal | No | No | No | Yes | Yes | Yes |
| Governed remediation workflows | No | No | No | Yes | Yes | Yes |
| Audit-log export | No | No | No | No | Yes | Yes |
| SAML SSO | No | No | No | No | No | Yes |
| SCIM | No | No | No | No | No | Yes |
| Custom retention | No | No | No | No | No | Yes |
| Data residency option | No | No | No | No | No | Contracted |
| Dedicated environment | No | No | No | No | No | Contracted |

Feature flags grant eligibility, not a claim of present implementation. Each feature must additionally pass its product-release gate and operational capability check. A customer must never be shown an enabled control for a feature that is not deployed for that tenant.

## 5. Billing units and metering semantics

All metered counters are integer quantities. Usage periods are aligned to the subscription billing period, not calendar months, except trial lifetime counters. Unused monthly allowances do not roll over.

### 5.1 AI answer check

One billable check is one successfully acquired and normalized answer observation for one prompt × one engine × one locale × one scheduled run.

- A prompt checked against three engines in one locale consumes three checks.
- A retry for the same observation ID is idempotent and does not consume another check.
- Provider errors, rejected policy requests and failed acquisition attempts are not billable observations.
- A deliberately new observation or scheduled run consumes a new check.
- Consumer-interface observations and official model/API observations retain separate observation classes and must not be silently pooled.

### 5.2 Crawl page

One page credit is one distinct authorized page successfully fetched and processed within the tenant's declared crawl scope.

- A repeated page in a new scheduled crawl is a new page event.
- Transport retries for the same crawl job/page ID are idempotent.
- Robots-denied, out-of-scope, blocked, rejected or failed fetches are not billable.
- Redirect destinations must satisfy the existing authorization and SSRF controls.
- No plan entitlement authorizes unrestricted crawling or bypassing robots policy.

### 5.3 Tracked keyword-month

One unit is one tracked keyword × locale × device target for one subscription month. Removing and re-adding the same target during the same period must not create duplicate billable units. A new locale or device target is a separate unit.

### 5.4 API request

One unit is one successful billable customer API operation. Health checks, internal service calls, rejected authentication, rate-limit responses, validation failures and idempotent duplicate deliveries are excluded. API request limits do not replace rate limiting or abuse controls.

### 5.5 Other limits

Projects, team members, prompts, engines, locales, scheduled reports, manual assessments, supplied observations and history are entitlement counters or feature constraints. They are not silently converted into billable overages. When a non-metered cap is reached, the action is blocked and the customer is shown the relevant upgrade or contract path.

## 6. Overage schedule

Overages are disabled by default for every plan. They require all of the following:

1. A workspace administrator explicitly enables overages.
2. The administrator sets a positive monthly spend cap.
3. The billing account has a valid payment method and billing authorization.
4. The requested operation is eligible for overage on that plan.
5. The projected charge fits within the remaining cap.

| Plan | AI answer check | Crawl pages | Keyword-months | API requests |
|---|---:|---:|---:|---:|
| Starter | $0.025 / check | $4 / 1,000 | $10 / 1,000 | Not available |
| Growth | $0.020 / check | $4 / 1,000 | $10 / 1,000 | Not available |
| Agency | $0.0175 / check | $4 / 1,000 | $10 / 1,000 | $1 / 10,000 |
| Business | $0.015 / check | $4 / 1,000 | $10 / 1,000 | $1 / 10,000 |
| Enterprise | Contracted | Contracted | Contracted | Contracted |

Overage prices are retail prices, not provider cost estimates. They must be reviewed against measured cost-to-serve before activation. Free and Trial have no overage rates.

Amounts are calculated in integer micro-USD (one USD = 1,000,000 micro-USD) to avoid floating-point currency errors. The evaluator quotes only newly consumed excess units, not the cumulative historical excess. The billing ledger must persist the quote, meter, quantity, plan/rate version, billing period, idempotency key, spend-cap decision and resulting charge.

The API implementation must reserve usage atomically before dispatching billable work. A read-then-write counter is not sufficient: concurrent requests could exceed the limit. Use a transaction with row locking or an atomic conditional update, a unique idempotency key, and a durable reservation/settlement state. Failed jobs release reservations or settle to zero according to the meter definition. Retries must reuse the original reservation.

### Customer notifications

- Notify at 80% and 100% of each included allowance.
- Show current usage, included allowance, projected overage and remaining spend cap.
- Pause the affected meter when the allowance is exhausted and overages are not authorized.
- Pause when the spend cap is reached.
- Do not silently raise a cap, change a plan, or activate a more expensive provider/model.
- Customer-visible controls must distinguish included usage, reserved usage, settled usage and billable overage.

## 7. Overage calculation

For a meter with an overage rate expressed per block:

`charge_micro_usd = ceil(new_excess_units × rate_micro_usd_per_block ÷ block_size)`

Only the delta between prior excess and new excess is quoted. Examples:

- Growth: 100 additional AI checks × $0.020 = $2.00.
- Agency: 1,000 additional crawl pages = $4.00.
- Agency: 10,000 additional API requests = $1.00.
- Growth: 500 additional tracked keyword-months = $5.00.

If the computed charge exceeds the remaining customer-authorized spend cap, the operation is denied. The engine fails closed if the plan, meter, rate or spend authorization is missing.

## 8. Enterprise contract overrides

Enterprise overrides are not user-editable plan settings. They require a server-verified contract record containing:

- Active contract state.
- Approving principal / internal approver identity.
- Contract ID and tenant ID.
- Valid-from and valid-until timestamps.
- Explicit limit overrides and/or feature overrides.
- Custom rates and spend commitments, if separately implemented and approved.
- Immutable audit event with before/after values and reason.

The evaluator accepts an override only for an Enterprise subscription with an active contract, a non-empty approver and a current validity window. Unknown fields, invalid values, expired contracts and non-Enterprise overrides are rejected.

Hard safety ceilings in `config/entitlements.v1.json` remain absolute guardrails for automated entitlement resolution. Raising a hard ceiling requires a reviewed configuration/code change and security/capacity approval; a tenant contract alone cannot bypass it. Dedicated deployment, data residency and SLA commitments also require operational capability checks and cannot be granted by a boolean override alone.

## 9. Subscription lifecycle and downgrade behavior

| State | Effective entitlement | Behavior |
|---|---|---|
| No subscription | Free | Free limits and features |
| Active paid | Purchased plan | Normal entitlements |
| Trialing and before expiry | Trial | Trial limits and trial lifetime usage |
| Trial expired | Free | Paid jobs paused; no auto-charge |
| Canceled | Free at effective cancellation | Paid-only jobs stop; data retained per policy |
| Past due | Free/read-only billing recovery | No new billable work or overages; allow billing recovery and data export |
| Expired | Free | Paid-only jobs stopped |

The billing provider's verified subscription state is authoritative. Browser input, webhook payloads before signature verification, model output and tenant-supplied metadata cannot grant entitlements. Webhooks must be signature-verified, idempotent and reconciled against the provider's canonical subscription state.

Downgrade does not delete projects, evidence or audit records. The UI should mark excess projects/teams as read-only until the tenant reduces usage or upgrades. Retention and legal deletion obligations remain separate from plan limits.

## 10. Cost controls and gross-margin governance

The following controls are mandatory before recurring provider collection is enabled:

- Per-tenant and per-provider monthly budgets.
- Per-job maximum cost and maximum observation count.
- Model/provider cost table with versioned rates and effective dates.
- Queue concurrency and per-tenant fairness limits.
- Bounded retries and retry budgets.
- Cache and idempotency policy.
- Hard stop when provider budget or customer spend cap is reached.
- Cost attribution to tenant, project, feature, provider, model, locale and observation.
- Alerts for anomalous spend and failed-job retry storms.
- No paid provider call when the tenant is not entitled or has no remaining authorized budget.
- No agent, scheduler or integration can expand customer spending authority.

Proposed gross-margin targets are planning assumptions, not measured performance: 80%+ for Starter, Growth, Agency and Business; 75–85% for Enterprise depending on dedicated services. Finance must calculate contribution margin from actual provider, compute, storage, delivery, support, refunds and payment-processing costs before public launch.

## 11. Backend enforcement contract

The JSON configuration is the single source of plan numbers. The JavaScript module is a deterministic policy evaluator, not a complete billing subsystem.

Every billable API/worker operation must follow this order:

1. Authenticate the principal and resolve tenant membership from trusted session/database state.
2. Load canonical subscription state and active contract overrides from the server-side persistence layer.
3. Resolve plan, feature flags, limits and effective billing period.
4. Check the feature gate and all applicable project/seat/prompt/engine/locale caps.
5. Reserve requested usage atomically with tenant ID, meter, period ID, job ID and idempotency key.
6. Evaluate customer spend cap and provider budget before external work begins.
7. Dispatch only after successful reservation and authorization.
8. Settle actual billable usage; release unused reservation on failure.
9. Emit append-only audit and billing-ledger events.
10. Trigger 80%/100% notifications and pause at hard limits.

Do not rely on frontend hiding, API gateway rate limits alone, or a non-transactional in-memory counter. The database must enforce tenant isolation and unique idempotency constraints. All money values must be integer micro-USD or integer minor units with explicit currency; never use floating-point arithmetic for charge settlement.

The current `src/platform/entitlements.js` exposes pure helpers for resolving configured entitlements, feature checks, usage authorization, overage quotes and trial transitions. It does not yet persist usage, reserve quota transactionally, integrate a payment provider, process webhooks, create invoices or enforce entitlements across every API/worker route. Those integrations are separate implementation work and must not be described as complete.

## 12. Release gates

A plan or feature can be activated commercially only when all applicable gates are met:

- The feature is implemented and tenant-scoped.
- API and worker enforcement both use the same entitlement contract.
- Concurrency, idempotency, period rollover and downgrade tests pass.
- Usage reservations and settlements are durable and auditable.
- Spend caps are enforced before provider dispatch.
- Payment webhook signatures and replay protection are verified.
- Data retention, export and deletion behavior are tested.
- Provider terms, privacy and legal requirements are reviewed.
- Cost-to-serve and gross margin are measured using representative pilots.
- Support, incident response, backup and recovery are operational.

A green CI workflow is necessary but is not, by itself, commercial launch approval.

## 13. Configuration change control

- Update plan prices, limits, features and rates in `config/entitlements.v1.json`.
- Keep the JSON Schema synchronized.
- Add or update tests for every changed entitlement, billing transition and overage.
- Record a config version and effective date in billing/usage ledger events.
- Never retroactively reprice settled usage.
- Price increases apply only at renewal after customer notice and any required consent.
- Preserve prior config versions for invoice reconstruction and dispute resolution.

## 14. Open decisions before commercial activation

These items require validation or a separate product decision; they must not be inferred by the runtime:

- Payment provider, tax treatment, refunds and invoicing jurisdictions.
- Trial eligibility policy and abuse signals.
- Supported AI engines, provider terms and real cost per observation.
- Whether overages are settled immediately, daily or at invoice close.
- Annual Enterprise discount and custom contract minimums.
- Exact API rate-limit policy independent of monthly quota.
- Final retention, deletion and data-residency commitments.
- Customer support response targets and SLA availability.

Until those decisions and implementation gates are closed, this document and the machine configuration are a proposed pricing contract for engineering and customer validation—not a public commercial commitment.
