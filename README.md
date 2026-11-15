# Searqon

**Understand Visibility. Engineer Discoverability. Enable Agents.**

Searqon is an evidence-first open-source toolkit for AI discoverability and agent readiness across SEO, AEO, GEO, and AgEO.

## Status

**Early alpha.** Searqon analyzes caller-supplied local documents and supports a bounded, single-page remote scan of an explicitly authorized public URL. Remote scans check robots policy before acquisition and before each redirect destination. Cross-origin redirects are denied unless each destination origin is explicitly allowlisted with `--allow-redirect-origin`; same-origin redirects remain subject to URL, DNS, and robots checks. Scans do not recursively crawl links, execute browser scripts, authenticate, or invoke MCP tools. Searqon does not query search engines or LLM providers yet. It can analyze externally supplied GEO observation JSON, but it does not collect those observations itself. No hosted multi-tenant service exists. Deterministic findings are diagnostic heuristics, not ranking predictions or a security certification.

## Quick start

Requirements: Node.js 22+.

```bash
node src/cli.js scan ./examples/openapi.json
node src/cli.js scan ./examples/api-docs.md
node src/cli.js scan-url https://example.com/docs --confirm-authorized-target
# If the selected URL redirects to a separately authorized origin:
node src/cli.js scan-url https://example.com/docs --confirm-authorized-target --allow-redirect-origin https://docs.example.net
node src/cli.js geo analyze ./examples/geo-observation.json
node src/cli.js geo aggregate ./examples/geo-observations.json
```

Supported local inputs: HTML (`.html`, `.htm`), Markdown (`.md`, `.markdown`), and OpenAPI JSON (`.json`). Maximum input size: 2 MiB. The `scan-url` command retrieves only the selected public page, checks robots policy at each redirect, and requires `--confirm-authorized-target` as an operator attestation. The exported `scanPublicUrl` API independently requires `{ confirmAuthorizedTarget: true }`; CLI-only confirmation is not treated as an authorization boundary. Cross-origin redirects require `allowedRedirectOrigins` at the API boundary or repeated `--allow-redirect-origin https://approved.example` CLI options. The allowlist is an operator authorization attestation, not cryptographic proof of ownership. It does not recursively follow page links. The HTTP transport uses validated DNS pinning and bounded redirects, timeouts, headers, and response size; it is not yet a full production crawler.

The JSON report includes a content SHA-256 digest, deterministic evidence identifier, rules version, observation class, summary, observations, and evidence-linked findings. A digest is an integrity reference, not proof of immutable storage or authenticity.

## Evidence ledger (local alpha)

The `src/evidence-ledger.js` module creates sequence-numbered SHA-256 hash-linked evidence entries; `src/evidence-store.js` persists them as bounded JSONL. The local adapter serializes appends within one process, rejects a second writer in that process, syncs each append, uses owner-only file permissions, validates parent-directory ownership and write permissions on POSIX, and verifies the chain when reopening. It stores evidence metadata and digests, not the original content bytes. The local ledger is not encrypted, multi-process safe, remotely replicated, or WORM-immutable. The `src/evidence-checkpoint.js` module can create detached Ed25519 signatures over a verified ledger root using a caller-supplied private key; it does not store the key. Store the checkpoint and trusted public key separately from the ledger to detect later truncation or full-chain replacement. The checkpoint timestamp is not a trusted timestamp, and the feature does not prevent rewriting if the attacker can also replace the checkpoint or compromise the signing key. Retention, deletion/redaction, out-of-band checkpoint custody, and multi-tenant access controls are not implemented. Do not use this local alpha adapter as a regulated audit-retention system.

## Release integrity

Published GitHub Releases include a CycloneDX SBOM, SHA-256 checksums, and a GitHub artifact attestation. See [Release and Artifact Provenance](docs/RELEASING.md). The repository also runs full-history secret scanning and weekly dependency updates.

## Disciplines

- **SEO:** technical discovery and indexability signals.
- **AEO:** answer clarity and structured information.
- **GEO:** measured representation and citation across identified generative systems (provider observation adapters are not implemented yet).
- **AgEO:** machine and agent readiness (an emerging Searqon product discipline, not a universal standard).

Results remain separated by discipline; Searqon does not emit an opaque universal score.
The GEO CLI accepts supplied observation samples; it does not collect them. Use `geo analyze` for one observation and `geo aggregate` for a JSON array. Synthetic fixtures are provided under `examples/`.

## Project governance

Read [Product Charter](docs/PRODUCT_CHARTER.md), [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), and [Implementation Status](docs/EXECUTION_STATUS.md).

## License

Apache-2.0.
