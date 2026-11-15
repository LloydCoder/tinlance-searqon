# Contributing to Searqon

Thank you for considering a contribution. Searqon is early alpha, so interfaces and assessment rules may evolve. Security boundaries, evidence provenance and honest capability reporting are non-negotiable.

## Before opening an issue

1. Read the [Product Charter](docs/PRODUCT_CHARTER.md), [Architecture](docs/ARCHITECTURE.md), [Scanner Contract](docs/SCANNER.md) and [Security Policy](SECURITY.md).
2. Search existing issues and pull requests before proposing duplicate work.
3. Keep proposals within Searqon's discoverability and agent-readiness scope.
4. Do not describe planned functionality as implemented or imply that partial heuristics are standards certification.

## Development setup

Requirements: Node.js 22 or later and npm.

```bash
git clone https://github.com/LloydCoder/tinlance-searqon.git
cd tinlance-searqon
npm ci
npm test
```

There are currently no runtime package dependencies. The lockfile is committed for reproducible npm workflows.

## Contribution workflow

1. Fork the repository.
2. Create a focused branch from `main`, for example `feat/clearer-openapi-findings` or `fix/redirect-policy-regression`.
3. Make the smallest coherent change.
4. Add or update tests for behavior changes.
5. Run the checks below.
6. Update the relevant documentation, schemas and changelog.
7. Open a pull request using the repository template and explain the behavior, evidence and limitations.

```bash
git switch -c feat/short-description
npm test
git diff --check
```

## Quality requirements

- Use the existing JavaScript ES module style and Node.js built-in APIs unless a dependency is justified.
- Keep domain logic deterministic and testable.
- Preserve separate SEO, AEO, GEO and AgEO assessments; do not introduce an unexplained composite score.
- Distinguish observed facts, derived metrics, estimates and model-generated interpretations.
- Keep fixtures synthetic or appropriately anonymized. Never commit customer data, credentials or private URLs.
- Use bounded inputs, explicit error handling and safe output encoding.
- Preserve evidence identifiers, schema compatibility and methodology-version semantics.
- Document breaking changes and update the relevant JSON Schema and tests.
- Do not add paid provider or cloud dependencies without documenting cost, alternatives and required approval.
- Verify upstream licenses and retain attribution notices when adapting third-party code.

## Required checks

```bash
npm test
npm audit --audit-level=high
npm pack --dry-run
```

The CI workflow additionally checks source syntax, documented CLI examples, GitHub Actions syntax, SBOM generation and the Node.js 22/24 matrix. CodeQL and full-history secret scanning run in separate workflows.

## Commit messages

Use Conventional Commits where practical:

- `feat:` new behavior
- `fix:` bug fix
- `docs:` documentation only
- `test:` tests
- `refactor:` behavior-preserving code changes
- `ci:` workflow changes
- `security:` security hardening

Keep commits focused and imperative. A repository-wide release or breaking change should be called out explicitly.

## Security-sensitive changes

Changes involving URL acquisition, DNS resolution, redirects, robots policy, browser isolation, authentication, authorization, tenant boundaries, evidence retention or provider execution must include:

- An updated threat model or security rationale.
- Dedicated positive and negative regression tests.
- Explicit scope, trust-boundary and failure-mode documentation.
- Evidence that the change does not weaken an existing security invariant.

Do not disclose exploitable vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## Pull request expectations

A pull request should state:

- The problem and intended outcome.
- The implementation and any alternatives considered.
- Tests run and their results.
- Security, privacy and evidence-integrity implications.
- Operational or provider-cost implications.
- Documentation, schema and changelog updates.
- Known limitations and follow-up work.

Maintainers may request changes, defer work pending validation, or close proposals outside the current product scope.
