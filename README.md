# Searqon

**Be discovered. Be understood. Be actionable.**

Searqon is an open-source toolkit for AI discoverability and agent readiness. It is intended to assess how websites, APIs, documentation, and MCP servers can be discovered, interpreted, cited, and safely consumed by search engines, answer engines, generative AI systems, and authorized agents.

Searqon covers four related but distinct disciplines:

- **SEO** — Search Engine Optimization
- **AEO** — Answer Engine Optimization
- **GEO** — Generative Engine Optimization
- **AgEO** — Agentic Engine Optimization (an emerging product discipline, not a universally standardized industry term)

The product direction is evidence-first: baseline → observe → assess → recommend → implement → verify → monitor.

## Project status

**Pre-alpha foundation.** This repository currently contains project governance, architecture constraints, security policy, and CI guardrails. It does not yet contain a production scanner, crawler, hosted service, or completed assessment engine. A passing foundation workflow is not a production-readiness claim.

See [the product charter](docs/PRODUCT_CHARTER.md), [architecture](docs/ARCHITECTURE.md), [security policy](SECURITY.md), and [delivery roadmap](docs/ROADMAP.md).

## Design principles

1. Evidence before conclusions. Every material finding must be traceable to a source, observation method, timestamp, and methodology version.
2. Distinct assessments. SEO, AEO, GEO, and AgEO remain separately explainable; no opaque universal score.
3. Safe by default. Public scanning is passive, bounded, and isolated. Discovery never grants permission to execute.
4. Provider neutrality. Core domain contracts must not depend on one model, search provider, cloud, or commercial API.
5. Open-core integrity. The public toolkit must remain independently useful; hosted convenience and scale may be commercial.
6. Explicit boundaries. Searqon owns discoverability intelligence; Tinlyt owns general web acquisition/evidence infrastructure; TAS owns governed agent authorization and execution.

## Development

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm test
```

No cloud account or paid provider is required to run the repository's current checks.

## Security

Do not submit secrets, customer data, or sensitive target information in public issues. See [SECURITY.md](SECURITY.md) for responsible disclosure and the planned security baseline.

## License

Apache-2.0. See [LICENSE](LICENSE).
