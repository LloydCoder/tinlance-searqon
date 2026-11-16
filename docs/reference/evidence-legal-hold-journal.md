# Persistent signed legal-hold journal

The legal-hold store persists signed place/release events in newline-delimited JSON. Each envelope carries a global sequence, previous-entry hash, signed event and SHA-256 entry hash. On open, the store verifies the full journal, every event signature, per-hold state transitions and request-ID uniqueness before exposing events.

## API

```js
import { openEvidenceLegalHoldStore } from "./src/evidence-legal-hold-store.js";

const store = await openEvidenceLegalHoldStore("./private/legal-holds.jsonl", approverRegistry);
try {
  await store.append(signedHoldEvent);
  const entries = store.list();
  const events = store.listEvents();
  const integrity = store.verify();
} finally {
  await store.close();
}
```

Pass either a trusted Ed25519 public key or an `EvidenceLegalHoldApproverRegistry`. The registry binds `approvedBy` actor IDs to signing keys and can be used to reject unregistered or revoked keys.

## Local storage controls

- Creates owner-only directories/files where supported and enforces mode 0600 on the journal file.
- Rejects symlink targets, hard-linked files, foreign-owned files and group/world-writable parent directories on POSIX.
- Bounds journal size to 32 MiB and individual serialized entries to 512 KiB.
- Serializes appends within one process, closes admission synchronously, drains accepted writes, fsyncs each append and refuses writes after a failed write.
- Rejects duplicate request IDs, invalid signatures, malformed/truncated JSONL, broken hash links, sequence gaps and invalid per-hold state transitions.

## Detached journal checkpoints

Create a signed checkpoint of a verified journal with `createEvidenceLegalHoldJournalCheckpoint(entries, checkpointPrivateKey, { createdAt, legalHoldVerifier })`. Verify it using `verifyEvidenceLegalHoldJournalCheckpoint(checkpoint, entries, checkpointPublicKey, legalHoldVerifier)`. The checkpoint binds the journal entry count and prefix head hash. Store the checkpoint and trusted checkpoint public key outside the journal trust domain.

A valid suffix appended after the checkpoint remains verifiable; a shortened or altered checkpointed prefix fails. The checkpoint creation time is caller-supplied and is not a trusted timestamp.

## Trust boundaries and limitations

- The store is single-process only. It does not provide cross-process locking, distributed coordination, WORM storage, encryption or automatic remote replication.
- A hash chain alone cannot detect replacement or truncation of a valid suffix unless a detached checkpoint is independently retained.
- The approver registry is in-memory and caller-managed. Persist its actor/key assignments and revocation events in a separately protected control plane; registry state is not automatically backed up with the journal.
- Historical signatures dated before a key's configured revocation cutoff remain verifiable. Event timestamps are caller-supplied claims, not trusted timestamps; high-assurance revocation requires an independently trusted time/approval record.
- The journal records preservation controls only. It does not provide legal case management, authenticate requester identities, determine legal necessity or execute deletion.

The journal is a local auditability primitive, not a hosted multi-tenant audit service or a certified immutable log.
