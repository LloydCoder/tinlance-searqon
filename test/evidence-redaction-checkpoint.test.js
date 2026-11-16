import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceRecord } from "../src/evidence.js";
import { createEvidenceRedactionManifest } from "../src/evidence-redaction.js";
import { openEvidenceRedactionStore } from "../src/evidence-redaction-store.js";
import {
  createEvidenceRedactionJournalCheckpoint,
  verifyEvidenceRedactionJournalCheckpoint
} from "../src/evidence-redaction-checkpoint.js";

function manifest(keys, label) {
  const record = createEvidenceRecord({
    source: label + ".example",
    content: label,
    contentType: "text/plain",
    collectedAt: "2026-11-16T00:00:00.000Z"
  });
  return createEvidenceRedactionManifest({
    evidenceIds: [record.id],
    requestId: "CHECKPOINT-" + label,
    reasonCode: "customer_request",
    requestedBy: "requester-" + label,
    approvedBy: "approver-" + label,
    createdAt: "2026-11-16T00:01:00.000Z"
  }, keys.privateKey);
}

async function makeEntries(keys, labels) {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "searqon-checkpoint-"));
  const store = await openEvidenceRedactionStore(join(directory, "journal.jsonl"), keys.publicKey);
  try {
    for (const label of labels) await store.append(manifest(keys, label));
    return store.list();
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("creates and verifies a signed checkpoint for the current redaction journal head", async () => {
  const keys = generateKeyPairSync("ed25519");
  const entries = await makeEntries(keys, ["one", "two"]);
  const checkpoint = createEvidenceRedactionJournalCheckpoint(entries, keys.privateKey, {
    createdAt: "2026-11-16T01:00:00.000Z",
    manifestPublicKey: keys.publicKey
  });

  assert.equal(checkpoint.entryCount, 2);
  assert.equal(checkpoint.headHash, entries[1].entryHash);
  assert.equal(verifyEvidenceRedactionJournalCheckpoint(checkpoint, entries, keys.publicKey, keys.publicKey).valid, true);
});

test("a trusted checkpoint validates its prefix after later valid appends", async () => {
  const keys = generateKeyPairSync("ed25519");
  const prefix = await makeEntries(keys, ["one"]);
  const checkpoint = createEvidenceRedactionJournalCheckpoint(prefix, keys.privateKey, {
    createdAt: "2026-11-16T01:00:00.000Z",
    manifestPublicKey: keys.publicKey
  });
  const extended = await makeEntries(keys, ["one", "two"]);

  assert.equal(verifyEvidenceRedactionJournalCheckpoint(checkpoint, extended, keys.publicKey, keys.publicKey).valid, true);
});

test("checkpoint detects truncation, reordering and altered journal entries", async () => {
  const keys = generateKeyPairSync("ed25519");
  const entries = await makeEntries(keys, ["one", "two"]);
  const checkpoint = createEvidenceRedactionJournalCheckpoint(entries, keys.privateKey, {
    createdAt: "2026-11-16T01:00:00.000Z",
    manifestPublicKey: keys.publicKey
  });

  assert.equal(verifyEvidenceRedactionJournalCheckpoint(checkpoint, entries.slice(0, 1), keys.publicKey, keys.publicKey).valid, false);
  assert.equal(verifyEvidenceRedactionJournalCheckpoint(checkpoint, [...entries].reverse(), keys.publicKey, keys.publicKey).valid, false);
  const altered = [{ ...entries[0], entryHash: "0".repeat(64) }, entries[1]];
  assert.equal(verifyEvidenceRedactionJournalCheckpoint(checkpoint, altered, keys.publicKey, keys.publicKey).valid, false);
});

test("checkpoint rejects mismatched signing keys and modified checkpoint fields", async () => {
  const keys = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const entries = await makeEntries(keys, ["one"]);
  const checkpoint = createEvidenceRedactionJournalCheckpoint(entries, keys.privateKey, {
    createdAt: "2026-11-16T01:00:00.000Z",
    manifestPublicKey: keys.publicKey
  });

  assert.equal(verifyEvidenceRedactionJournalCheckpoint(checkpoint, entries, other.publicKey, keys.publicKey).valid, false);
  assert.equal(verifyEvidenceRedactionJournalCheckpoint({ ...checkpoint, entryCount: 0 }, entries, keys.publicKey, keys.publicKey).valid, false);
});

test("checkpoint refuses invalid journal data and non-canonical timestamps", async () => {
  const keys = generateKeyPairSync("ed25519");
  const entries = await makeEntries(keys, ["one"]);
  assert.throws(() => createEvidenceRedactionJournalCheckpoint([{ ...entries[0], entryHash: "0".repeat(64) }], keys.privateKey, {
    createdAt: "2026-11-16T01:00:00.000Z",
    manifestPublicKey: keys.publicKey
  }), /valid redaction journal/);
  assert.throws(() => createEvidenceRedactionJournalCheckpoint(entries, keys.privateKey, {
    createdAt: "2026-11-16"
  }), /canonical ISO 8601 UTC timestamp/);
});

test("supports an empty journal checkpoint and validates later appended entries", async () => {
  const keys = generateKeyPairSync("ed25519");
  const empty = await makeEntries(keys, []);
  const checkpoint = createEvidenceRedactionJournalCheckpoint(empty, keys.privateKey, {
    createdAt: "2026-11-16T01:00:00.000Z",
    manifestPublicKey: keys.publicKey
  });
  const extended = await makeEntries(keys, ["later"]);
  assert.equal(checkpoint.entryCount, 0);
  assert.equal(checkpoint.headHash, null);
  assert.equal(verifyEvidenceRedactionJournalCheckpoint(checkpoint, extended, keys.publicKey, keys.publicKey).valid, true);
});

test("supports independent manifest-approval and journal-checkpoint keys", async () => {
  const manifestKeys = generateKeyPairSync("ed25519");
  const checkpointKeys = generateKeyPairSync("ed25519");
  const entries = await makeEntries(manifestKeys, ["independent"]);
  const checkpoint = createEvidenceRedactionJournalCheckpoint(entries, checkpointKeys.privateKey, {
    createdAt: "2026-11-16T01:00:00.000Z",
    manifestPublicKey: manifestKeys.publicKey
  });
  assert.equal(verifyEvidenceRedactionJournalCheckpoint(
    checkpoint,
    entries,
    checkpointKeys.publicKey,
    manifestKeys.publicKey
  ).valid, true);
  assert.equal(verifyEvidenceRedactionJournalCheckpoint(
    checkpoint,
    entries,
    checkpointKeys.publicKey
  ).valid, false);
});
