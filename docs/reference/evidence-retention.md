# Evidence retention evaluation

Searqon provides a deterministic retention evaluator for evidence metadata. It computes which records have passed a caller-selected retention interval and returns a metadata-only report suitable for an operator review or a future governed purge workflow.

## API

```js
import { generateKeyPairSync } from "node:crypto";
import { evaluateEvidenceRetention } from "./src/evidence-retention.js";
import { createEvidenceLegalHoldEvent } from "./src/evidence-legal-holds.js";

const keys = generateKeyPairSync("ed25519");
const hold = createEvidenceLegalHoldEvent({
  holdId: "HOLD-2026-001",
  sequence: 1,
  action: "place",
  evidenceIds: [records[0].id],
  requestId: "HOLD-REQUEST-001",
  reasonCode: "litigation",
  requestedBy: "requester-01",
  approvedBy: "approver-02",
  createdAt: "2026-11-16T00:00:00.000Z"
}, keys.privateKey);

const decision = evaluateEvidenceRetention(records, {
  retentionDays: 90,
  now: "2026-11-16T00:00:00.000Z",
  legalHoldEvents: [hold],
  legalHoldPublicKey: keys.publicKey
});
```

The caller must supply the evaluation time. The evaluator accepts canonical UTC ISO 8601 timestamps, requires a positive integer retention interval (maximum 36,500 days), rejects duplicate evidence IDs, and calculates expiry as collectedAt plus the configured number of 24-hour days. A record is eligible when its expiry instant is less than or equal to the supplied evaluation time.

The result includes policy version, evaluation time, retention interval, sorted metadata-only eligible/retained lists, a `held` subset and counts. Active legal holds are verified against a caller-supplied Ed25519 public key or `legalHoldApproverRegistry` and are never marked purge-eligible. The two verification options are mutually exclusive. It does not return source labels, URLs, hashes or payloads.

## Critical limitations

- This function does not delete, redact, overwrite, compact or modify any source record or ledger file.
- Eligibility is not authorization to purge. A caller must apply the relevant legal hold, customer agreement, ownership and approval checks before any deletion operation.
- The current JSONL evidence ledger is not encrypted or WORM. Removing a record from a derived report does not remove it from the ledger, filesystem snapshots or backups.
- Secure media sanitization cannot be claimed from unlinking or rewriting a local file. A storage-specific sanitization and verification process is required.
- No retention interval is globally hard-coded. The product owner or data controller must choose policy by data category and applicable obligations.

The evaluator is intentionally a pure policy decision. Physical deletion, cryptographic erasure, audit custody and backup expiration remain separate Phase 5 controls. Signed legal-hold events are described in [evidence legal holds](evidence-legal-holds.md). An offline recovery-bundle integrity gate is available through `verifyEvidenceRecoveryBundle`; it validates the restored ledger and redaction journal against independent checkpoints but does not perform restoration or prove backup completeness. See NIST SP 800-88 Rev. 2 for media-sanitization program guidance: https://csrc.nist.gov/pubs/sp/800/88/r2/final.
