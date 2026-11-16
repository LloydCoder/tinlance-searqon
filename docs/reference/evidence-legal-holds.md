# Signed evidence legal holds

Searqon supports signed, ordered legal-hold events that prevent retention evaluation from marking covered evidence as purge-eligible. A hold is a preservation control, not a deletion authorization.

## Event lifecycle

Each Ed25519-signed event has a hold ID, per-hold sequence, action (place or release), fixed evidence-ID scope, request ID, reason code, requester/approver labels and canonical UTC timestamp.

- The first event for a hold ID must be place at sequence 1.
- Events for one hold ID must be contiguous and have monotonic timestamps.
- A currently active hold can only be followed by release.
- A released hold can be placed again with the next sequence.
- The evidence-ID scope is immutable for a hold ID. Create a new hold ID for a different scope.
- Request IDs must be unique across the supplied event history.
- The requester and approver labels must differ.

## API

```js
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceLegalHoldEvent } from "./src/evidence-legal-holds.js";
import { evaluateEvidenceRetention } from "./src/evidence-retention.js";

const keys = generateKeyPairSync("ed25519");
const hold = createEvidenceLegalHoldEvent({
  holdId: "HOLD-2026-001",
  sequence: 1,
  action: "place",
  evidenceIds: ["evidence_0123456789abcdefabcd"],
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

`deriveActiveEvidenceHolds(events, publicKeyOrRegistry)` verifies every signature and reconstructs the active hold set. For actor binding, register each approver key in `EvidenceLegalHoldApproverRegistry` using `register({ actorId, publicKey })`, then pass the registry instead of a bare public key. The registry requires `event.approvedBy` to equal the actor bound to the signing key, rejects unknown/revoked keys and prevents one key from being assigned to two actors. Register a replacement key for the same actor before using it, then revoke the old key with `revoke(keyId)` after the transition is approved. `evaluateEvidenceRetention` fails closed when a supplied event is malformed, out of sequence, incorrectly signed or verified with an untrusted key. Active holds are returned in the metadata-only `held` list and are also included in `retained`; they are excluded from `eligibleForPurge`. Releasing a hold allows normal retention evaluation to apply again.

## Security and operational limits

- A bare public-key verification proves control of the corresponding private key, not the human identity or legal authority named in the event. The optional registry binds the signer to the approvedBy actor identifier, but the application must still authenticate that actor and authorize the legal decision.
- The reducer accepts either one trusted public key or the optional in-memory approver registry. The registry is not durable or distributed; callers must persist its actor/key assignments and revocations in a separately protected control plane.
- Durable local journal storage and detached checkpoints are available through [the legal-hold journal](evidence-legal-hold-journal.md). The store remains single-process; the caller must preserve the registry and checkpoint artifacts independently. It does not provide legal case management or automatic backup retention.
- Hold events never delete or mutate evidence. The retention evaluator remains a decision function and does not execute a purge.
- The data controller remains responsible for deciding whether a hold is legally required, its scope, release authority and applicable retention policy.

The v1.0.0 JSON Schema is registered in [contract-registry.json](../../schemas/contract-registry.json). Runtime tests additionally enforce requester/approver separation and state-transition rules that are not fully expressible in the schema.
