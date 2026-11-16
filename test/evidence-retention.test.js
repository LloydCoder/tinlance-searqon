import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidenceRetention, EVIDENCE_RETENTION_POLICY_VERSION } from "../src/evidence-retention.js";

function evidence(id, collectedAt) {
  return { id, collectedAt, source: "private-source.example" };
}

test("evaluates expired and retained evidence against an explicit UTC clock", () => {
  const result = evaluateEvidenceRetention([
    evidence("old", "2026-01-01T00:00:00.000Z"),
    evidence("recent", "2026-11-15T00:00:00.000Z")
  ], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" });

  assert.equal(result.policyVersion, EVIDENCE_RETENTION_POLICY_VERSION);
  assert.deepEqual(result.eligibleForPurge, [{
    evidenceId: "old",
    collectedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-31T00:00:00.000Z"
  }]);
  assert.deepEqual(result.retained, [{
    evidenceId: "recent",
    collectedAt: "2026-11-15T00:00:00.000Z",
    expiresAt: "2026-12-15T00:00:00.000Z"
  }]);
  assert.deepEqual(result.counts, { evaluated: 2, eligibleForPurge: 1, retained: 1 });
});

test("treats the exact expiry instant as eligible and future evidence as retained", () => {
  const result = evaluateEvidenceRetention([
    evidence("expires-now", "2026-10-17T00:00:00.000Z"),
    evidence("future", "2026-12-01T00:00:00.000Z")
  ], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" });

  assert.equal(result.eligibleForPurge[0].evidenceId, "expires-now");
  assert.equal(result.retained[0].evidenceId, "future");
});

test("rejects duplicate evidence identifiers instead of double-counting records", () => {
  assert.throws(() => evaluateEvidenceRetention([
    evidence("duplicate", "2026-01-01T00:00:00.000Z"),
    evidence("duplicate", "2026-01-02T00:00:00.000Z")
  ], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" }), /duplicate evidence identifier/);
});

test("rejects invalid policy values, timestamps and evidence records", () => {
  assert.throws(() => evaluateEvidenceRetention([], { retentionDays: 0, now: "2026-11-16T00:00:00.000Z" }), /retentionDays/);
  assert.throws(() => evaluateEvidenceRetention([], { retentionDays: 30, now: "2026-11-16" }), /canonical ISO 8601 UTC timestamp/);
  assert.throws(() => evaluateEvidenceRetention([evidence("bad", "yesterday")], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" }), /collectedAt/);
  assert.throws(() => evaluateEvidenceRetention([{ collectedAt: "2026-01-01T00:00:00.000Z" }], { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" }), /evidence id/);
});

test("returns immutable metadata only and never mutates or deletes source records", () => {
  const input = [evidence("expired", "2026-01-01T00:00:00.000Z")];
  const before = structuredClone(input);
  const result = evaluateEvidenceRetention(input, { retentionDays: 30, now: "2026-11-16T00:00:00.000Z" });

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.eligibleForPurge), true);
  assert.equal(Object.isFrozen(result.eligibleForPurge[0]), true);
  assert.equal(Object.hasOwn(result.eligibleForPurge[0], "source"), false);
  assert.equal(result.eligibleForPurge[0].evidenceId, "expired");
});

test("rejects expiry arithmetic outside the supported ISO timestamp range", () => {
  assert.throws(() => evaluateEvidenceRetention(
    [evidence("far-future", "9999-12-31T00:00:00.000Z")],
    { retentionDays: 36500, now: "2026-11-16T00:00:00.000Z" }
  ), /expiry timestamp/);
});
