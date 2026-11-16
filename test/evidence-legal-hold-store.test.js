import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEvidenceLegalHoldEvent,
  EvidenceLegalHoldApproverRegistry
} from "../src/evidence-legal-holds.js";
import { openEvidenceLegalHoldStore } from "../src/evidence-legal-hold-store.js";

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function temporaryJournalPath() {
  const directory = await mkdtemp(join(tmpdir(), "searqon-holds-"));
  directories.push(directory);
  return join(directory, "legal-holds.jsonl");
}

function fixture() {
  const keys = generateKeyPairSync("ed25519");
  const registry = new EvidenceLegalHoldApproverRegistry();
  registry.register({ actorId: "approver-01", publicKey: keys.publicKey });
  const base = {
    holdId: "HOLD-STORE-01",
    evidenceIds: ["evidence_0123456789abcdefabcd"],
    reasonCode: "litigation",
    requestedBy: "requester-01",
    approvedBy: "approver-01"
  };
  const place = createEvidenceLegalHoldEvent({
    ...base,
    sequence: 1,
    action: "place",
    requestId: "HOLD-STORE-PLACE",
    createdAt: "2026-11-16T00:00:00.000Z"
  }, keys.privateKey);
  const release = createEvidenceLegalHoldEvent({
    ...base,
    sequence: 2,
    action: "release",
    requestId: "HOLD-STORE-RELEASE",
    createdAt: "2026-11-17T00:00:00.000Z"
  }, keys.privateKey);
  return { keys, registry, place, release };
}

test("legal hold journal appends, closes, reopens and verifies signed hold events", async () => {
  const path = await temporaryJournalPath();
  const { registry, place, release } = fixture();
  const store = await openEvidenceLegalHoldStore(path, registry);
  const first = await store.append(place);
  const second = await store.append(release);

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(second.previousHash, first.entryHash);
  assert.equal(store.verify().valid, true);
  assert.equal(store.listEvents().length, 2);
  await store.close();

  const reopened = await openEvidenceLegalHoldStore(path, registry);
  assert.equal(reopened.list().length, 2);
  assert.equal(reopened.verify().valid, true);
  await reopened.close();
});

test("legal hold journal serializes concurrent appends and rejects duplicate request IDs", async () => {
  const path = await temporaryJournalPath();
  const { keys, registry } = fixture();
  const store = await openEvidenceLegalHoldStore(path, registry);
  const events = ["one", "two", "three"].map((label, index) => createEvidenceLegalHoldEvent({
    holdId: "HOLD-CONCURRENT-" + label,
    sequence: 1,
    action: "place",
    evidenceIds: ["evidence_0123456789abcdefabcd"],
    requestId: "HOLD-CONCURRENT-" + label,
    reasonCode: "investigation",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-16T00:00:0" + index + ".000Z"
  }, keys.privateKey));
  await Promise.all(events.map(event => store.append(event)));
  assert.deepEqual(store.list().map(entry => entry.sequence), [1, 2, 3]);
  await assert.rejects(() => store.append(events[0]), /duplicate request identifier/);
  assert.equal(store.verify().valid, true);
  await store.close();
});

test("legal hold journal refuses invalid signatures, invalid state transitions and tampered files", async () => {
  const path = await temporaryJournalPath();
  const { keys, registry, place } = fixture();
  const store = await openEvidenceLegalHoldStore(path, registry);
  const other = generateKeyPairSync("ed25519");
  const forged = createEvidenceLegalHoldEvent({
    holdId: "HOLD-FORGED",
    sequence: 1,
    action: "place",
    evidenceIds: ["evidence_0123456789abcdefabcd"],
    requestId: "HOLD-FORGED",
    reasonCode: "litigation",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-16T00:00:00.000Z"
  }, other.privateKey);
  await assert.rejects(() => store.append(forged), /valid signed legal-hold event/);
  await store.append(place);
  const invalidTransition = createEvidenceLegalHoldEvent({
    holdId: "HOLD-STORE-01",
    sequence: 2,
    action: "place",
    evidenceIds: ["evidence_0123456789abcdefabcd"],
    requestId: "HOLD-STORE-SECOND-PLACE",
    reasonCode: "litigation",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-17T00:00:00.000Z"
  }, keys.privateKey);
  await assert.rejects(() => store.append(invalidTransition), /valid legal-hold event sequence/);
  await store.close();

  const original = await readFile(path, "utf8");
  await writeFile(path, original.replace("litigation", "regulatory"), "utf8");
  await assert.rejects(() => openEvidenceLegalHoldStore(path, registry), /integrity verification failed/);
});

test("legal hold journal rejects truncated lines and oversized entries", async () => {
  const path = await temporaryJournalPath();
  const { registry, place } = fixture();
  const store = await openEvidenceLegalHoldStore(path, registry);
  await store.append(place);
  await store.close();
  await writeFile(path, await readFile(path, "utf8") + "{", "utf8");
  await assert.rejects(() => openEvidenceLegalHoldStore(path, registry), /truncated|invalid/i);
});

test("legal hold journal creates owner-only files and excludes concurrent process-local writers", async () => {
  const path = await temporaryJournalPath();
  const { registry, place } = fixture();
  const first = await openEvidenceLegalHoldStore(path, registry);
  await first.append(place);
  await assert.rejects(() => openEvidenceLegalHoldStore(path, registry), /already open/);
  await first.close();
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("legal hold journal closes admission immediately and drains accepted writes", async () => {
  const path = await temporaryJournalPath();
  const { registry, place } = fixture();
  const store = await openEvidenceLegalHoldStore(path, registry);
  const accepted = store.append(place);
  const closing = store.close();
  await assert.rejects(() => store.append(place), /closed/);
  await accepted;
  await closing;
  const reopened = await openEvidenceLegalHoldStore(path, registry);
  assert.equal(reopened.list().length, 1);
  await reopened.close();
});

test("legal hold journal refuses symbolic-link and hard-linked targets", async t => {
  if (process.platform === "win32") return t.skip("hard-link ownership semantics are platform-specific");
  const path = await temporaryJournalPath();
  const target = path + ".target";
  await writeFile(target, "", "utf8");
  await symlink(target, path);
  const { registry } = fixture();
  await assert.rejects(() => openEvidenceLegalHoldStore(path, registry));

  const hardPath = path + ".hard";
  await link(target, hardPath);
  await assert.rejects(() => openEvidenceLegalHoldStore(hardPath, registry), /hard link|multiple links/i);
});

test("legal hold journal rejects group- or world-writable parent directories", async () => {
  const path = await temporaryJournalPath();
  const { registry } = fixture();
  await chmod(join(path, ".."), 0o777);
  await assert.rejects(() => openEvidenceLegalHoldStore(path, registry), /parent directory.*permissions|directory.*writable/i);
});

test("reopens historical events after signer key revocation without accepting later signatures", async () => {
  const path = await temporaryJournalPath();
  const { keys, registry, place, release } = fixture();
  const keyId = registry.list()[0].keyId;
  const store = await openEvidenceLegalHoldStore(path, registry);
  await store.append(place);
  await store.close();

  registry.revoke(keyId, { revokedAt: "2026-11-16T00:01:00.000Z" });
  const reopened = await openEvidenceLegalHoldStore(path, registry);
  assert.equal(reopened.verify().valid, true);
  await assert.rejects(() => reopened.append(release), /valid signed legal-hold event/);
  await reopened.close();
});

test("rejects invalid verification keys before opening an empty journal", async () => {
  const path = await temporaryJournalPath();
  await assert.rejects(() => openEvidenceLegalHoldStore(path, {}), /Invalid key object type|public key|Ed25519/i);
});
