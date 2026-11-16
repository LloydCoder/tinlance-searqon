# Security Policy

## Project maturity and scope

Searqon is early alpha. The repository currently provides local document analysis, passive analysis of caller-supplied MCP snapshots, GEO analysis of caller-supplied observations, a bounded single-page remote scanner and standalone local HTML reports.

It does not provide a production crawler, hosted control plane, authentication system, tenant isolation, browser execution or live GEO provider collection. The controls described here are engineering requirements and current implementation notes, not a security certification.

## Supported versions

Security fixes are developed against the latest code on `main`. No long-term support branches or published release series are currently maintained. Include the affected commit or package version in reports.

## Reporting a vulnerability

**Do not publish exploitable details in public issues or pull requests.**

Preferred private route: [Report a vulnerability through GitHub Security Advisories](https://github.com/LloydCoder/tinlance-searqon/security/advisories/new). If private vulnerability reporting is unavailable in the repository settings, contact the maintainer, [@LloydCoder](https://github.com/LloydCoder), through the GitHub profile's available contact method.

Include, where possible:

- Affected commit, version and component.
- Impact and realistic attack prerequisites.
- Reproduction steps or a minimal proof of concept.
- Any known mitigations.
- Whether the report involves data you do not own or control.

Do not include real customer secrets, personal data or unauthorized third-party data. Make a good-faith effort to avoid privacy violations, service disruption and data destruction.

### Response targets

The maintainer's proposed operating targets are:

| Activity | Target |
|---|---|
| Initial acknowledgement | Within 5 business days |
| Initial triage and severity assessment | Within 10 business days |
| Remediation communication | After triage, with timing based on severity and complexity |

These are targets, not a guarantee of a fix or a public disclosure date. A reporter should avoid public disclosure until a coordinated disclosure plan has been agreed.

## Security baseline

Security reviews should consider OWASP Top 10:2025, OWASP ASVS 5.0, OWASP SSRF Prevention guidance, relevant MCP security requirements when integrations are introduced, and the NIST AI Risk Management Framework and Generative AI Profile where applicable.

## Current automated controls

The repository configures:

- GitHub Actions CI on Node.js 22 and 24.
- CodeQL analysis for JavaScript/TypeScript.
- Full-history Gitleaks scanning on pull requests, main pushes and a daily schedule.
- Checksum verification for the pinned Gitleaks and actionlint binaries.
- `npm audit --audit-level=high`.
- Weekly Dependabot updates for npm and GitHub Actions.
- CycloneDX SBOM generation, SHA-256 checksums and GitHub artifact attestations for published releases.

These controls do not replace secret rotation, manual alert triage, independent penetration testing or a formal ASVS assessment.

## Remote acquisition requirements

The remote scanner must remain bounded and must not become an unrestricted crawler without a separate design and security review.

Mandatory controls include:

1. Parse and normalize target URLs with a standards-compliant URL parser.
2. Resolve A and AAAA records and reject loopback, private, link-local, multicast, reserved and metadata destinations.
3. Handle IPv4-mapped IPv6, unusual numeric IP encodings and relevant translation mechanisms.
4. Mitigate DNS rebinding by validating the actual connection destination, not only a preflight DNS lookup.
5. Validate every redirect destination and bind connections to validated addresses where supported.
6. Require explicit authorization for cross-origin redirect destinations; authorization of the initial origin does not authorize a different origin.
7. Revalidate destinations before any future retry behavior.
8. Enforce response-byte, decompression, deadline, inactivity, DNS, redirect, concurrency, depth and content-type limits.
9. Treat robots policy as a coordination signal, not authorization to access restricted resources.
10. Record acquisition method and outcome without logging credentials or secrets.

The current one-page scanner uses validated DNS pinning, manual redirect handling, a bounded response, robots checks and an explicit operator authorization attestation. The attestation and origin allowlist are not independent proof of ownership. The scanner does not recursively crawl or render browser content.

## AI and agent boundaries

- Fetched pages, documents, metadata, tool descriptions and model responses are untrusted data.
- Prompt injection must not change permissions, policies or execution scope.
- Discovery of an API endpoint or MCP server does not grant permission to authenticate or invoke it.
- The initial scanner is passive: it does not invoke tools, perform transactions or guess credentials.
- Model output is not proof of a security property and is never an authorization decision.

## Evidence and data protection

The local evidence ledger uses sequence-numbered SHA-256 hash-linked entries and verifies the chain when reopened. Detached Ed25519 checkpoints can sign a verified ledger root using a caller-supplied private key.

The current local adapter is not encrypted, multi-process coordinated, remotely replicated or WORM-immutable. A checkpoint only provides an independent anchor when the checkpoint and trusted public key are stored separately from the ledger. Detached checkpoints are now supported for the redaction journal too, but the application/operator must store them in a separate trust domain. Their creation time is not a trusted timestamp. A deterministic retention evaluator reports expiry eligibility, and signed Ed25519 redaction manifests can suppress evidence from generated exports. A local hash-linked journal persists signed manifests and helps detect unrecomputed tampering, but cannot detect a writer who can recompute the chain, truncate a valid suffix or replace the journal without an independently trusted head checkpoint. None of these capabilities deletes or sanitizes ledger entries, filesystem snapshots or backups. Physical deletion, storage sanitization, legal holds, backup expiry, out-of-band checkpoint custody, approver-key identity binding and tenant access controls are not implemented.

Collect only data needed for the declared assessment. Keep credentials out of source control, logs, fixtures and evidence records. Any future hosted service must define retention, deletion, export, redaction, encryption and tenant isolation before accepting customer data.

## Release requirements

A release should have reviewed dependencies and licenses, passing tests, secret scanning, static analysis, dependency vulnerability checks, an SBOM, provenance/attestation where supported, security-boundary regression tests and a documented rollback path.

A passing workflow is necessary but does not establish production readiness.

## External references

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [IANA IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry)
- [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry)
- [RFC 9309 — Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
