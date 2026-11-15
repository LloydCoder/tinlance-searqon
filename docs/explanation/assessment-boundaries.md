# Assessment, Evidence and Measurement Boundaries

Searqon is designed to make discoverability assessments inspectable. It separates four disciplines and records the basis and limitations of each result.

## Four distinct disciplines

- **SEO:** technical discovery, crawlability, indexability and page-level signals.
- **AEO:** answer-oriented structure, clarity, question coverage and source quality.
- **GEO:** measured mentions, citations and representation in explicitly identified generative systems.
- **AgEO:** readiness of machine-facing documentation and interfaces for authorized software agents. This is a proposed Searqon discipline, not a universal standard.

A single opaque score would conceal differences in evidence and coverage. Searqon therefore reports discipline-specific status and coverage.

## Evidence versus interpretation

A useful assessment distinguishes:

1. **Observed facts:** content or metadata acquired through a declared method.
2. **Derived metrics:** deterministic calculations over identified observations.
3. **Interpretations:** rule-based explanations of what the observations may mean.
4. **Estimates:** values that depend on assumptions or incomplete samples.

Findings should carry evidence references, scope, timestamps and methodology versions. A content digest helps compare bytes; it does not prove source authenticity or immutable storage.

## Coverage is not completeness

The current scanner uses partial, versioned heuristics. Examples:

- A title-length diagnostic is not a ranking factor.
- JSON-LD presence does not prove validity or rich-result eligibility.
- An OpenAPI security declaration does not prove runtime enforcement.
- A passive MCP snapshot is not a live protocol inspection.
- A zero-finding report is not proof that no issues exist.

## GEO sampling

GEO results depend on provider, model, region, locale, prompt, observation class, time and sample design. Consumer-facing observations must not be pooled with direct model API responses as if they were equivalent. Confidence intervals do not remove sampling bias or make a small sample representative.

## Safety and authorization

Discovery is not authorization. A discovered URL, API or MCP server does not grant permission to authenticate, execute tools or perform transactions. Remote scanning requires an explicit operator attestation and applies bounded acquisition controls.

For implementation details, see the [Product Charter](../PRODUCT_CHARTER.md), [Architecture](../ARCHITECTURE.md) and [Security Policy](../../SECURITY.md).
