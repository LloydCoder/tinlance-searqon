# Phase 2 — Open-source foundation evidence

**Audit date:** 2026-11-18  
**Audited base commit:** `c211c8dd8a4d387780a0e954651595d4f4d0aac9`  
**Package:** `@tinlance/searqon@0.2.0`  
**Declared project license:** Apache-2.0  
**Phase status:** IN_PROGRESS — release and repository-governance gates remain open

## 1. Repository and package facts

The audited `main` tree is a public GitHub repository. `package.json` declares Apache-2.0 and Node.js >=22. The lockfile is version 3 and pins the direct PostgreSQL driver and its transitive dependency graph. The core scanner CLI uses Node.js built-ins; the hosted web/API and worker components use the pinned `pg` dependency.

The following inventory is derived from the committed `package-lock.json` at the audited commit. It records the npm lockfile's SPDX license metadata; it is not a legal opinion or a substitute for verifying the exact distributed package archives and their license texts.

| Package | Locked version | Lockfile license | Relationship |
|---|---:|---|---|
| pg | 8.23.1 | MIT | Direct |
| pg-cloudflare | 1.4.1 | MIT | Optional transitive |
| pg-connection-string | 2.14.1 | MIT | Transitive |
| pg-int8 | 1.0.1 | ISC | Transitive |
| pg-pool | 3.14.0 | MIT | Transitive |
| pg-protocol | 1.16.1 | MIT | Transitive |
| pg-types | 2.2.0 | MIT | Transitive |
| pgpass | 1.0.5 | MIT | Transitive |
| postgres-array | 2.0.0 | MIT | Transitive |
| postgres-bytea | 1.0.1 | MIT | Transitive |
| postgres-date | 1.0.7 | MIT | Transitive |
| postgres-interval | 1.2.0 | MIT | Transitive |
| split2 | 4.2.0 | ISC | Transitive |
| xtend | 4.0.2 | MIT | Transitive |

No license metadata was missing from the 14 non-root package entries in the audited lockfile. The observed dependency license set is MIT and ISC. Re-run the inventory whenever the lockfile changes; do not infer license compatibility from package names alone.

## 2. Existing supply-chain controls verified in source

- Node.js 22 and 24 CI, full test suite, CLI smoke tests, package dry-run, npm audit at high severity, and CycloneDX SBOM generation are defined in `.github/workflows/ci.yml`.
- CodeQL uses a pinned action revision and scans JavaScript/TypeScript.
- Full-history Gitleaks scans use a checksum-verified pinned binary and a complete Git history checkout.
- Dependabot is configured for weekly npm and GitHub Actions updates.
- The release workflow pins its actions, requires the release commit to be reachable from `main`, checks the release tag against `package.json`, reruns tests and audit, creates an npm tarball, generates a CycloneDX SBOM and SHA-256 checksums, attaches the assets to GitHub Releases, and requests GitHub artifact attestations.
- The npm package is not published to the npm registry; the documented release process publishes GitHub Release assets only.

## 3. Exact verification evidence on the audited main commit

Audited commit: `c211c8dd8a4d387780a0e954651595d4f4d0aac9`.

| Workflow | Run ID | Result |
|---|---:|---|
| CI (post-merge push) | 44359374147 | success |
| CI (additional push run) | 44359328226 | success |
| CodeQL | 44359328388 | success |
| Full-history secret scanning | 44359328153 | success |

The external Vercel commit status was **failure**, with the provider message “Deployment rate limited — retry in 24 hours.” This is a preview/deployment quota failure, not a failed source test. It remains a non-green status and must not be represented as a fully green aggregate commit status.

## 4. Phase 2 exit gates still open

### 4.1 Release execution

At audit time, the GitHub Releases endpoint returned an empty list and the repository's tag references returned an empty list. Therefore no versioned release, release tarball, SBOM/checksum assets, or GitHub artifact attestation has been executed and verified. The release workflow exists, but its existence is not release evidence.

A maintainer must create and publish a release whose tag exactly matches the package version, then verify the uploaded checksums and attestation against the expected repository/workflow identity. Do not fabricate a tag, release, or attestation.

### 4.2 Repository governance

The main branch API reported `protected: false`, `protection.enabled: false`, and no required status checks. The repository rulesets endpoint returned an empty list. Branch protection/ruleset details could not be read through the connected GitHub integration because that endpoint returned 403; the branch metadata and empty rulesets response independently establish that no active protection was reported at this audit point.

Configure and verify a main-branch ruleset requiring pull requests and the appropriate unique checks (CI, CodeQL and secret scanning), blocking force pushes and branch deletion, and requiring conversation resolution. Confirm the actual check names from successful runs before making them required. The current GitHub connection exposes read-only ruleset access and cannot create/update repository rulesets; this administrative step remains external.

### 4.3 Provenance and license review

The dependency metadata inventory is complete for the locked graph, but a full source-level provenance review of every first-party file, historical contribution, generated asset, and any adapted third-party material has not been evidenced. No blanket claim of legal clearance is made. Keep the upstream attribution/license terms for any future vendored or adapted material and add a third-party notice when the distributed work includes attribution notices that require preservation.

## 5. PR #145 follow-up verification

**Audited PR head:** `b5eb0b7440e9595168b4c1a7e7ae31be2a6d4aeb`.

| Workflow | Run ID | Event | Result |
|---|---:|---|---|
| CI — Node 22, Node 24, PostgreSQL integration, package/SBOM validation | 44384769348 | pull_request | success |
| CodeQL | 44384769353 | pull_request | success |
| Full-history secret scanning | 44384769508 | pull_request | success |
| CodeQL | 44384747729 | push | success |
| Full-history secret scanning | 44384747654 | push | success |

A full-history scan exposed three `generic-api-key` detections in a historical, test-only Paddle checkout fixture (commit `20045e861ccde3dc25efd6c220ac4663734171fb`, file `test/paddle-checkout.integration.test.js`). Source inspection showed the values are synthetic sandbox test fixtures, not usable provider credentials. The repository now contains `.gitleaks.toml`, which extends the default Gitleaks rules and permits only the exact historical commit **and** exact test path (`condition = "AND"`). The generic API-key rule remains enabled everywhere else. A regression test asserts the narrow allowlist and prevents disabling that rule. The full-history push and PR scans passed on the audited PR head.

The CodeQL and secret-scanning workflows were also extended to run on pushes to `bootstrap/**`, `feat/**`, and `fix/**`, matching the CI branch coverage. Static workflow tests enforce these triggers.

The PR's Vercel status remains **failure** with the provider message `Deployment rate limited — retry in 24 hours.` The separate Vercel Preview Comments check is successful, but it does not override the failed Vercel deployment status. No quota bypass, plan upgrade, or manual deployment was attempted.

## 6. Decision

Phase 2 remains **IN_PROGRESS**. Existing source CI, CodeQL and secret-scan workflows are green on the audited commit, but the aggregate commit status is not green because of the Vercel rate limit; no release/tag/attestation exists; and repository branch protections/rulesets are absent. These are hard exit gates, not documentation-only caveats.

No paid infrastructure, provider activation, npm publication, production deployment, or bypass of failed checks is authorized by this audit.

## 7. Audit refresh policy

Re-run the dependency/license inventory and update this evidence record whenever `package.json`, `package-lock.json`, vendored source, generated assets, or release packaging rules change. A release candidate must be audited from its exact tag commit, not from a later `main` snapshot. Record the archive digest, SBOM digest, attestation verification result, workflow run URL, and verifier identity in the release record. Treat an absent, ambiguous, custom, or `SEE LICENSE IN` declaration as unresolved until the corresponding upstream license text has been inspected.
