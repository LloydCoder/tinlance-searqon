# Passive Scanner: Current Contract

Searqon supports caller-supplied local documents and a bounded, single-page remote scan. The remote path uses the SSRF-resistant transport and robots policy checks; it does not recursively crawl links or render browser content.

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

The local analyzer performs no network I/O, link following, script execution, browser rendering, authentication, or MCP tool invocation. The separate remote scanner retrieves only the caller-selected public URL, applies robots policy at the initial URL and each redirect destination, and does not follow page links. HTML and JSON are treated as untrusted text. Local report output uses exclusive-create semantics.

## Deferred work

A full-site acquisition worker still requires real socket/TLS integration testing, explicit target authorization, crawl scope/depth/concurrency controls, isolated browser execution if required, and independent security review. Do not turn the one-page scanner into an unrestricted generic crawler.


## Machine-readable contract

The report shape is published in [`schemas/assessment-report.schema.json`](../schemas/assessment-report.schema.json) using JSON Schema 2020-12. Evidence metadata is also published independently in [`schemas/evidence-record.schema.json`](../schemas/evidence-record.schema.json), and the remote scan result envelope is published in [`schemas/remote-scan-result.schema.json`](../schemas/remote-scan-result.schema.json). The schemas fix required fields and enumerations while leaving observation-specific attributes extensible. Consumers should validate the schema version before interpreting fields.


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


## Robots policy retrieval

The internal `src/security/robots-fetch.js` module retrieves `/robots.txt` through the DNS-pinned bounded transport, allows up to five validated redirects, limits the response to 512 KiB, and applies a bounded per-origin in-memory cache. Successful responses are parsed as UTF-8. Unavailable 4xx responses (except 429) produce an empty policy; 429, 5xx, unresolved redirects, invalid UTF-8, and network failures fail closed with `Disallow: /`. Cache-Control, Expires, and Retry-After are honored within a 24-hour maximum, and the cache has a configurable bounded entry count.

This is a policy retrieval primitive, not a complete crawler. The caller must evaluate the parsed policy for each target URL and declared crawler product token. Robots policy is a coordination mechanism, not authorization or access control. The current cache is process-local and is not shared across workers or restarts.


## Single-page remote scan

The CLI supports a caller-selected public URL:

```bash
node src/cli.js scan-url https://example.com/docs --confirm-authorized-target
```

The flag is an explicit operator attestation that the target is authorized for assessment; it is not technical proof of ownership. The command retrieves robots policy first, refuses disallowed or unreachable policy, checks robots again before every redirect destination, and fetches only the selected page. It does not recursively follow page links, execute scripts, render a browser, invoke MCP tools, authenticate, or perform transactions. It accepts HTML/XHTML, Markdown, and OpenAPI JSON only, with a 2 MiB response limit. Query parameters are excluded from evidence source labels.

A robots 4xx response other than 429 is treated as unavailable under the documented RFC-aligned policy; 429, 5xx, network failures, invalid policy data, and blocked redirect destinations fail closed. This one-page scanner is not a substitute for an authorized full-site crawl or independent security assessment.
