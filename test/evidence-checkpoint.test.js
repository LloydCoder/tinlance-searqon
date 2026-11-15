import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceRecord } from "../src/evidence.js";
import { createEvidenceLedgerEntry } from "../src/evidence-ledger.js";
import { createEvidenceLedgerCheckpoint, verifyEvidenceLedgerCheckpoint } from "../src/evidence-checkpoint.js";

function entries(content = "signed checkpoint fixture") {
  const record = createEvidenceRecord({
    source: "fixture.html",
    content,
    contentType: "text/html",
    collectedAt: "2026-11-15T00:00:00.000Z"
  });
  return [createEvidenceLedgerEntry(record, { sequence: 1, createdAt: "2026-11-15T00:01:00.000Z" })];
}

test("Ed25519 checkpoint signs and verifies a valid evidence-ledger root", () => {
  const keys = generateKeyPairSync("ed25519");
  const ledger = entries();
  const checkpoint = createEvidenceLedgerCheckpoint(ledger, keys.privateKey, {
    createdAt: "2026-11-15T00:02:00.000Z"
  });
  const result = verifyEvidenceLedgerCheckpoint(checkpoint, ledger, keys.publicKey);
  assert.equal(checkpoint.algorithm, "Ed25519");
  assert.equal(checkpoint.entryCount, 1);
  assert.equal(checkpoint.headSequence, 1);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("signed checkpoint detects ledger truncation and full-chain replacement", () => {
  const keys = generateKeyPairSync("ed25519");
  const ledger = entries();
  const checkpoint = createEvidenceLedgerCheckpoint(ledger, keys.privateKey, {
    createdAt: "2026-11-15T00:02:00.000Z"
  });
  assert.equal(verifyEvidenceLedgerCheckpoint(checkpoint, [], keys.publicKey).valid, false);
  const replacement = entries("different payload produces a different ledger root");
  assert.equal(verifyEvidenceLedgerCheckpoint(checkpoint, replacement, keys.publicKey).valid, false);
});

test("signed checkpoint rejects altered checkpoint fields and wrong public keys", () => {
  const keys = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const ledger = entries();
  const checkpoint = createEvidenceLedgerCheckpoint(ledger, keys.privateKey, {
    createdAt: "2026-11-15T00:02:00.000Z"
  });
  assert.equal(verifyEvidenceLedgerCheckpoint({ ...checkpoint, headHash: "0".repeat(64) }, ledger, keys.publicKey).valid, false);
  assert.equal(verifyEvidenceLedgerCheckpoint(checkpoint, ledger, other.publicKey).valid, false);
});

test("signed checkpoint supports an empty but valid ledger", () => {
  const keys = generateKeyPairSync("ed25519");
  const checkpoint = createEvidenceLedgerCheckpoint([], keys.privateKey, {
    createdAt: "2026-11-15T00:02:00.000Z"
  });
  assert.equal(checkpoint.entryCount, 0);
  assert.equal(checkpoint.headHash, null);
  assert.equal(verifyEvidenceLedgerCheckpoint(checkpoint, [], keys.publicKey).valid, true);
});

test("checkpoint creation refuses invalid ledgers, non-Ed25519 keys, and non-canonical timestamps", () => {
  const keys = generateKeyPairSync("ed25519");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => createEvidenceLedgerCheckpoint([{ invalid: true }], keys.privateKey), /valid evidence ledger/);
  assert.throws(() => createEvidenceLedgerCheckpoint([], rsa.privateKey), /Ed25519/);
  assert.throws(() => createEvidenceLedgerCheckpoint([], keys.privateKey, { createdAt: "2026-11-15" }), /canonical ISO 8601/);
});
