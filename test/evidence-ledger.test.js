import test from "node:test";
import assert from "node:assert/strict";
import { createEvidenceRecord } from "../src/evidence.js";
import {
  createEvidenceLedgerEntry,
  verifyEvidenceLedgerEntry,
  verifyEvidenceLedger
} from "../src/evidence-ledger.js";

function fixtureRecord(content = "ledger payload") {
  return createEvidenceRecord({
    source: "fixture.html",
    content,
    contentType: "text/html",
    collectedAt: "2026-11-14T00:00:00.000Z"
  });
}

test("evidence ledger creates and verifies a genesis entry", () => {
  const entry = createEvidenceLedgerEntry(fixtureRecord(), { sequence: 1 });
  assert.equal(entry.previousHash, null);
  assert.equal(entry.sequence, 1);
  assert.equal(verifyEvidenceLedgerEntry(entry).valid, true);
  assert.equal(verifyEvidenceLedger([entry]).valid, true);
});

test("evidence ledger links sequential entries through the previous entry hash", () => {
  const first = createEvidenceLedgerEntry(fixtureRecord("first"), { sequence: 1 });
  const second = createEvidenceLedgerEntry(fixtureRecord("second"), {
    sequence: 2,
    previousHash: first.entryHash,
    createdAt: "2026-11-14T00:01:00.000Z"
  });
  const ledger = verifyEvidenceLedger([first, second]);
  assert.equal(ledger.valid, true);
  assert.deepEqual(ledger.errors, []);
});

test("evidence ledger detects metadata tampering even when the evidence ID is unchanged", () => {
  const entry = createEvidenceLedgerEntry(fixtureRecord(), { sequence: 1 });
  const tampered = {
    ...entry,
    record: { ...entry.record, collectedAt: "2026-11-15T00:00:00.000Z" }
  };
  assert.equal(verifyEvidenceLedgerEntry(tampered).valid, false);
  assert.equal(verifyEvidenceLedger([tampered]).valid, false);
});

test("evidence ledger detects broken links, reordered entries, and missing entries", () => {
  const first = createEvidenceLedgerEntry(fixtureRecord("first"), { sequence: 1 });
  const second = createEvidenceLedgerEntry(fixtureRecord("second"), {
    sequence: 2,
    previousHash: first.entryHash,
    createdAt: "2026-11-14T00:01:00.000Z"
  });
  assert.equal(verifyEvidenceLedger([first, { ...second, previousHash: "0".repeat(64) }]).valid, false);
  assert.equal(verifyEvidenceLedger([second, first]).valid, false);
  assert.equal(verifyEvidenceLedger([second]).valid, false);
});

test("evidence ledger refuses malformed records and invalid sequence metadata", () => {
  assert.throws(() => createEvidenceLedgerEntry({ invalid: true }, { sequence: 1 }), /valid evidence record/);
  assert.throws(() => createEvidenceLedgerEntry(fixtureRecord(), { sequence: 2 }), /previousHash/);
  assert.throws(() => createEvidenceLedgerEntry(fixtureRecord(), { sequence: 1, previousHash: "0".repeat(64) }), /previousHash/);
});
