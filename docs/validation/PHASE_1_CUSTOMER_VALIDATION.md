# Phase 1 — Customer and Commercial Validation

**Status:** IN PROGRESS — desk research and validation system prepared; primary customer evidence not yet collected.  
**Research cut-off:** 2026-11-18  
**Canonical exit gate:** 15 buyer interviews; pain ranking; 5 design partners; 3 paid-pilot commitments OR an evidence-based pivot; competitor map; procurement objections.  
**Evidence rule:** No interview, customer, design partner, pilot, quote, budget, conversion or outcome is counted until a verifiable first-party record exists.

## 1. Decision this phase must resolve

Determine whether a sufficiently urgent, repeatable and budgeted buyer problem exists for Searqon, identify the narrowest viable initial customer segment, and establish whether customers will commit to a paid pilot.

This phase is not a feature wishlist exercise. The goal is to discover:

1. Who owns the problem and budget?
2. What event or business consequence makes the problem urgent?
3. How is the problem solved today, and what does that cost in money, staff time or missed opportunity?
4. Which parts of Searqon's proposed workflow are valuable enough to replace or augment an existing process?
5. What proof, integrations, security controls and procurement evidence are required?
6. What is the smallest paid engagement that produces a measurable customer outcome?

## 2. External market evidence reviewed

### 2.1 Buyer behavior

G2's April 2026 *Answer Economy* research reports a survey of more than 1,000 B2B software buyers and decision-makers across North America, EMEA and APAC. Its published findings include:

- 51% said they start software research with an AI chatbot more often than with Google.
- 71% said they rely on AI chatbots somewhere in their software research.
- 69% said AI chatbot guidance led them to choose a different vendor than initially planned.
- 33% said they purchased from a vendor they had not previously heard of before AI surfaced it.

**Interpretation:** AI-assisted discovery is a credible buyer-behavior hypothesis worth testing with Searqon's intended customers. The survey is self-reported and published by a software-review marketplace. It does not prove that every category, company size or geography has the same behavior; it does not prove that a visibility tool purchase follows from the behavior; and it does not establish causal revenue impact for Searqon.

Source: [G2 — The Answer Economy: How AI Search Is Rewiring B2B Software Buying](https://learn.g2.com/g2-2026-ai-search-insight-report), published April 2026.

### 2.2 Google search changes the product opportunity

Google's official Search Central guidance says its generative search features use core Search ranking and quality systems, and that foundational SEO practices remain relevant. Google explicitly says there is no special llms.txt file, special markup or required content chunking that improves visibility in Google Search generative features. It recommends useful, original, people-first content and technical accessibility.

Google also introduced a Search Console Generative AI performance report for AI Overviews and AI Mode, with impressions, pages, countries, devices and time-based views. Google stated that the report had rolled out worldwide by 31 August 2026.

**Interpretation:** Searqon must not sell unsupported "GEO hacks", llms.txt ranking claims or invented Google metrics. Google Search Console is a first-party source for Google's own AI-search impressions. A third-party product can add value through cross-surface measurement, evidence interpretation, technical diagnosis, workflow, competitor/citation analysis where permitted, and verification — but it must clearly separate first-party Search Console data from third-party observations and estimates.

Sources:
- [Google Search Central — Optimizing your website for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), updated 10 July 2026.
- [Google Search Central — Search Generative AI performance reports](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports), 3 June 2026; global rollout noted 31 August 2026.
- [Google Search Console Help — Generative AI performance report](https://support.google.com/webmasters/answer/16984139).

### 2.3 Competitive landscape

Prices and feature descriptions below are snapshots of vendor-published pages reviewed on 18 November 2026. They are not independent product-quality tests, and vendors can change packaging, limits, coverage and pricing. Confirm the current commercial offer directly before using it in a customer proposal.

| Competitor | Position and documented capability | Public pricing snapshot | Strategic implication for Searqon |
|---|---|---|---|
| Semrush AI Visibility Toolkit | AI mentions and competitor/prompt research; 25 custom prompts; ChatGPT, Google AI, Gemini and Perplexity; AI-readiness site audit; daily/weekly/monthly updates. | $99/month per domain, billed annually. | Competes on brand visibility plus existing SEO suite distribution. Searqon cannot win by offering another prompt counter or generic site audit. |
| Ahrefs Brand Radar | AI visibility index over a large prompt corpus; custom prompt tracking; mentions, citations, impressions and AI share of voice; multiple AI platforms. | AI Visibility Index from $199/month; custom prompt packages from $50/month for 2,500 checks, with usage-based overage. | Strong data/discovery incumbent. Searqon needs source-level evidence, engineering remediation and verified change workflows, not a larger vanity index. |
| Otterly.AI | Prompt tracking, brand visibility/sentiment, citation sources, GEO audits, recommendations and reports; API/MCP and agent analytics on higher tiers. | $29/month for 15 prompts; $189 for 100; $489 for 400; enterprise from $1,000. | Low-cost category entry makes generic AI-visibility tracking price-competitive. |
| Peec AI | AI search analytics across selected models; visibility, position, sentiment, share of voice, source analytics, crawl insights, AI referrals, reporting and fact-checking against customer-defined facts. | $95/month for 50 prompts; $245 for 150; $495 for 350; enterprise custom. | Already overlaps with brand truth and source analytics. Searqon's defensible distinction must be validated in actual workflow outcomes, not assumed from feature lists. |
| Scrunch | AI visibility monitoring, prompt/citation analysis, page audits, agent-traffic monitoring and recommendations. Its Agent Experience Platform (AXP) can serve an AI-oriented content representation to detected agents through a CDN layer. | Public pages show entry pricing around $250/month; plan names and included prompt limits differ between Scrunch pricing pages, so confirm before quoting. | Direct overlap with agent experience and optimization. Searqon should not claim to be the first agent-readiness product. Test whether customers need independent, evidence-linked assessment and remediation verification rather than agent-specific content transformation. |
| Elmo | MIT-licensed, self-hostable AEO/GEO platform; prompt tracking, AI answer/citation analysis, query fan-out, opportunities, reports, REST API, SDKs and MCP. | Repository describes Elmo Cloud from $29/month; self-hosting is available. | Direct open-source competitor and close architectural analogue. Differentiation cannot be "open source", self-hosted, API/MCP or auditable metrics alone. |
| OpenSEO (openseo.gg) | Open-source/hosted SEO suite with rank tracking, Search Console, site audit, AI visibility, local rank tracking, REST API and MCP. Its public page currently describes hosted access as free while search data is metered. | Public page says $0 hosted access at the time reviewed; usage and future limits may change. | Overlaps strongly with broad SEO + AI visibility and agent-facing tools. |
| OpenSEO (openseo.so) | Separate domain's documentation describes SEO research, site audits, AI visibility, prompt research and MCP/agent workflows. | Documentation describes hosted plans at $10/$30/$100 with included credits. | Domain/product identity must be resolved before combining this with openseo.gg; treat them as separate competitive records until ownership and product continuity are verified. |

Primary vendor sources:
- [Semrush AI Visibility pricing](https://www.semrush.com/pricing/ai/)
- [Ahrefs Brand Radar](https://ahrefs.com/brand-radar) and [Ahrefs custom prompt pricing](https://help.ahrefs.com/en/articles/13192745-how-to-set-up-custom-prompts-to-track-brand-visibility-in-ai-assistants)
- [OtterlyAI pricing](https://otterly.ai/pricing)
- [Peec AI pricing](https://peec.ai/pricing?currency=USD)
- [Scrunch pricing](https://origin.scrunchai.com/pricing/) and [Scrunch AXP description](https://helpcenter.scrunchai.com/en/articles/13656392-agent-experience-platform-axp)
- [Elmo repository](https://github.com/elmohq/elmo) and [Elmo architecture README](https://github.com/elmohq/elmo/blob/main/README.md)
- [OpenSEO features](https://openseo.gg/features), [OpenSEO pricing](https://openseo.gg/pricing), and [OpenSEO.so AI Visibility documentation](https://openseo.so/docs/ai-visibility)

### 2.4 Competitive conclusions

1. The AI visibility tracker category is already crowded, with entry products priced from roughly $29 to $99 per month and higher tiers extending into several hundred dollars or enterprise contracts.
2. Prompt monitoring, citations, sentiment, share of voice, recommendations, audits, APIs, MCP and agent analytics are no longer unique differentiators.
3. Elmo and OpenSEO make open-source availability and self-hosting insufficient as standalone differentiation.
4. Scrunch AXP demonstrates that agent-facing content transformation is already being commercialized.
5. Peec and Otterly document fact/brand context, recommendations, crawlability or source analytics; Searqon must avoid claiming those categories are absent from competitors.
6. Google now supplies first-party AI-search impressions for its own surfaces. Searqon should complement, not misrepresent or replace, Search Console.
7. Public competitor pages establish what vendors claim to offer, not measurement accuracy, customer outcomes, retention, margins or buyer satisfaction. Those require product testing, customer interviews and independent reviews.

## 3. Searqon positioning hypotheses to test

These are hypotheses, not validated product-market-fit conclusions.

### H1 — Discoverability Engineering Workbench

The buyer does not merely need another AI visibility score. They need a repeatable workflow that connects:

- What search, answer and generative systems can observe.
- What technical, content, entity, citation or agent-readiness evidence explains the result.
- Which changes are most important and why.
- Who must approve and implement each change.
- Whether a later comparable assessment proves the issue was resolved.
- How the result can be communicated to leadership or a client.

**Disconfirming evidence:** Buyers are satisfied with existing dashboards and do not need evidence-linked remediation, verification or engineering handoff.

### H2 — Technical SEO/GEO agencies are the fastest initial route

Agencies managing multiple B2B SaaS, technology or developer-tool clients may need repeatable audits, evidence-backed recommendations, client-ready reporting and a way to prove completed work. A single agency could expose Searqon to multiple customer properties.

**Disconfirming evidence:** Agencies prefer existing bundled suites, cannot pass costs to clients, see reporting as a commodity, or will not change established delivery workflows.

### H3 — API-first SaaS, AI infrastructure and developer-tool firms have a distinct AgEO problem

These firms expose documentation, APIs, SDKs and sometimes MCP interfaces. Their marketing and engineering teams may not share a single view of how buyers discover the product or how agents consume the public technical surface.

**Disconfirming evidence:** Agent readiness is not an owned budget or urgent initiative; the problem is handled by documentation/platform teams without an external tool budget.

### H4 — Evidence provenance and verification can command payment

Customers may pay more for reproducible evidence, source traceability, explicit methodology, remediation ownership and before/after verification than for prompt tracking alone.

**Disconfirming evidence:** Customers value only broad visibility dashboards or do not trust third-party observation enough to base decisions on it.

## 4. Initial segment prioritization

Do not assume all six charter personas are equally attractive. The first 15 interviews should test three narrow segments:

| Interview cohort | Count | Target buyer/user | Problem hypothesis | Buying friction |
|---|---:|---|---|---|
| Technical SEO/GEO agencies | 6 | Founder/Managing Director, Head of SEO, Technical SEO Lead, GEO Lead | Multi-client repeatability, defensible audit evidence, client reporting, remediation tracking | Existing suite lock-in, client resale margin, white-label expectations |
| B2B SaaS / AI / DevTools companies | 6 | VP/Head of Marketing, Head of Growth, SEO/Content Lead, Developer Relations | AI discovery, technical content quality, competitor representation, measurable visibility and remediation | Split marketing/engineering ownership, attribution skepticism, budget ownership |
| API-first / agent-platform companies | 3 | CTO, VP Engineering, Head of Platform/Developer Experience | Public API/docs/MCP discoverability, agent-consumable interfaces, trustworthy readiness diagnostics | Emerging budget category, security review, unclear ownership |

A participant counts only if they are currently responsible for, influence, or approve the workflow and can describe a recent real instance. General enthusiasm, hypothetical interest, free-trial signup or a friendly conversation does not count as validated demand.

## 5. Interview protocol

**Format:** 35–45 minutes.  
**Method:** problem discovery first; no product demo until the participant has described their existing workflow.  
**Record:** date, organization, segment, role, buyer authority, exact problem statements, recent examples, current tools, cost/time, consequences, workarounds, objections, willingness-to-pay evidence and agreed next step. Obtain consent before recording. Do not collect confidential customer data or credentials.

### Core questions

1. Walk me through the last time you needed to understand why your company or a client's product was not being discovered or represented accurately in search or AI answers.
2. What triggered the work? What happened before you started investigating?
3. What did you do, step by step? Which people and tools were involved?
4. How long did it take, and what did it cost in staff time, agency spend or external services?
5. What evidence did you trust? Which measurements did you distrust or have to verify manually?
6. What was difficult about connecting a visibility result to a concrete technical/content change?
7. How did you assign the work, obtain approval and confirm that the issue was fixed?
8. What happened when you could not resolve the issue? What was the business consequence?
9. How often has this happened in the last 90 days? Who else is affected?
10. What do you currently pay for related software, services or internal work? Which budget pays?
11. Who would approve a new tool or paid diagnostic? What security, privacy, legal or procurement checks apply?
12. What would make you reject a tool even if the analysis looked useful?
13. Which existing tool or internal process would this need to replace, complement or integrate with?
14. If you had to remove one part of the current workflow, which would create the greatest value?
15. What measurable result would justify paying to solve this problem within the next quarter?

### Segment-specific probes

**Agencies**
- Number of active client properties and audits per month.
- Hours spent preparing and defending client reports.
- Whether reports are white-labelled and how they are assembled.
- Whether recommendations are tracked through client implementation.
- Whether clients have asked for GEO/AEO/agent-readiness services and whether those services are already billable.

**B2B SaaS / AI / DevTools**
- Whether AI visibility is an owned KPI, and by which team.
- How Search Console, analytics, AI referral logs and third-party trackers are reconciled.
- Whether AI-generated product descriptions, comparisons or citations have caused a real commercial issue.
- Whether technical documentation, pricing, feature facts and API references are maintained as authoritative sources.

**API-first / agent-platform**
- Whether public docs, OpenAPI, SDKs or MCP endpoints are part of acquisition or product onboarding.
- How agent/bot access is observed and distinguished from ordinary crawlers.
- Whether protocol readiness, auth clarity, data freshness or task completion is measured.
- Who owns the budget and approves external assessments.

### Interview conduct rules

- Do not ask leading questions such as "Would you use Searqon?" or "Do you think AI visibility is important?"
- Do not count compliments, survey clicks, newsletter signups or a request for a free report as buying intent.
- Ask for recent behavior and actual spend before asking about future willingness to pay.
- Do not reveal a preferred feature until the participant has described their current workflow.
- Separate facts, direct quotes, interviewer interpretation and product hypotheses.
- If recording, obtain explicit consent and document retention/deletion expectations.
- Do not store sensitive customer data in the repository. Keep interview notes access-controlled and anonymized before any product research summary is committed.

## 6. Pain ranking rubric

Score each problem from 0–5 for each dimension. Record evidence and rationale; do not assign a score from enthusiasm alone.

| Dimension | 0 | 3 | 5 |
|---|---|---|---|
| Frequency | Has not occurred | Occurs quarterly | Occurs weekly or more |
| Business impact | No meaningful consequence | Measurable wasted time or delayed work | Material revenue, pipeline, retention, client or operational consequence |
| Urgency | No planned action | On roadmap within 6 months | Active deadline, escalation or budgeted initiative |
| Current workaround cost | No meaningful cost | Repeated staff effort or tool spend | High recurring cost or specialist bottleneck |
| Budget ownership | No identified buyer | Influencer with a plausible budget path | Named budget owner and procurement route |
| Product fit | Generic interest | Some workflow overlap | Searqon addresses the described workflow end-to-end |
| Evidence access | No usable evidence | Partial access | Customer can authorize the required sources and verify outcomes |

**Interpretation:** Use the total as a triage aid, not a statistically validated score. A problem with high frequency but no budget owner is not automatically a commercial opportunity. Report cohort medians and dissenting cases, not only the highest scores.

## 7. Design-partner qualification

Target: **5 qualified design partners** selected after interviews.

A design partner must:
- Fit one of the tested segments.
- Have a named problem owner and executive/budget sponsor.
- Provide a real, scoped property or workflow with permission to assess it.
- Agree on baseline metrics and what evidence is acceptable.
- Commit a named user to a 4–6 week feedback cycle.
- Participate in at least two structured feedback sessions.
- Agree on what data may be retained, redacted or deleted.
- Understand that early Searqon is alpha and not a security certification or ranking guarantee.

A design partner is not a paid customer unless a signed paid commitment exists. A free evaluation, verbal encouragement or product waitlist entry does not count toward paid-pilot targets.

## 8. Paid-pilot qualification and test offer

Target: **3 paid-pilot commitments**, or an evidence-based pivot.

### Candidate pilot scope to test

A time-boxed Discoverability Baseline and Remediation Verification engagement:

1. Define the authorized domain, documentation, API and observation scope.
2. Capture a reproducible baseline using only approved and available sources.
3. Deliver an evidence-linked findings register across the disciplines actually assessed.
4. Prioritize a small remediation worklist with owners and acceptance criteria.
5. Support customer-controlled implementation; Searqon does not silently publish or mutate customer systems.
6. Run a comparable reassessment and produce a before/after report.
7. Review business usefulness, operational effort and willingness to continue.

Do not promise live multi-engine coverage, rankings, guaranteed citations, automatic fixes or complete agent simulation unless those capabilities have been implemented and authorized for the pilot.

### Commercial evidence required

A paid-pilot commitment counts only when all of the following are recorded:
- Named legal buyer/customer organization and authorized signatory.
- Defined paid scope, deliverables, start window and success criteria.
- Explicit price and payment terms.
- Written acceptance, signed order/contract or equivalent procurement-approved commitment.
- Security/privacy requirements and permitted data scope.
- No unresolved condition that makes the commitment merely hypothetical.

A non-binding LOI, verbal "yes", free trial, unpaid design partnership or unsigned proposal is not a paid-pilot commitment.

### Pricing discovery

Do not set final Searqon pricing from competitor list prices alone. Ask about current spend, budget owner, procurement thresholds, cost of the current workaround and the value of a successful outcome. Test three packaging hypotheses only after the pain is established:

- Single-property diagnostic and verification.
- Multi-client agency workspace and report delivery.
- Multi-team/API-first organization plan with governance and technical evidence.

Record monthly software budget separately from one-time audit/consulting budget. Do not imply a subscription price is validated until a buyer accepts a real paid offer.

## 9. Initial outreach copy

Personalize each message using a verifiable role and a specific business context. Do not imply that the recipient has a problem you have not confirmed. Do not send automatically from this document.

**Agency outreach**

Subject: Research conversation on technical SEO and AI visibility workflows

Hi {{first_name}},

I'm researching how technical SEO and GEO agencies currently audit client visibility across search and AI answer platforms, and how they turn findings into client-ready remediation and proof of improvement.

I'm speaking with a small group of agency leaders to understand the current workflow, what takes the most time, and where existing tools fall short. This is a research conversation, not a sales demo.

Would you be open to a 30-minute conversation next week?

Best,  
Searqon Research

**B2B SaaS / developer-tool outreach**

Subject: Research on discoverability across search, AI answers and technical docs

Hi {{first_name}},

I'm researching how B2B SaaS and developer-tool teams measure whether buyers and AI systems can discover, understand and accurately represent their products — including the role of technical documentation and public APIs.

I'd value 30 minutes to understand how your team handles this today, what evidence you trust, and where the workflow becomes difficult. I'm not asking you to evaluate a product demo.

Would you be open to a short research conversation?

Best,  
Searqon Research

## 10. Objection and procurement register

Capture exact objections and classify them:

- **No urgent pain:** visibility is not a current priority.
- **No budget:** problem exists but no budget owner or allocation.
- **Existing-suite coverage:** Semrush/Ahrefs/Peec/Otterly/Scrunch or internal tooling is sufficient.
- **Trust/methodology:** third-party AI sampling is not repeatable or decision-grade.
- **Attribution:** cannot connect visibility to pipeline, revenue or meaningful outcomes.
- **Implementation ownership:** findings are not actionable without engineering/content capacity.
- **Security/privacy:** source access, prompt data, customer evidence or vendor controls are insufficient.
- **Procurement:** legal, DPA, residency, SSO, security review or vendor onboarding blocks purchase.
- **Product gap:** missing integration, workflow, coverage or report format.
- **Timing:** budget cycle or strategic priority is later.

For each objection, record segment, frequency, buyer quote, severity, workaround and whether it is solvable through product, service, pricing, trust evidence or not at all.

## 11. Evidence ledger and phase acceptance

Maintain one anonymized record per interview. A record must contain:
- Stable interview ID, date, segment and role.
- Buyer authority (decision-maker, budget owner, influencer, user).
- Recent problem instance and frequency.
- Current workflow, tools and workarounds.
- Quantified time/spend/impact when supplied by the participant.
- Exact quote only with consent; otherwise paraphrase and label it.
- Pain scores with evidence for each dimension.
- Objections and procurement requirements.
- Follow-up permission and next step.
- Evidence source and reviewer.
- Data-retention/deletion status.

### Phase 1 exit checklist

- [ ] 15 completed, qualifying buyer interviews across the three cohorts.
- [ ] Interview notes are attributable, anonymized where appropriate and auditable.
- [ ] Pain ranking is based on actual examples, frequency, impact, urgency, workarounds and budget ownership.
- [ ] Competitor map is current and separates vendor claims from independent evidence.
- [ ] At least 5 qualified design partners have explicit written participation agreements.
- [ ] At least 3 paid-pilot commitments meet the evidence standard above, **or** a written pivot memo explains why the tested segment/problem/offer failed and what evidence supports the pivot.
- [ ] Procurement and security objections are categorized and prioritized.
- [ ] Product owner reviews the evidence and accepts the segment, initial wedge and commercial direction.

**Current evidence count at this research cut-off:** 0 qualifying interviews; 0 design partners; 0 paid-pilot commitments. Desk research is not counted as customer validation.

## 12. Evidence quality and unresolved questions

- Public vendor pages are first-party statements about features and prices, not independent verification of accuracy or outcomes.
- G2 survey data is self-reported buyer research; it indicates behavior, not willingness to buy Searqon.
- Google's guidance is authoritative for Google Search, not for ChatGPT, Claude, Perplexity or other systems.
- Competitor pricing can be regional, annual/monthly, dynamically rendered or inconsistent across product pages. Re-check before quoting.
- OpenSEO's openseo.gg and openseo.so domains have not been established as one company/product in this research; keep their records separate.
- No interviews have been conducted by this research process. No named customer or design partner is represented as interested.
- No TAM/SAM/SOM or revenue forecast is asserted from this qualitative evidence.

The central unresolved question is not whether AI search exists. It is whether a specific buyer has an urgent, budgeted need for evidence-backed discoverability remediation and verification that existing tools and workflows do not adequately solve.
