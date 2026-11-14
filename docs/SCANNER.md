# Passive Scanner: Current Contract

The first executable scanner increment intentionally accepts local files only. This avoids network-origin SSRF exposure in the current execution path.

## Inputs

- HTML: \`text/html\`
- OpenAPI JSON: \`application/json\` or \`application/vnd.oai.openapi+json\`
- Maximum UTF-8 payload: 2 MiB
- Caller-supplied source label; it is metadata only and is never fetched.

## Evidence and outputs

Each report contains a versioned evidence record with source, acquisition method, observation class, UTC collection timestamp, content type, byte length, SHA-256 digest, methodology version, and an integrity descriptor. The content itself is not copied into the evidence record.

The evidence identifier is deterministic for the same source, acquisition method, and content digest. The collection timestamp is not part of the identifier. A digest supports content-integrity comparison; it does not prove authenticity, append-only storage, or immutability.

## Rules

HTML rules detect title, meta description, H1, canonical link, JSON-LD presence, and a noindex directive. Markdown rules look for headings, authentication, error-handling, rate-limit, versioning, and code-example guidance. OpenAPI rules inspect document shape, server declarations, explicit security requirements, API description, and path presence.

These checks are syntactic heuristics. Absence of an OpenAPI security requirement is not proof that an endpoint is public. JSON-LD presence is not proof that markup is valid or eligible for rich results. A canonical declaration is not proof that a search engine honors it.

## Safety

The analyzer performs no network I/O, link following, script execution, browser rendering, authentication, or MCP tool invocation. HTML and JSON are treated as untrusted text. The local CLI reads only the path explicitly supplied by the caller and writes output only to a caller-supplied new path using exclusive-create semantics.

## Deferred work

A remote acquisition worker requires a separately reviewed SSRF-safe resolver/connector, redirect and retry validation, IP pinning, response bounds, isolation, and a dedicated regression suite. Do not add a generic fetch URL feature to this local analyzer.


## Machine-readable contract

The report shape is published in [`schemas/assessment-report.schema.json`](../schemas/assessment-report.schema.json) using JSON Schema 2020-12. The schema fixes required fields and enumerations while leaving observation-specific attributes extensible. Consumers should validate the schema version before interpreting fields.


## GEO observation engine

The GEO module accepts externally supplied, authorized answer observations. It records provider name, observation class, model/region/locale metadata, sample time, normalized citation URLs, brand mention counts, and optional target-domain citation presence. The evidence digest covers the prompt, answer, citations, and provider metadata; raw prompt and answer text are not returned in the normalized record. Citation URLs are parsed but never fetched. Consumer-facing observations and direct model API observations are kept separate during aggregation. Mention and brand-citation rates include Wilson 95% confidence intervals; small samples must still be interpreted cautiously. No provider connector, consumer-interface scraper, scheduler, or paid API integration is included.


## GEO CLI

Analyze a caller-supplied GEO observation JSON file:

```bash
node src/cli.js geo analyze ./examples/geo-observation.json
```

Aggregate a JSON array of normalized GEO observations:

```bash
node src/cli.js geo aggregate ./examples/geo-observations.json
```

These commands do not call a provider or fetch citations. Both bundled GEO examples are synthetic fixture data, not live measurements. `geo aggregate` groups by provider and observation class and never pools consumer-facing and model API samples. The output contract is [`schemas/geo-observation.schema.json`](../schemas/geo-observation.schema.json).


## SSRF-safe HTTP transport foundation

The internal `src/security/fetch.js` module now provides a bounded HTTP(S) GET primitive for future acquisition workflows. It validates the URL, resolves and validates every DNS answer, pins the validated address in Node's socket lookup callback, and manually revalidates and re-resolves every redirect. It permits only standard HTTP/HTTPS ports, blocks HTTPS downgrade redirects, caps DNS resolution time, redirects, response bytes, headers, and socket inactivity, and requests identity encoding to avoid implicit decompression ambiguity.

The transport intentionally exposes no arbitrary request headers, cookies, credentials, request body, or browser execution. It is not wired to the CLI and does not constitute a general-purpose crawler. Any production integration must still add an explicit target-authorization model, crawl scope/depth/concurrency controls, robots retrieval semantics, response MIME policy, isolated browser rendering where justified, observability, and independent security review. DNS pinning and deterministic injected transport tests are necessary controls, not a complete SSRF certification.
