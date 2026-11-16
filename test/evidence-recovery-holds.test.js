import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceRecord } from "../src/evidence.js";
import { createEvidenceLedgerEntry } from "../src/evidence-ledger.js";
import { createEvidenceLedgerCheckpoint } from "../src/evidence-checkpoint.js";
import { createEvidenceRedactionJournalCheckpoint } from "../src/evidence-redaction-checkpoint.js";
import {
  createEvidenceLegalHoldEvent,
  EvidenceLegalHoldApproverRegistry
} from "../src/evidence-legal-holds.js";
import { openEvidenceLegalHoldStore } from "../src/evidence-legal-hold-store.js";
import { createEvidenceLegalHoldJournalCheckpoint } from "../src/evidence-legal-hold-checkpoint.js";
import { verifyEvidenceRecoveryBundle } from "../src/evidence-recovery.js";

async function buildBundle({ unknownHoldReference = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "searqon-recovery-holds-"));
  const record = createEvidenceRecord({
    source: "https://example.test/hold",
    content: "recovery with legal hold",
    contentType: "text/plain",
    collectedAt: "2026-01-01T00:00:00.000Z"
  });
  const ledgerEntries = [createEvidenceLedgerEntry(record, {
    sequence: 1,
    createdAt: "2026-11-16T00:00:00.000Z"
  })];
  const ledgerKeys = generateKeyPairSync("ed25519");
  const redactionKeys = generateKeyPairSync("ed25519");
  const redactionCheckpointKeys = generateKeyPairSync("ed25519");
  const holdKeys = generateKeyPairSync("ed25519");
  const holdCheckpointKeys = generateKeyPairSync("ed25519");
  const legalHoldVerifier = new EvidenceLegalHoldApproverRegistry();
  legalHoldVerifier.register({ actorId: "approver-01", publicKey: holdKeys.publicKey });
  const store = await openEvidenceLegalHoldStore(join(directory, "holds.jsonl"), legalHoldVerifier);
  const hold = createEvidenceLegalHoldEvent({
    holdId: "HOLD-RECOVERY-01",
    sequence: 1,
    action: "place",
    evidenceIds: [unknownHoldReference ? "evidence_ffffffffffffffffffff" : record.id],
    requestId: "HOLD-RECOVERY-REQUEST",
    reasonCode: "litigation",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-16T00:00:00.000Z"
  }, holdKeys.privateKey);
  await store.append(hold);
  const legalHoldEntries = store.list();
  const legalHoldCheckpoint = createEvidenceLegalHoldJournalCheckpoint(legalHoldEntries, holdCheckpointKeys.privateKey, {
    createdAt: "2026-11-16T00:01:00.000Z",
    legalHoldVerifier
  });
  await store.close();

  const bundle = {
    ledgerEntries,
    ledgerCheckpoint: createEvidenceLedgerCheckpoint(ledgerEntries, ledgerKeys.privateKey, {
      createdAt: "2026-11-16T00:02:00.000Z"
    }),
    ledgerCheckpointPublicKey: ledgerKeys.publicKey,
    redactionEntries: [],
    redactionCheckpoint: createEvidenceRedactionJournalCheckpoint([], redactionCheckpointKeys.privateKey, {
      createdAt: "2026-11-16T00:03:00.000Z",
      manifestPublicKey: redactionKeys.publicKey
    }),
    redactionCheckpointPublicKey: redactionCheckpointKeys.publicKey,
    manifestPublicKey: redactionKeys.publicKey,
    legalHoldEntries,
    legalHoldCheckpoint,
    legalHoldCheckpointPublicKey: holdCheckpointKeys.publicKey,
    legalHoldVerifier
  };
  return { directory, bundle, record };
}

test("recovery verifier validates legal hold journal and exposes active held evidence IDs", async () => {
  const { directory, bundle, record } = await buildBundle();
  try {
    const result = verifyEvidenceRecoveryBundle(bundle);
    assert.equal(result.valid, true);
    assert.deepEqual(result.activeLegalHoldEvidenceIds, [record.id]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovery verifier fails closed on missing legal hold checkpoint and unknown held evidence", async () => {
  const first = await buildBundle();
  try {
    const missing = verifyEvidenceRecoveryBundle({ ...first.bundle, legalHoldCheckpoint: null });
    assert.equal(missing.valid, false);
    assert.deepEqual(missing.activeLegalHoldEvidenceIds, []);
  } finally {
    await rm(first.directory, { recursive: true, force: true });
  }

  const second = await buildBundle({ unknownHoldReference: true });
  try {
    const result = verifyEvidenceRecoveryBundle(second.bundle);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes("legal_hold_references_unknown_evidence"));
    assert.deepEqual(result.activeLegalHoldEvidenceIds, []);
  } finally {
    await rm(second.directory, { recursive: true, force: true });
  }
});
