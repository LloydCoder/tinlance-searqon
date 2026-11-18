# Release and Artifact Provenance

Searqon releases are created from reviewed, versioned source on `main`. The release pipeline is separate from pull-request CI and does not publish to the npm registry.

## Standard release procedure

1. Merge the release candidate to `main`; confirm Node 22/24 CI, PostgreSQL integration, CodeQL and full-history secret scanning are green on the exact main commit.
2. Update `package.json` and `package-lock.json` versions together and merge the version change.
3. Create a branch named exactly `release/v<package-version>` from the reviewed main commit (for example, `release/v0.2.1`). The release workflow validates the branch/version match and that the release commit is reachable from `main`.
4. The workflow creates an annotated `v<package-version>` tag, reruns tests and `npm audit --audit-level=high`, creates the npm tarball, generates a CycloneDX SBOM and SHA-256 manifest, and publishes the GitHub Release assets.
5. The workflow emits two separate attestations for the package: SLSA build provenance and a CycloneDX SBOM attestation.
6. Create a branch named `verify/v<package-version>` from current `main`. The read-only release verification workflow downloads the published assets, verifies checksums, validates the archive and SBOM, and cryptographically verifies both attestations. It accepts only the repository's approved `release-provenance.yml` or `release-attestation-repair.yml` signer workflows.

Do not manually move an existing version tag. A tag must remain bound to its exact release source commit.

## Repairing attestations for an existing release

Use the `attest/v<package-version>` branch only when a published release is missing one or more attestations.

The repair workflow checks out the exact immutable tag, verifies the package version, runs `npm ci`, tests and high-severity audit, downloads the published assets into runner temporary storage, validates their SHA-256 manifest, rebuilds the package and compares extracted package file trees. It then creates separate SLSA provenance and CycloneDX SBOM attestations and verifies both cryptographically. It does not modify release assets or publish to npm.

## v0.2.0 verification record

- [GitHub Release v0.2.0](https://github.com/LloydCoder/tinlance-searqon/releases/tag/v0.2.0)
- [Release build run 44390539662](https://github.com/LloydCoder/tinlance-searqon/actions/runs/44390539662)
- [Exact-tag attestation repair and cryptographic verification run 44395089461](https://github.com/LloydCoder/tinlance-searqon/actions/runs/44395089461)
- [Consumer-style checksum and attestation verification run 44395298185](https://github.com/LloydCoder/tinlance-searqon/actions/runs/44395298185)

Published asset SHA-256 digests:

| Asset | SHA-256 |
|---|---|
| `tinlance-searqon-0.2.0.tgz` | `949f91ece9f1198fc7b333ff05fd2c0dcbef87ebc42585c251bdfce0afb76088` |
| `sbom.cdx.json` | `3db9cc8339cf8b9f56aa385acc8516a2f074aa74155d264ee5c5b6d182fb1a19` |
| `SHA256SUMS` | `01650b4ffdc3af4f2727e98d9d87fa69c8be58432c0556e008286be5559c6653` |

## Consumer verification commands

After downloading the package, SBOM and checksum manifest from the GitHub Release:

```bash
sha256sum --check SHA256SUMS
gh attestation verify tinlance-searqon-0.2.0.tgz \
  -R LloydCoder/tinlance-searqon \
  --signer-workflow LloydCoder/tinlance-searqon/.github/workflows/release-provenance.yml
```

For an attestation produced by the repair workflow, replace the signer workflow path with `.github/workflows/release-attestation-repair.yml`. To verify the SBOM predicate, add:

```bash
--predicate-type https://cyclonedx.org/bom
```

The SBOM is generated from the locked npm dependency graph. It is a build-time inventory, not a guarantee that every transitive dependency is free of vulnerabilities.

## Scope and limitations

- GitHub Releases are the distribution channel; npm registry publication is not enabled.
- Attestations use GitHub Actions OIDC and Sigstore. They are not a developer's personal code-signing signature.
- Verify the artifact digest, repository identity and approved workflow signer before consuming a release.
- Branch protection and required status checks remain repository-administration controls and must be verified separately.
- A successful release does not establish production readiness, legal clearance, customer validation or product-owner acceptance.
