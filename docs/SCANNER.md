# Passive Scanner: Current Contract

The first executable scanner increment intentionally accepts local files only. This eliminates network-origin SSRF exposure in the current execution path rather than claiming to solve it prematurely.

## Inputs

- HTML: `text/html`
- OpenAPI JSON: `application/json` or `application/vnd.oai.openapi+json`
- Maximum UTF-8 payload: 2 MiB
- Caller-supplied source label; it is metadata only and is never fetched.

## Outputs

Reports include a schema version, rules version, observation class, source metadata, SHA-256 content digest, deterministic evidence identifier, finding counts, observations, and findings linked to the evidence identifier.

## Rules

HTML rules detect title, meta description, H1, canonical link, JSON-LD presence, and a noindex directive. OpenAPI rules inspect document shape, server declarations, explicit security requirements, API description, and path presence.

These checks are syntactic heuristics. Absence of an OpenAPI security requirement is not proof that an endpoint is public. JSON-LD presence is not proof that markup is valid or eligible for rich results. A canonical declaration is not proof that a search engine honors it.

## Safety

The analyzer performs no network I/O, link following, script execution, browser rendering, authentication, or MCP tool invocation. HTML and JSON are treated as untrusted text. The local CLI reads only the path explicitly supplied by the caller and writes output only to a caller-supplied new path using exclusive-create semantics.

## Deferred work

A remote acquisition worker requires a separately reviewed SSRF-safe resolver/connector, redirect and retry validation, IP pinning, response bounds, isolation, and a dedicated regression suite. Do not add a generic fetch URL feature to this local analyzer.
