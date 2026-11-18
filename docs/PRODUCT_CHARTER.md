# Searqon Product Charter

## Product definition

Searqon by Tinlance is an evidence-first AI discoverability and agent-readiness intelligence platform. It helps organizations understand how their digital properties are discovered, interpreted, represented, cited and safely consumed by search systems, answer systems, generative AI systems and authorized software agents.

**Positioning:** Understand Visibility. Engineer Discoverability. Enable Agents.

Searqon serves a global market. It is not limited to a geography, industry or a single search or AI provider.

## Disciplines and measurement boundaries

- **SEO — Search Engine Optimization:** technical discovery, crawlability, indexability, information architecture, page and content signals, structured data and search performance where authorized data is available.
- **AEO — Answer Engine Optimization:** answer extraction, entity clarity, question coverage, source quality, answer-oriented content structure and measurable answer-surface outcomes where observations are available.
- **GEO — Generative Engine Optimization:** measured brand/entity representation, mentions, citations, source attribution and visibility across explicitly identified generative systems and surfaces.
- **AgEO — Agent Engine Optimization / Agent Readiness:** machine and agent readiness across discovery, documentation, interface contracts, protocol interoperability, authentication clarity, authorization boundaries, operational reliability and transaction safety. AgEO is Searqon's proposed product discipline; it is not represented as a universally standardized industry discipline.

Each discipline has its own methodology, evidence, coverage, confidence and limitations. Searqon must not collapse them into an unexplained universal score or imply that partial coverage is complete measurement.

## Core operating loop

1. Declare the property, scope, objective and authorized observation method.
2. Collect bounded observations using documented, permitted methods.
3. Preserve source provenance, timestamps and methodology versions.
4. Assess observations using deterministic, versioned rules where possible.
5. Separate observed facts, supplied claims, derived metrics, estimates and heuristic interpretations.
6. Prioritize evidence-backed recommendations with impact rationale and verification criteria.
7. Apply changes only through explicit, scoped human authorization or an independently governed execution system.
8. Reassess comparable scope to verify outcomes and monitor regressions only through authorized methods.

## Intended users and buyers

- SEO, AEO and digital marketing teams responsible for discoverability outcomes.
- Technical SEO and digital agencies managing multiple customer properties.
- SaaS, API-first and developer-tool companies.
- AI infrastructure, model-serving and agent-platform teams.
- Organizations responsible for public documentation, APIs, MCP interfaces and digital brand accuracy.
- Security, platform engineering and developer-relations teams that own machine-consumable interfaces.

Buyer, user and approver roles may differ. Customer validation must determine which segments have urgent budgeted pain; this charter does not claim that willingness to pay has been proven.

## Product surfaces

- **Local/open-source toolkit:** useful without hosted credentials, paid APIs or Searqon cloud services.
- **Hosted workspace:** project management, assessment history, evidence, findings, recommendations, monitoring and reporting.
- **Integrations:** optional, versioned and permission-scoped connections to approved external sources and services.
- **Platform control plane:** privileged staff operations, separated from customer organization administration and governed by independent staff authorization.

These are product surfaces within one repository and one product boundary, not separate products or a mandatory microservice architecture.

## Ownership boundaries

- **Searqon owns:** SEO/AEO/GEO/AgEO methodologies, assessment contracts, observation interpretation, evidence links, findings, recommendations, verification, discoverability monitoring, customer workspace and Searqon platform operations.
- **Tinlyt owns:** general web discovery, retrieval, extraction and reusable evidence acquisition infrastructure. Tinlyt is an optional integration, not a Searqon runtime prerequisite.
- **TAS owns:** governed agent identity, authorization, orchestration, policy evaluation and execution. Searqon must not grant execution authority or infer authorization from model output, memory, discovered endpoints or tool descriptions.
- **FadeReach owns:** approved prospecting and sales workflows. Any Searqon integration is optional and opt-in.
- **External providers own:** their APIs, data, terms, rate limits and service availability. Provider claims and supplied metadata must be identified as such, not represented as independently verified facts.

## Security, privacy and evidence invariants

- Treat fetched content, documents, metadata, prompts, tool descriptions, model output and external connector data as untrusted data.
- Discovery does not grant permission to authenticate, invoke tools, transact, publish or mutate customer systems.
- No model, prompt, memory, message or tool output grants execution authority.
- Remote acquisition is bounded by explicit scope, authorization, DNS/redirect/IP policy, resource limits and documented terms.
- Tenant authorization is enforced at API, service, database, queue, worker and export boundaries.
- Preserve observation class, source, timestamps, methodology, confidence and limitations.
- Do not store credentials in source, logs, evidence or public reports.
- Retention, redaction, deletion, legal hold and backup handling are distinct controls; never describe logical export suppression as physical deletion.
- High-impact operations require explicit approval, auditability and rollback or recovery controls appropriate to the operation.
- Security reviews use OWASP Top 10:2025, ASVS 5.0 and relevant agentic/MCP security guidance; automated checks are not independent certification.

## Commercial model and constraints

The Apache-2.0 local toolkit must remain independently useful. A future hosted offering may charge for managed monitoring, collaboration, scale, historical intelligence, benchmarking, governance and service commitments. Pricing, conversion, gross-margin and provider-cost assumptions remain hypotheses until validated through customer interviews and paid pilots.

No new paid infrastructure, provider plan, quota upgrade or external spend is authorized by this charter. Any such spend requires explicit budget approval. Provider integrations require terms review, cost caps, data handling review and opt-in authorization.

## Non-goals and prohibited claims

- No unrestricted crawler, stealth scraping or consumer AI collection that violates access terms.
- No MCP tool execution or transaction in the passive scanner.
- No authenticated penetration testing or credential guessing as a default product behavior.
- No guarantee of search rankings, citations, recommendations, traffic, revenue or agent adoption.
- No claim that llms.txt forces model behavior, that correction manifests alter model weights or that source changes guarantee model corrections.
- No universal hallucination verdict from heuristic or registry-relative analysis.
- No claim of real-time monitoring without measured acquisition cadence and latency.
- No wholesale fork of third-party projects without license and provenance review.
- No premature microservices or wholesale frontend rewrite without measured justification.

## Governance and acceptance

The canonical delivery sequence is [the 16-phase roadmap](ROADMAP_16_PHASE.md). Phase status is evidence-based: NOT_STARTED, IN_PROGRESS, BLOCKED, IMPLEMENTED, VERIFIED or ACCEPTED. A green CI workflow is necessary for applicable code changes but is not sufficient for phase completion, production readiness or product-owner acceptance.

Architecture decisions are recorded as ADRs. Material product/security risks are tracked in [the risk register](PRODUCT_RISK_REGISTER.md); durable decisions and their evidence are recorded in [the decision log](DECISION_LOG.md). A phase may be marked ACCEPTED only after its exit criteria are verified and the designated product owner explicitly accepts the evidence.
