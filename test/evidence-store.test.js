import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmod, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceRecord } from "../src/evidence.js";
import { openEvidenceLedgerStore } from "../src/evidence-store.js";

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function temporaryLedgerPath() {
  const directory = await mkdtemp(join(tmpdir(), "searqon-evidence-"));
  directories.push(directory);
  return join(directory, "evidence-ledger.jsonl");
}

function record(value) {
  return createEvidenceRecord({
    source: "fixture.html",
    content: value,
    contentType: "text/html",
    collectedAt: "2026-11-14T00:00:00.000Z"
  });
}

test("persistent evidence ledger appends, closes, reopens, and verifies entries", async () => {
  const path = await temporaryLedgerPath();
  const store = await openEvidenceLedgerStore(path);
  const first = await store.append(record("first"));
  const second = await store.append(record("second"));
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(second.previousHash, first.entryHash);
  assert.equal(store.verify().valid, true);
  await store.close();

  const reopened = await openEvidenceLedgerStore(path);
  assert.equal(reopened.list().length, 2);
  assert.equal(reopened.verify().valid, true);
  await reopened.close();
});

test("persistent evidence ledger creates owner-only files", async () => {
  const path = await temporaryLedgerPath();
  const store = await openEvidenceLedgerStore(path);
  await store.append(record("private metadata"));
  await store.close();
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("persistent evidence ledger serializes concurrent appends in one process", async () => {
  const path = await temporaryLedgerPath();
  const store = await openEvidenceLedgerStore(path);
  await Promise.all(["one", "two", "three", "four"].map(value => store.append(record(value))));
  const entries = store.list();
  assert.deepEqual(entries.map(entry => entry.sequence), [1, 2, 3, 4]);
  assert.equal(store.verify().valid, true);
  await store.close();
});

test("persistent evidence ledger rejects a second writer for the same path", async () => {
  const path = await temporaryLedgerPath();
  const first = await openEvidenceLedgerStore(path);
  await assert.rejects(() => openEvidenceLedgerStore(path), /already open/);
  await first.close();
});

test("persistent evidence ledger refuses corrupted or truncated files on reopen", async () => {
  const path = await temporaryLedgerPath();
  const store = await openEvidenceLedgerStore(path);
  await store.append(record("first"));
  await store.close();
  await writeFile(path, await readFile(path, "utf8") + "{truncated", "utf8");
  await assert.rejects(() => openEvidenceLedgerStore(path), /corrupt|integrity|truncated/i);
});

test("persistent evidence ledger rejects appends after close", async () => {
  const path = await temporaryLedgerPath();
  const store = await openEvidenceLedgerStore(path);
  await store.close();
  await assert.rejects(() => store.append(record("late")), /closed/);
});


test("persistent evidence ledger closes append admission immediately and drains accepted writes", async () => {
  const path = await temporaryLedgerPath();
  const store = await openEvidenceLedgerStore(path);
  const accepted = store.append(record("accepted before close"));
  const closing = store.close();
  await assert.rejects(() => store.append(record("submitted after close began")), /closed/);
  await accepted;
  await closing;
  const reopened = await openEvidenceLedgerStore(path);
  assert.equal(reopened.list().length, 1);
  await reopened.close();
});

test("persistent evidence ledger refuses symbolic-link targets", async () => {
  const path = await temporaryLedgerPath();
  const target = path + ".target";
  await writeFile(target, "", "utf8");
  await symlink(target, path);
  await assert.rejects(() => openEvidenceLedgerStore(path));
});


test("persistent evidence ledger refuses hard-linked targets", async t => {
  if (process.platform === "win32") return t.skip("hard-link ownership semantics are platform-specific");
  const path = await temporaryLedgerPath();
  const target = path + ".target";
  await writeFile(target, "", "utf8");
  await link(target, path);
  await assert.rejects(() => openEvidenceLedgerStore(path), /hard link|multiple links/i);
});


test("persistent evidence ledger rejects group- or world-writable parent directories", async () => {
  const path = await temporaryLedgerPath();
  const directory = join(path, "..");
  await chmod(directory, 0o777);
  await assert.rejects(() => openEvidenceLedgerStore(path), /parent directory.*permissions|directory.*writable/i);
});
