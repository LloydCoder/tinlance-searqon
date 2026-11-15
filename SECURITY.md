# Security Policy

## Scope and current status

Searqon is early alpha. The repository contains local document analysis and a bounded, single-page remote scanner, but it does not implement a production crawler, hosted control plane, or authentication system. The controls below are mandatory engineering requirements; the current scanner is not a security certification or production-readiness claim.

## Reporting a vulnerability

Please do not publish exploitable details in public issues. Report suspected vulnerabilities privately through the repository owner's GitHub security advisory workflow where available. Include affected commit/version, impact, reproducible steps, and a proposed mitigation if known. Do not include real customer secrets or personal data.

## Security baseline

The implementation must be threat-modeled against, at minimum:

- OWASP Top 10:2025
- OWASP Application Security Verification Standard (ASVS) 5.0
- OWASP SSRF Prevention guidance
- Relevant MCP security requirements when MCP integration is introduced
- NIST AI Risk Management Framework and its Generative AI Profile where AI-specific risks apply

## Automated security controls

The repository runs CodeQL analysis, `npm audit`, and a full-history Gitleaks secret scan on pull requests, pushes to `main`, and a daily schedule. The Gitleaks binary is version-pinned and SHA-256 verified before execution. Published GitHub Releases generate a CycloneDX SBOM, checksums, and a GitHub artifact attestation for the package and SBOM. These controls do not replace secret rotation, independent penetration testing, or a formal ASVS assessment.

## Mandatory acquisition controls

Before broader remote crawling or a production release:

1. Parse and normalize target URLs using a standards-compliant URL parser.
2. Resolve all A and AAAA records and reject loopback, private, link-local, multicast, reserved, and metadata destinations, including Azure WireServer's special platform address 168.63.129.16.
3. Handle IPv4-mapped IPv6, unusual numeric IP encodings, and relevant translation mechanisms.
4. Mitigate DNS rebinding by validating the actual connection destination, not only a preflight DNS lookup.
5. Disable automatic redirects or validate every redirect hop and bind each connection to a validated address. The current one-page scanner uses manual redirects, permits same-origin redirects subject to policy, and requires an explicit origin allowlist before a cross-origin destination is contacted.
6. Revalidate destinations on retries before retries are introduced; retry behavior is not currently implemented.
7. Enforce strict response byte, decompression, total request deadline, socket inactivity timeout, DNS timeout, redirect, concurrency, depth, and content-type limits.
8. Isolate browser execution from credentials, internal networks, and host resources.
9. Treat robots policy as a crawl coordination signal, not authorization to access otherwise restricted resources.
10. Record the acquisition method and outcome without logging secrets.

## AI and agent boundaries

- Web pages, documents, tool descriptions, and model responses are untrusted data.
- Prompt injection must not be able to change tool permissions, policies, or execution scope.
- Discovered MCP servers and API endpoints are metadata until separately authorized.
- The initial scanner is passive: no tool invocation, transaction, credential guessing, or authenticated probing.
- Model output must never be treated as proof of a security property or as authorization.

## Data protection

Collect only data required for the declared assessment. Define retention, deletion, export, redaction, and tenant isolation before accepting customer data. Keep credentials out of source control, logs, fixtures, and evidence records. Encrypt secrets using a managed secret mechanism in any hosted deployment.

## Release requirements

Every release must have reviewed dependencies and licenses, secret scanning, static analysis, dependency vulnerability checks, an SBOM, provenance/signing where supported, regression tests for security boundaries, and a documented rollback path. A passing CI workflow does not replace independent security review.


## URL destination policy module

The repository includes URL/IP policy and bounded HTTP transport modules. They reject non-HTTP(S) schemes, URL credentials, local/reserved hostnames, non-public IP ranges, and non-public DNS answers; resolve and validate A/AAAA answers; pin the validated address at socket lookup; manually revalidate redirect targets; require explicit cross-origin origin authorization; classify unsafe redirect destinations separately from robots failures; enforce standard ports and response/time bounds; and reject HTTPS downgrade redirects. The remote-scan API requires `confirmAuthorizedTarget: true`, and the CLI requires `--confirm-authorized-target`. Cross-origin redirects are denied unless their public origins are explicitly allowlisted. These controls are operator attestations, not independent proof of ownership or authority. A GitHub Actions integration test performs a real IPv4-pinned HTTPS request with TLS verification. Retry behavior is not implemented. These controls are not a complete SSRF certification: broader production crawling still requires controlled-origin redirect/DNS-rebinding tests, stronger authorization, concurrency/depth limits, and independent security review.


## Robots Exclusion Protocol parser

A bounded parser and retrieval module for robots.txt is included. The parser handles user-agent groups, Allow/Disallow rules, wildcards, end anchors, Crawl-delay metadata, and Sitemap declarations. Evaluation selects the most-specific matching user-agent group and applies longest-path precedence with Allow winning ties. Retrieval uses the SSRF-safe transport, follows up to five validated redirects, caps input at 512 KiB, applies unavailable/unreachable outcomes, and uses a bounded process-local cache. Robots policy is a coordination signal, not authorization to access a resource. The current cache is not shared across workers or restarts.


## External security and protocol references

- OWASP, [Server Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html): destination validation, DNS rebinding, redirect validation, and connection pinning.
- IANA, [IPv4 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv4-special-registry): current destination/global-reachability classifications for IPv4 special-purpose ranges.
- IANA, [IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry): current destination/global-reachability classifications, including the non-global `5f00::/16` SRv6 SID block.
- IETF, [RFC 9309 — Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html): robots retrieval, redirects, unavailable/unreachable handling, caching, and the rule that robots is not access authorization.
- IETF, [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html): response media-type semantics and MIME-sniffing risks.
