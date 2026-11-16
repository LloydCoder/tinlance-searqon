import test from "node:test";
import assert from "node:assert/strict";
import { createEvidenceRecord } from "../src/evidence.js";
import { evaluateEvidenceRetention, EVIDENCE_RETENTION_POLICY_VERSION } from "../src/evidence-retention.js";

function evidence(id, collectedAt) {
  return createEvidenceRecord({ source: id + ".example", content: id, contentType: "text/plain", collectedAt });
}

test("evaluates expired and retained evidence against an explicit UTC clock", () => {
  const old = evidence("old", "2026-01-01T00:00:00.000Z");
  const recent = evidence("recent", "2026-11-15T00:00:00.000Z");
  const result = evaluateEvidenceRetention([old, recent], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" });

  assert.equal(result.policyVersion, EVIDENCE_RETENTION_POLICY_VERSION);
  assert.deepEqual(result.eligibleForPurge, [{
    evidenceId: old.id,
    collectedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-31T00:00:00.000Z"
  }]);
  assert.deepEqual(result.retained, [{
    evidenceId: recent.id,
    collectedAt: "2026-11-15T00:00:00.000Z",
    expiresAt: "2026-12-15T00:00:00.000Z"
  }]);
  assert.deepEqual(result.counts, { evaluated: 2, eligibleForPurge: 1, retained: 1 });
});

test("treats the exact expiry instant as eligible and future evidence as retained", () => {
  const expiresNow = evidence("expires-now", "2026-10-17T00:00:00.000Z");
  const future = evidence("future", "2026-12-01T00:00:00.000Z");
  const result = evaluateEvidenceRetention([expiresNow, future], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" });

  assert.equal(result.eligibleForPurge[0].evidenceId, expiresNow.id);
  assert.equal(result.retained[0].evidenceId, future.id);
});

test("rejects duplicate evidence identifiers instead of double-counting records", () => {
  const duplicate = evidence("duplicate", "2026-01-01T00:00:00.000Z");
  assert.throws(() => evaluateEvidenceRetention([duplicate, duplicate], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" }), /duplicate evidence identifier/);
});

test("rejects invalid policy values, timestamps and evidence records", () => {
  assert.throws(() => evaluateEvidenceRetention([], { retentionDays: 0, now: "2026-11-16T00:00:00.000Z" }), /retentionDays/);
  assert.throws(() => evaluateEvidenceRetention([], { retentionDays: 30, now: "2026-11-16" }), /canonical ISO 8601 UTC timestamp/);
  assert.throws(() => evaluateEvidenceRetention([{ id: "bad", collectedAt: "yesterday" }], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" }), /invalid evidence record/);
  assert.throws(() => evaluateEvidenceRetention([{ collectedAt: "2026-01-01T00:00:00.000Z" }], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" }), /invalid evidence record/);
});

test("returns immutable metadata only and never mutates or deletes source records", () => {
  const expired = evidence("expired", "2026-01-01T00:00:00.000Z");
  const input = [expired];
  const before = structuredClone(input);
  const result = evaluateEvidenceRetention(input, { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" });

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.eligibleForPurge), true);
  assert.equal(Object.isFrozen(result.eligibleForPurge[0]), true);
  assert.equal(Object.hasOwn(result.eligibleForPurge[0], "source"), false);
  assert.equal(result.eligibleForPurge[0].evidenceId, expired.id);
});

test("rejects retention intervals beyond the supported policy bound", () => {
  assert.throws(() => evaluateEvidenceRetention([], {
    retentionDays: 36501,
    now: "2026-11-16T00:00:00.000Z"
  }), /retentionDays/);
});
