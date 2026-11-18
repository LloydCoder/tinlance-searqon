# Phase 2 — Open-source foundation evidence

**Audit date:** 2026-11-18  
**Audited base commit:** `dd75a590ae6962bdfdb8df49c0721d3d5b379aed`  
**Package:** `@tinlance/searqon@0.2.0`  
**Declared project license:** Apache-2.0  
**Phase status:** IN_PROGRESS — release verified; repository-governance and source-provenance gates remain open

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
- The release workflow pins its actions, requires the release commit to be reachable from `main`, verifies the `release/v<version>` branch against `package.json`, creates an annotated version tag, reruns tests and audit, creates the npm tarball, generates a CycloneDX SBOM and SHA-256 checksums, and publishes GitHub Release assets. It now emits separate SLSA provenance and CycloneDX SBOM attestations.
- The repair workflow checks out the exact immutable release tag, runs the locked test/audit suite, rebuilds the package, verifies published SHA-256 checksums and compares extracted package file trees, then creates and cryptographically verifies both attestations.
- The consumer-style release verification workflow downloads the published assets, verifies SHA-256 checksums, validates the package archive and CycloneDX SBOM, and verifies both attestations with the expected repository and signer workflow.
- The npm package is not published to the npm registry; the release process publishes GitHub Release assets only.

## 3. Exact verification evidence on the audited main commit

Audited commit: `3a92895e08c9db8ad149fb51974132239ea6a025`.

| Workflow | Run ID | Event | Result |
|---|---:|---|---|
| CI — Node 22/24 and PostgreSQL tenant isolation | 44394749007 | push | success |
| CodeQL | 44394748914 | push | success |
| Full-history secret scanning | 44394748746 | push | success |
| Release attestation repair for `v0.2.0` | 44395089461 | push to `attest/v0.2.0` | success |
| Consumer-style release verification for `v0.2.0` | 44395298185 | push to `verify/v0.2.0` | success |

The release repair run checked out the exact tag, ran `npm ci`, `npm test` and `npm audit --audit-level=high`, verified the published SHA-256 manifest, compared rebuilt and published package file trees, generated separate provenance and SBOM attestations, and cryptographically verified both signer identities. The consumer verification run independently downloaded the release assets and passed checksum, archive, SBOM, provenance and SBOM-attestation checks. Current main commit `dd75a590ae6962bdfdb8df49c0721d3d5b379aed` also passed CI run `44396311618`, CodeQL run `44396311521`, full-history secret scan `44396311514`, and release verification run `44396608160`.

The external Vercel preview/deployment status has separately reported `Deployment rate limited — retry in 24 hours`. This is not one of the GitHub source CI/security workflows and is not represented as green. No quota bypass, plan upgrade, paid deployment or production deployment was attempted.

## 4. Phase 2 exit gates still open

### 4.1 Release execution

**Verified — v0.2.0**

GitHub Release `v0.2.0` was published on 2026-11-18. The release contains:

| Asset | Size | SHA-256 |
|---|---:|---|
| `tinlance-searqon-0.2.0.tgz` | 530,384 bytes | `949f91ece9f1198fc7b333ff05fd2c0dcbef87ebc42585c251bdfce0afb76088` |
| `sbom.cdx.json` | 20,649 bytes | `3db9cc8339cf8b9f56aa385acc8516a2f074aa74155d264ee5c5b6d182fb1a19` |
| `SHA256SUMS` | 173 bytes | `01650b4ffdc3af4f2727e98d9d87fa69c8be58432c0556e008286be5559c6653` |

- [GitHub Release v0.2.0](https://github.com/LloydCoder/tinlance-searqon/releases/tag/v0.2.0)
- [Release workflow run 44390539662](https://github.com/LloydCoder/tinlance-searqon/actions/runs/44390539662)
- [Attestation repair and cryptographic verification run 44395089461](https://github.com/LloydCoder/tinlance-searqon/actions/runs/44395089461)
- [Consumer-style release verification run 44395298185](https://github.com/LloydCoder/tinlance-searqon/actions/runs/44395298185)

The final repair workflow passed: exact tag checkout; package-version check; locked dependency install; full test suite; high-severity npm audit; published checksum verification; rebuilt-versus-published package file-tree comparison; SLSA provenance attestation creation; CycloneDX SBOM attestation creation; cryptographic provenance verification; and cryptographic SBOM-attestation verification. The consumer workflow independently passed checksum, archive, SBOM, provenance and SBOM-attestation verification.

The first release attempt exposed and repaired several real defects: missing Git tag author identity, a literal-escaped Bash parameter expansion, non-identical tar metadata, and release assets contaminating the package workspace. These failed runs are retained as forensic history; the final successful run is the evidence for acceptance.

### 4.2 Repository governance

The latest main-branch metadata reports `protected: false`; the repository rulesets endpoint returns an empty list. No active main-branch protection or required status checks are configured.

The connected GitHub integration can read repository rulesets (the repository rulesets endpoint currently returns an empty array) but exposes no operation to create or update them. An attempt to read the legacy branch-protection endpoint returned HTTP 403 from the installed integration. GitHub's Create a repository ruleset API requires repository `Administration: write`; that permission is not granted to this integration. The release workflow's `GITHUB_TOKEN` is not an administrative credential. This is an external repository-administration gate; it has not been bypassed or falsely marked complete. See the official [GitHub rules API permission requirements](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10#fine-grained-access-tokens-for-create-a-repository-ruleset).

Apply the configuration in [REPOSITORY_RULESET_SETUP.md](REPOSITORY_RULESET_SETUP.md): active ruleset targeting `main`; require pull requests; require the unique source checks `CI`, `CodeQL`, and `Secret scanning`; require conversation resolution; require linear history; block force pushes and deletion. Do not require the Vercel preview status while the Hobby daily deployment quota is exhausted; it is a deployment provider check, not a source CI workflow. After applying, verify the active ruleset through GitHub Settings and the repository rulesets API, then record the ruleset ID and required check contexts here.

### 4.3 Bounded source-provenance inventory

A repository-level inventory was performed against the current audited main commit `dd75a590ae6962bdfdb8df49c0721d3d5b379aed`:

- The recursive Git tree contains 349 tracked files. No `.gitmodules`, `NOTICE`, vendored/third-party directory, minified JavaScript/CSS bundle, or source-map file was found in the tree.
- The complete GitHub commit listing contains 164 commits (100 on page 1 and 64 on page 2; page 3 is empty). All 164 commits report the GitHub author login `LloydCoder`. This is repository attribution metadata, not independent proof of the natural person's authorship or of the originality of every line.
- The locked runtime dependency graph contains 14 non-root packages. Their lockfile SPDX metadata is MIT or ISC; no package has missing license metadata. The direct runtime dependency is `pg@8.23.1` (MIT). The package does not vendor these dependencies into the repository.
- The repository contains four SVG brand assets and no font binaries. The project-owner-supplied Searqon Brand Kit v1.0 Draft README identifies the kit as built by Tinlance. Its Brand Usage Guide attributes the logo to a custom drawing by Claude and states that the name/logo have not been cleared for trademark or domain use. The separate kit includes Instrument Sans and DM Mono font binaries with SIL Open Font License 1.1 texts; neither font binary is present in the repository tree. The guide is project-supplied provenance evidence, not an independent rights opinion.
- The source tree does not expose an obvious vendored code bundle, but this inventory is not a line-by-line similarity/origin review of every JavaScript, HTML, CSS, SQL, JSON and SVG file. Git author metadata and an Apache-2.0 LICENSE do not prove originality or establish rights in generated/third-party material.

**Decision:** source provenance is only partially reviewed. A signed owner declaration is still required to confirm that first-party source and included brand assets were authored, commissioned or otherwise licensed for redistribution, and to identify any copied/adapted third-party material. See [source-provenance review](PHASE_2_SOURCE_PROVENANCE_REVIEW.md) and the [owner attestation template](OWNER_SOURCE_PROVENANCE_ATTESTATION_TEMPLATE.md). Do not describe this as legal clearance.


## 5. PR and release hardening history

The following implementation increments were merged with successful Node 22/24 CI, PostgreSQL integration, CodeQL and full-history secret scanning on their exact PR heads:

| PR | Change |
|---:|---|
| #145 | Dependency license inventory, contribution guidance, historical synthetic-fixture Gitleaks allowlist, and feature-branch CodeQL/secret-scan coverage |
| #146 | Version-tag release workflow automation |
| #147 | Explicit release-branch trigger and annotated version-tag creation |
| #148 | Deterministic GitHub Actions tag author identity |
| #149 | Release asset checksum and attestation verification workflow |
| #151 | Separate SLSA provenance and CycloneDX SBOM attestations; immutable-tag repair workflow |
| #152 | Correct Bash expansion for the attestation branch tag |
| #153 | Compare extracted package contents rather than non-deterministic tar metadata |
| #154 | Keep downloaded release assets outside the npm package workspace |

PR #150 was a stale, conflicting duplicate superseded by #151 and was closed without merging.

The full-history Gitleaks scan exposed three `generic-api-key` detections in a historical, test-only Paddle checkout fixture (commit `20045e861ccde3dc25efd6c220ac4663734171fb`, file `test/paddle-checkout.integration.test.js`). Source inspection showed synthetic sandbox fixtures, not usable provider credentials. The repository uses `.gitleaks.toml` to permit only the exact historical commit **and** exact test path (`condition = "AND"`); default rules and generic API-key detection remain enabled everywhere else. Regression tests enforce the narrow allowlist.

The CodeQL and secret-scanning workflows run on pushes to `bootstrap/**`, `feat/**`, and `fix/**`, matching CI branch coverage. Static workflow tests enforce those triggers.

The Vercel preview/deployment status has been rate-limited by the current Hobby daily deployment quota. This is recorded separately from the green source CI/security workflows; no quota bypass, plan upgrade, manual deployment or production deployment was attempted.

## 6. Decision

Phase 2 remains **IN_PROGRESS**. The v0.2.0 GitHub Release, SBOM/checksum assets, SLSA provenance attestation and CycloneDX SBOM attestation have been published and independently verified. Main-branch Node 22/24 CI, PostgreSQL integration, CodeQL and full-history secret scanning are green on the audited commit. Two hard exit gates remain: active main-branch repository ruleset/required-check enforcement and a completed source-origin review backed by the owner attestation. The bounded repository inventory is evidence, not a substitute for that attestation. The Vercel preview quota failure is tracked separately and is not a source CI failure.

No paid infrastructure, provider activation, npm publication, production deployment, or bypass of failed checks is authorized by this audit.

## 7. Audit refresh policy

Re-run the dependency/license inventory and update this evidence record whenever `package.json`, `package-lock.json`, vendored source, generated assets, or release packaging rules change. A release candidate must be audited from its exact tag commit, not from a later `main` snapshot. The v0.2.0 release record now includes the package digest, SBOM digest, checksum manifest digest, separate provenance/SBOM attestation verification, and exact workflow run URLs. Repeat the same process for each release. Treat an absent, ambiguous, custom, or `SEE LICENSE IN` declaration as unresolved until the corresponding upstream license text has been inspected.
