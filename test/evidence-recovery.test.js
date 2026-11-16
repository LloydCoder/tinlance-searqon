import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceRecord } from "../src/evidence.js";
import { createEvidenceLedgerEntry } from "../src/evidence-ledger.js";
import { createEvidenceLedgerCheckpoint } from "../src/evidence-checkpoint.js";
import { createEvidenceRedactionManifest } from "../src/evidence-redaction.js";
import { createEvidenceRedactionJournalCheckpoint } from "../src/evidence-redaction-checkpoint.js";
import { verifyEvidenceRecoveryBundle } from "../src/evidence-recovery.js";

function ledgerFixture() {
  const record = createEvidenceRecord({
    source: "https://example.test/policy",
    content: "recovery fixture",
    contentType: "text/plain",
    collectedAt: "2026-11-16T00:00:00.000Z"
  });
  const entry = createEvidenceLedgerEntry(record, {
    sequence: 1,
    createdAt: "2026-11-16T00:01:00.000Z"
  });
  return { record, entries: [entry] };
}

// Construct the journal entry using the public store API, so the fixture
// exercises the same canonical hash/signature rules as persisted journals.
async function createJournalEntry(record, keys) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { openEvidenceRedactionStore } = await import("../src/evidence-redaction-store.js");
  const directory = await mkdtemp(join(tmpdir(), "searqon-recovery-"));
  const store = await openEvidenceRedactionStore(join(directory, "journal.jsonl"), keys.manifest.publicKey);
  try {
    await store.append(createEvidenceRedactionManifest({
      evidenceIds: [record.id],
      requestId: "RECOVERY-001",
      reasonCode: "customer_request",
      requestedBy: "requester-1",
      approvedBy: "approver-1",
      createdAt: "2026-11-16T00:02:00.000Z"
    }, keys.manifest.privateKey));
    return store.list();
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function validBundle() {
  const { record, entries } = ledgerFixture();
  const ledgerKeys = generateKeyPairSync("ed25519");
  const manifestKeys = generateKeyPairSync("ed25519");
  const checkpointKeys = generateKeyPairSync("ed25519");
  const redactionEntries = await createJournalEntry(record, { manifest: manifestKeys });
  return {
    ledgerEntries: entries,
    ledgerCheckpoint: createEvidenceLedgerCheckpoint(entries, ledgerKeys.privateKey, {
      createdAt: "2026-11-16T00:03:00.000Z"
    }),
    ledgerCheckpointPublicKey: ledgerKeys.publicKey,
    ledgerCheckpointPrivateKey: ledgerKeys.privateKey,
    redactionEntries,
    redactionCheckpoint: createEvidenceRedactionJournalCheckpoint(redactionEntries, checkpointKeys.privateKey, {
      createdAt: "2026-11-16T00:04:00.000Z",
      manifestPublicKey: manifestKeys.publicKey
    }),
    redactionCheckpointPublicKey: checkpointKeys.publicKey,
    manifestPublicKey: manifestKeys.publicKey
  };
}

test("recovery verifier accepts a fully checkpointed ledger and redaction journal", async () => {
  const bundle = await validBundle();
  const result = verifyEvidenceRecoveryBundle(bundle);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.suppressedEvidenceIds, [bundle.ledgerEntries[0].record.id]);
});

test("recovery verifier fails closed when either checkpoint is absent or invalid", async () => {
  const bundle = await validBundle();
  const missingLedgerCheckpoint = verifyEvidenceRecoveryBundle({ ...bundle, ledgerCheckpoint: null });
  assert.equal(missingLedgerCheckpoint.valid, false);
  assert.deepEqual(missingLedgerCheckpoint.suppressedEvidenceIds, []);
  assert.equal(verifyEvidenceRecoveryBundle({ ...bundle, redactionCheckpoint: null }).valid, false);
  assert.equal(verifyEvidenceRecoveryBundle({
    ...bundle,
    redactionCheckpointPublicKey: generateKeyPairSync("ed25519").publicKey
  }).valid, false);
});

test("recovery verifier rejects redaction references absent from the restored ledger", async () => {
  const bundle = await validBundle();
  const altered = {
    ...bundle,
    ledgerEntries: []
  };
  assert.equal(verifyEvidenceRecoveryBundle(altered).valid, false);
});

test("recovery verifier rejects duplicate evidence identifiers in a restored ledger", async () => {
  const bundle = await validBundle();
  const { createEvidenceLedgerEntry } = await import("../src/evidence-ledger.js");
  const second = createEvidenceLedgerEntry(bundle.ledgerEntries[0].record, {
    sequence: 2,
    previousHash: bundle.ledgerEntries[0].entryHash,
    createdAt: "2026-11-16T00:05:00.000Z"
  });
  const entries = [...bundle.ledgerEntries, second];
  assert.equal(second.record.id, bundle.ledgerEntries[0].record.id);
  const checkpoint = createEvidenceLedgerCheckpoint(entries, bundle.ledgerCheckpointPrivateKey, {
    createdAt: "2026-11-16T00:06:00.000Z"
  });
  const result = verifyEvidenceRecoveryBundle({ ...bundle, ledgerEntries: entries, ledgerCheckpoint: checkpoint });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("duplicate_evidence_identifier"));
});

test("recovery verifier rejects malformed bundle input without throwing", () => {
  const result = verifyEvidenceRecoveryBundle(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid_recovery_bundle"));
});
