# Evidence retention evaluation

Searqon provides a deterministic retention evaluator for evidence metadata. It computes which records have passed a caller-selected retention interval and returns a metadata-only report suitable for an operator review or a future governed purge workflow.

## API

```js
import { evaluateEvidenceRetention } from "./src/evidence-retention.js";

const decision = evaluateEvidenceRetention(records, {
  retentionDays: 90,
  now: "2026-11-16T00:00:00.000Z"
});
```

The caller must supply the evaluation time. The evaluator accepts canonical UTC ISO 8601 timestamps, requires a positive integer retention interval (maximum 36,500 days), rejects duplicate evidence IDs, and calculates expiry as collectedAt plus the configured number of 24-hour days. A record is eligible when its expiry instant is less than or equal to the supplied evaluation time.

The result includes policy version, evaluation time, retention interval, sorted metadata-only eligible/retained lists and counts. It does not return source labels, URLs, hashes or payloads.

## Critical limitations

- This function does not delete, redact, overwrite, compact or modify any source record or ledger file.
- Eligibility is not authorization to purge. A caller must apply the relevant legal hold, customer agreement, ownership and approval checks before any deletion operation.
- The current JSONL evidence ledger is not encrypted or WORM. Removing a record from a derived report does not remove it from the ledger, filesystem snapshots or backups.
- Secure media sanitization cannot be claimed from unlinking or rewriting a local file. A storage-specific sanitization and verification process is required.
- No retention interval is globally hard-coded. The product owner or data controller must choose policy by data category and applicable obligations.

The evaluator is intentionally a pure policy decision. Physical deletion, cryptographic erasure, signed redaction events, legal holds, audit custody, backup expiration and restore behavior remain separate Phase 5 controls. See NIST SP 800-88 Rev. 2 for media-sanitization program guidance: https://csrc.nist.gov/pubs/sp/800/88/r2/final.
