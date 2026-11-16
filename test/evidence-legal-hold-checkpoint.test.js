import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEvidenceLegalHoldEvent,
  EvidenceLegalHoldApproverRegistry
} from "../src/evidence-legal-holds.js";
import { openEvidenceLegalHoldStore } from "../src/evidence-legal-hold-store.js";
import {
  createEvidenceLegalHoldJournalCheckpoint,
  verifyEvidenceLegalHoldJournalCheckpoint
} from "../src/evidence-legal-hold-checkpoint.js";

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "searqon-hold-checkpoint-"));
  directories.push(directory);
  const path = join(directory, "holds.jsonl");
  const signer = generateKeyPairSync("ed25519");
  const checkpointSigner = generateKeyPairSync("ed25519");
  const registry = new EvidenceLegalHoldApproverRegistry();
  registry.register({ actorId: "approver-01", publicKey: signer.publicKey });
  const store = await openEvidenceLegalHoldStore(path, registry);
  const place = createEvidenceLegalHoldEvent({
    holdId: "HOLD-CHECKPOINT-01",
    sequence: 1,
    action: "place",
    evidenceIds: ["evidence_0123456789abcdefabcd"],
    requestId: "HOLD-CHECKPOINT-PLACE",
    reasonCode: "regulatory",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-16T00:00:00.000Z"
  }, signer.privateKey);
  const first = await store.append(place);
  const entries = store.list();
  const checkpoint = createEvidenceLegalHoldJournalCheckpoint(entries, checkpointSigner.privateKey, {
    createdAt: "2026-11-16T00:01:00.000Z",
    legalHoldVerifier: registry
  });
  return { store, registry, signer, checkpointSigner, entries, first, checkpoint };
}

test("creates and verifies a detached checkpoint of a signed legal hold journal", async () => {
  const f = await fixture();
  const result = verifyEvidenceLegalHoldJournalCheckpoint(f.checkpoint, f.entries, f.checkpointSigner.publicKey, f.registry);
  assert.equal(result.valid, true);
  await f.store.close();
});

test("allows valid appended journal suffixes while detecting checkpoint truncation", async () => {
  const f = await fixture();
  const release = createEvidenceLegalHoldEvent({
    holdId: "HOLD-CHECKPOINT-01",
    sequence: 2,
    action: "release",
    evidenceIds: ["evidence_0123456789abcdefabcd"],
    requestId: "HOLD-CHECKPOINT-RELEASE",
    reasonCode: "regulatory",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-17T00:00:00.000Z"
  }, f.signer.privateKey);
  await f.store.append(release);
  const full = f.store.list();
  assert.equal(verifyEvidenceLegalHoldJournalCheckpoint(f.checkpoint, full, f.checkpointSigner.publicKey, f.registry).valid, true);
  assert.equal(verifyEvidenceLegalHoldJournalCheckpoint(f.checkpoint, [], f.checkpointSigner.publicKey, f.registry).valid, false);
  await f.store.close();
});

test("rejects tampered checkpoint signatures, journal entries and untrusted checkpoint keys", async () => {
  const f = await fixture();
  const wrongKeys = generateKeyPairSync("ed25519");
  const altered = { ...f.entries[0], event: { ...f.entries[0].event, reasonCode: "litigation" } };
  assert.equal(verifyEvidenceLegalHoldJournalCheckpoint(f.checkpoint, [altered], f.checkpointSigner.publicKey, f.registry).valid, false);
  assert.equal(verifyEvidenceLegalHoldJournalCheckpoint(f.checkpoint, f.entries, wrongKeys.publicKey, f.registry).valid, false);
  assert.equal(verifyEvidenceLegalHoldJournalCheckpoint({
    ...f.checkpoint,
    signature: Buffer.alloc(64, 1).toString("base64")
  }, f.entries, f.checkpointSigner.publicKey, f.registry).valid, false);
  await f.store.close();
});
