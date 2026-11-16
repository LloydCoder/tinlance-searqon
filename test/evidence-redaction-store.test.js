import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmod, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceRecord } from "../src/evidence.js";
import { createEvidenceRedactionManifest } from "../src/evidence-redaction.js";
import { openEvidenceRedactionStore } from "../src/evidence-redaction-store.js";

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function temporaryJournalPath() {
  const directory = await mkdtemp(join(tmpdir(), "searqon-redaction-"));
  directories.push(directory);
  return join(directory, "redaction-journal.jsonl");
}

function createManifest(keys, label, requestId = "REQ-" + label) {
  const record = createEvidenceRecord({
    source: label + ".example",
    content: "redaction:" + label,
    contentType: "text/plain",
    collectedAt: "2026-11-16T00:00:00.000Z"
  });
  return createEvidenceRedactionManifest({
    evidenceIds: [record.id],
    requestId,
    reasonCode: "customer_request",
    requestedBy: "requester-" + label,
    approvedBy: "approver-" + label,
    createdAt: "2026-11-16T00:01:00.000Z"
  }, keys.privateKey);
}

test("redaction journal appends, closes, reopens and verifies signed manifests", async () => {
  const path = await temporaryJournalPath();
  const keys = generateKeyPairSync("ed25519");
  const store = await openEvidenceRedactionStore(path, keys.publicKey);
  const first = await store.append(createManifest(keys, "first"));
  const second = await store.append(createManifest(keys, "second"));

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(second.previousHash, first.entryHash);
  assert.equal(store.verify().valid, true);
  assert.equal(store.listManifests().length, 2);
  await store.close();

  const reopened = await openEvidenceRedactionStore(path, keys.publicKey);
  assert.equal(reopened.list().length, 2);
  assert.equal(reopened.verify().valid, true);
  await reopened.close();
});

test("redaction journal serializes concurrent appends and rejects duplicate request IDs", async () => {
  const path = await temporaryJournalPath();
  const keys = generateKeyPairSync("ed25519");
  const store = await openEvidenceRedactionStore(path, keys.publicKey);
  await Promise.all(["one", "two", "three", "four"].map(label => store.append(createManifest(keys, label))));
  assert.deepEqual(store.list().map(entry => entry.sequence), [1, 2, 3, 4]);
  await assert.rejects(() => store.append(createManifest(keys, "duplicate", "REQ-one")), /duplicate request identifier/);
  assert.equal(store.verify().valid, true);
  await store.close();
});

test("redaction journal refuses invalid signatures and tampered files", async () => {
  const path = await temporaryJournalPath();
  const keys = generateKeyPairSync("ed25519");
  const store = await openEvidenceRedactionStore(path, keys.publicKey);
  const manifest = createManifest(keys, "tamper");
  await assert.rejects(() => store.append({ ...manifest, reasonCode: "legal_requirement" }), /valid signed redaction manifest/);
  await store.append(manifest);
  await store.close();

  const original = await readFile(path, "utf8");
  const altered = original.replace("customer_request", "legal_requirement");
  await writeFile(path, altered, "utf8");
  await assert.rejects(() => openEvidenceRedactionStore(path, keys.publicKey), /integrity verification failed/);
});

test("redaction journal rejects truncated lines and oversized entries", async () => {
  const path = await temporaryJournalPath();
  const keys = generateKeyPairSync("ed25519");
  const store = await openEvidenceRedactionStore(path, keys.publicKey);
  await store.append(createManifest(keys, "truncate"));
  await store.close();
  await writeFile(path, await readFile(path, "utf8") + "{", "utf8");
  await assert.rejects(() => openEvidenceRedactionStore(path, keys.publicKey), /truncated|invalid/i);
});

test("redaction journal creates owner-only files", async () => {
  const path = await temporaryJournalPath();
  const keys = generateKeyPairSync("ed25519");
  const store = await openEvidenceRedactionStore(path, keys.publicKey);
  await store.append(createManifest(keys, "permissions"));
  await store.close();
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("redaction journal rejects a second writer for the same path", async () => {
  const path = await temporaryJournalPath();
  const keys = generateKeyPairSync("ed25519");
  const first = await openEvidenceRedactionStore(path, keys.publicKey);
  await assert.rejects(() => openEvidenceRedactionStore(path, keys.publicKey), /already open/);
  await first.close();
});

test("redaction journal closes admission immediately and drains accepted writes", async () => {
  const path = await temporaryJournalPath();
  const keys = generateKeyPairSync("ed25519");
  const store = await openEvidenceRedactionStore(path, keys.publicKey);
  const accepted = store.append(createManifest(keys, "accepted"));
  const closing = store.close();
  await assert.rejects(() => store.append(createManifest(keys, "rejected")), /closed/);
  await accepted;
  await closing;
  const reopened = await openEvidenceRedactionStore(path, keys.publicKey);
  assert.equal(reopened.list().length, 1);
  await reopened.close();
});

test("redaction journal refuses symbolic-link and hard-linked targets", async t => {
  if (process.platform === "win32") return t.skip("hard-link ownership semantics are platform-specific");
  const path = await temporaryJournalPath();
  const target = path + ".target";
  await writeFile(target, "", "utf8");
  await symlink(target, path);
  const keys = generateKeyPairSync("ed25519");
  await assert.rejects(() => openEvidenceRedactionStore(path, keys.publicKey));

  const hardPath = path + ".hard";
  await link(target, hardPath);
  await assert.rejects(() => openEvidenceRedactionStore(hardPath, keys.publicKey), /hard link|multiple links/i);
});

test("redaction journal rejects group- or world-writable parent directories", async () => {
  const path = await temporaryJournalPath();
  const keys = generateKeyPairSync("ed25519");
  await chmod(join(path, ".."), 0o777);
  await assert.rejects(() => openEvidenceRedactionStore(path, keys.publicKey), /parent directory.*permissions|directory.*writable/i);
});
