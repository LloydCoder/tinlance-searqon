# Signed evidence redaction manifests

Searqon supports a signed manifest that suppresses selected evidence identifiers from generated exports. This is a logical visibility control for the current local toolkit, not physical deletion or secure media sanitization.

## Approval model

A manifest records:

- A unique request identifier and a fixed reason code.
- Separate requester and approver identifiers (separation of duties).
- The exact evidence IDs to suppress.
- A canonical UTC creation time.
- The Ed25519 key fingerprint and detached signature over the canonical manifest payload.

The manifest contains identifiers and reason codes only. It does not copy source URLs, evidence content, or free-form personal explanations. Evidence IDs are sorted before signing so equivalent requests produce the same payload and signature for the same key and timestamp.

## API

```js
import {
  createEvidenceRedactionManifest,
  verifyEvidenceRedactionManifest,
  filterEvidenceByRedaction
} from "./src/evidence-redaction.js";

const manifest = createEvidenceRedactionManifest({
  evidenceIds: ["evidence_0123456789abcdefabcd"],
  requestId: "REQ-2026-001",
  reasonCode: "customer_request",
  requestedBy: "requester-01",
  approvedBy: "approver-02",
  createdAt: "2026-11-16T00:00:00.000Z"
}, approverPrivateKey);

const verified = verifyEvidenceRedactionManifest(manifest, approverPublicKey);
const exportView = filterEvidenceByRedaction(records, [manifest], approverPublicKey);
```

The example identifier is illustrative. Use real IDs returned by valid Evidence Records.

## Security and operational limits

- Ed25519 verification proves that the manifest was signed by the holder of the matching private key. It does not prove that the human identity in approvedBy is authorized; the caller must bind key custody to an authenticated approver identity and enforce approval policy.
- The function enforces distinct requester and approver identifiers, but the library does not authenticate either identity.
- Export filtering validates every supplied manifest and fails closed if one is invalid. Duplicate request IDs and duplicate evidence IDs in the input set are rejected.
- The filter does not mutate the evidence records or the append-only ledger. It returns a filtered view for reports/exports only.
- The original metadata remains in the JSONL ledger and may remain in filesystem snapshots or backups. This is not a deletion or erasure workflow.
- A signed manifest is not a WORM audit store. Store it separately from the ledger trust domain and protect its signing/verification keys through an independently reviewed custody process.
- The manifest does not replace legal holds, data-controller decisions, backup expiry, retention policy, or storage sanitization.

The schema is registered as evidence-redaction-manifest v1.0.0. NIST SP 800-88 Rev. 2 describes a media-sanitization program; unlinking or suppressing a record from an export is not evidence that underlying storage media has been sanitized.
