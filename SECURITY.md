# Security Policy

## Scope and current status

Searqon is pre-alpha. The repository does not yet implement a production crawler, hosted control plane, authentication system, or scanner. The controls below are mandatory engineering requirements, not a claim that those controls have already been implemented.

## Reporting a vulnerability

Please do not publish exploitable details in public issues. Report suspected vulnerabilities privately through the repository owner's GitHub security advisory workflow where available. Include affected commit/version, impact, reproducible steps, and a proposed mitigation if known. Do not include real customer secrets or personal data.

## Security baseline

The implementation must be threat-modeled against, at minimum:

- OWASP Top 10:2025
- OWASP Application Security Verification Standard (ASVS) 5.0
- OWASP SSRF Prevention guidance
- Relevant MCP security requirements when MCP integration is introduced
- NIST AI Risk Management Framework and its Generative AI Profile where AI-specific risks apply

## Mandatory acquisition controls

Before any network scanner is released:

1. Parse and normalize target URLs using a standards-compliant URL parser.
2. Resolve all A and AAAA records and reject loopback, private, link-local, multicast, reserved, and metadata destinations.
3. Handle IPv4-mapped IPv6, unusual numeric IP encodings, and relevant translation mechanisms.
4. Mitigate DNS rebinding by validating the actual connection destination, not only a preflight DNS lookup.
5. Disable automatic redirects or validate every redirect hop and bind each connection to a validated address.
6. Revalidate destinations on retries.
7. Enforce strict response byte, decompression, timeout, redirect, concurrency, depth, and content-type limits.
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
