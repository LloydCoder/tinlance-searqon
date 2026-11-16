# Persistent signed redaction journal

The local evidence redaction journal persists signed redaction manifests as newline-delimited JSON envelopes. Each envelope contains a sequence number, previous-entry hash, signed manifest and SHA-256 entry hash. Reopening the store verifies every manifest signature and the complete retained hash chain before exposing entries.

## API

```js
import { openEvidenceRedactionStore } from "./src/evidence-redaction-store.js";

const store = await openEvidenceRedactionStore("./private/redactions.jsonl", approverPublicKey);
try {
  await store.append(signedManifest);
  const manifests = store.listManifests();
  const integrity = store.verify();
} finally {
  await store.close();
}
```

## Local storage controls

- Creates owner-only directories/files where supported and enforces mode 0600 on the journal file.
- Rejects symlink targets, hard-linked files, foreign-owned files and group/world-writable parent directories on POSIX.
- Bounds journal size to 32 MiB and individual serialized entries to 512 KiB.
- Serializes appends within one process, closes admission synchronously, drains accepted writes, fsyncs each append and refuses writes after a failed write.
- Rejects duplicate request IDs, invalid signatures, malformed/truncated JSONL, broken hash links, sequence gaps and altered entries.

## Detached journal checkpoints

Create a signed checkpoint of a verified journal prefix with `createEvidenceRedactionJournalCheckpoint(entries, privateKey, { createdAt })`. Verify it against a journal and trusted public key with `verifyEvidenceRedactionJournalCheckpoint(checkpoint, entries, publicKey)`. The checkpoint binds the entry count and prefix head hash. A later journal with valid appended entries can still verify against the earlier checkpoint; a shortened or altered prefix fails.

The checkpoint is a portable signed object. The caller must store it, together with the trusted public key, in a separate trust domain (for example, independently controlled backup or external signing/custody system). Searqon does not automatically upload, replicate or protect checkpoint files. Its creation time is a caller-supplied claim, not a trusted timestamp.

## Trust boundaries and limitations

- The hash chain detects accidental edits, reordering and interior deletion when later entries remain unchanged. It cannot detect an attacker who can recompute the chain, truncate a valid suffix or replace the entire journal unless a trusted external checkpoint of the journal head is retained.
- The Ed25519 signature authenticates the manifest to a public key; the application must bind that key to the authorized approver identity. The store does not authenticate users or provide RBAC.
- Writer exclusion is process-local only. There is no cross-process lock, distributed coordination, encryption, WORM guarantee, remote replication or automatic backup.
- The journal records logical export suppression. It does not delete the original evidence record or sanitize the evidence ledger, filesystem snapshots or backups.
- Store the journal and any trusted head checkpoint outside the evidence ledger's trust domain. Do not treat a local hash chain as an independently anchored audit record.

The journal is a local auditability primitive, not a hosted multi-tenant audit service or a certified immutable log.
