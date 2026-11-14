# Searqon

**Be discovered. Be understood. Be actionable.**

Searqon is an evidence-first open-source toolkit for AI discoverability and agent readiness across SEO, AEO, GEO, and AgEO.

## Status

**Early alpha.** The current executable slice analyzes caller-supplied local HTML, Markdown, and OpenAPI JSON. It does not fetch URLs, crawl websites, or query search engines or LLM providers. It can analyze externally supplied GEO observation JSON, but it does not collect those observations itself. It does not invoke MCP tools or provide hosted multi-tenant services. Its deterministic findings are diagnostic heuristics, not ranking predictions or a security certification.

## Quick start

Requirements: Node.js 22+.

```bash
node src/cli.js scan ./examples/openapi.json
node src/cli.js scan ./examples/api-docs.md
node src/cli.js geo analyze ./examples/geo-observation.json
node src/cli.js geo aggregate ./examples/geo-observations.json
```

Or run the CLI directly:

```bash
node src/cli.js scan ./examples/openapi.json
node src/cli.js scan ./examples/api-docs.md
node src/cli.js geo analyze ./examples/geo-observation.json
node src/cli.js geo aggregate ./examples/geo-observations.json\nnode src/cli.js geo analyze ./examples/geo-observation.json\nnode src/cli.js geo aggregate ./examples/geo-observations.json
```

Supported local inputs: HTML (`.html`, `.htm`), Markdown (`.md`, `.markdown`), and OpenAPI JSON (`.json`). Maximum input size: 2 MiB. The analyzer does not make network requests or follow document links.

The JSON report includes a content SHA-256 digest, deterministic evidence identifier, rules version, observation class, summary, observations, and evidence-linked findings. A digest is an integrity reference, not proof of immutable storage or authenticity.

## Disciplines

- **SEO:** technical discovery and indexability signals.
- **AEO:** answer clarity and structured information.
- **GEO:** measured representation and citation across identified generative systems (provider observation adapters are not implemented yet).
- **AgEO:** machine and agent readiness (an emerging Searqon product discipline, not a universal standard).

Results remain separated by discipline; Searqon does not emit an opaque universal score.
The GEO CLI accepts supplied observation samples; it does not collect them. Use `geo analyze` for one observation and `geo aggregate` for a JSON array. Synthetic fixtures are provided under `examples/`.


## Project governance

Read [Product Charter](docs/PRODUCT_CHARTER.md), [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), [Security](SECURITY.md), and [Contributing](CONTRIBUTING.md).

## License

Apache-2.0.
