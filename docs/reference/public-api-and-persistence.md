# Public API and Persistence Boundaries

**Contract baseline:** v1 contracts in [contract-registry.json](../schemas/contract-registry.json).  
**Status:** Current local toolkit boundary; this is not a hosted-service API.

## Supported programmatic entry points

| Module | Public exports | Boundary |
|---|---|---|
| `src/analyzer.js` | `analyzeDocument(input)` | Pure local document analysis; accepts caller-provided source label, media type and content. No network acquisition. |
| `src/remote-scan.js` | `scanPublicUrl(url, options)` | One caller-selected public URL. Requires `confirmAuthorizedTarget: true`; bounded fetch and robots-aware redirect policy. Not a recursive crawler. |
| `src/evidence.js` | `createEvidenceRecord(input)`, `verifyEvidenceRecord(record)`, `verifyEvidenceContent(record, content)`, `EVIDENCE_OBSERVATION_CLASSES`, `MAX_EVIDENCE_BYTES` | Evidence metadata normalization and integrity checks. A digest is not authenticity, trusted time or WORM storage. |
| `src/evidence-ledger.js` | `createEvidenceLedgerEntry(record, options)`, `verifyEvidenceLedgerEntry(entry)`, `verifyEvidenceLedger(entries)`, `EVIDENCE_LEDGER_SCHEMA_VERSION` | Deterministic sequence/hash-chain primitives. |
| `src/evidence-store.js` | `openEvidenceLedgerStore(path)`, size limits | Local append-oriented JSONL persistence; single-process admission, not distributed locking or multi-writer storage. |
| `src/evidence-checkpoint.js` | `createEvidenceLedgerCheckpoint(...)`, `verifyEvidenceLedgerCheckpoint(...)`, checkpoint version | Detached Ed25519 signatures; trusted verification depends on independent public-key custody. |
| `src/geo.js` | `analyzeGeoObservation(input)`, `aggregateGeoObservations(items, options)`, `GEO_OBSERVATION_CLASSES` | Supplied observation processing only. No provider querying, consumer-interface scraping, scheduler or history service. |
| `src/report-html.js` | `renderHtmlReport(report)`, `escapeHtml(value)` | Deterministic local HTML rendering; no hosted report service. |

The package's executable interface is the `searqon` CLI. Its current commands are:

- `scan <local-file>`: local HTML, Markdown or JSON input; `--format mcp` selects a caller-supplied normalized MCP snapshot.
- `scan-url <public-url> --confirm-authorized-target`: one authorized public URL; cross-origin redirects require explicit `--allow-redirect-origin` entries.
- `geo analyze <observation.json>` and `geo aggregate <observations.json>`: supplied JSON only.
- `report <assessment.json>`: local HTML output.

CLI output is JSON (or HTML for `report`); `--out` creates a new file and refuses to overwrite an existing path.

## Persistence contract

- Evidence records are metadata objects; source payloads are not persisted by the record constructor.
- The local evidence ledger stores one JSON object per line, appends in sequence, verifies the full hash chain when opened, and fsyncs each successful append.
- The current store is a single-process local-file implementation with bounded file/entry sizes and owner-only file permissions where supported.
- It is not encrypted, WORM, remotely replicated, multi-process safe, tenant-isolated or backed up automatically.
- Signed checkpoints do not create trusted timestamps. Store checkpoint artifacts and trusted public keys outside the ledger's trust domain.
- Retention, deletion/redaction, access control, tenant isolation and backup/restore are not yet implemented as a complete lifecycle.

## Version selection and migration

The registry is authoritative for the exact schema identity and contract version. Producers must emit the version they actually implement. Consumers must reject unknown versions rather than assume the latest. Published schemas are immutable; breaking changes require a new major version. No implicit migration or lossy coercion is supported. Every future migration must have a named source/target pair, deterministic transformation, provenance preservation, and explicit loss/round-trip tests.

## Security boundary

No public Searqon API accepts a model response, tool description, discovered endpoint or schema enum as authorization. Remote scanning requires caller authorization attestation. The passive MCP scanner consumes caller-supplied normalized data and does not connect to an MCP server or invoke tools. TAS remains the authority for agent identity, policy and execution.
