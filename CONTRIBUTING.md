# Contributing

Thanks for helping improve Searqon. The project is pre-alpha; interfaces and methodology may change, but security and evidence integrity are non-negotiable.

## Before contributing

- Read [the product charter](docs/PRODUCT_CHARTER.md), [architecture](docs/ARCHITECTURE.md), and [security policy](SECURITY.md).
- Keep changes within Searqon's discoverability and agent-readiness domain.
- Do not add paid provider or cloud dependencies without documenting the cost, fallback, and approval requirement.
- Do not copy code or assets from upstream projects without verifying license compatibility and preserving required notices.

## Development

- Node.js 22+
- `npm install`
- `npm test`

Add or update tests with every behavior change. Tests should verify outcomes and security invariants, not private implementation details.

## Pull requests

A PR should explain the problem, intended behavior, security/privacy impact, evidence and tests, operational cost implications, and documentation changes. Avoid bundling unrelated changes. Mark unfinished work honestly; do not describe a proposal as implemented.

## Security-sensitive changes

Changes to URL acquisition, DNS resolution, redirects, browser isolation, authentication, authorization, tenant boundaries, evidence retention, or provider execution require a threat-model update and dedicated regression tests.
