import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceLegalHoldEvent } from "../src/evidence-legal-holds.js";
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
  assert.deepEqual(result.counts, { evaluated: 2, eligibleForPurge: 1, retained: 1, held: 0 });
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

test("active legal holds override retention expiry and keep evidence out of purge eligibility", () => {
  const keys = generateKeyPairSync("ed25519");
  const expired = evidence("held-expired", "2026-01-01T00:00:00.000Z");
  const hold = createEvidenceLegalHoldEvent({
    holdId: "HOLD-RETENTION-01",
    sequence: 1,
    action: "place",
    evidenceIds: [expired.id],
    requestId: "HOLD-RETENTION-REQUEST",
    reasonCode: "litigation",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-16T00:00:00.000Z"
  }, keys.privateKey);

  const result = evaluateEvidenceRetention([expired], {
    retentionDays: 30,
    now: "2026-11-16T00:00:00.000Z",
    legalHoldEvents: [hold],
    legalHoldPublicKey: keys.publicKey
  });

  assert.deepEqual(result.eligibleForPurge, []);
  assert.equal(result.held.length, 1);
  assert.equal(result.held[0].evidenceId, expired.id);
  assert.equal(result.counts.held, 1);
  assert.equal(result.counts.retained, 1);
});

test("released legal holds no longer block otherwise eligible evidence", () => {
  const keys = generateKeyPairSync("ed25519");
  const expired = evidence("released-expired", "2026-01-01T00:00:00.000Z");
  const input = {
    holdId: "HOLD-RETENTION-02",
    evidenceIds: [expired.id],
    reasonCode: "regulatory",
    requestedBy: "requester-02",
    approvedBy: "approver-02"
  };
  const place = createEvidenceLegalHoldEvent({
    ...input,
    sequence: 1,
    action: "place",
    requestId: "HOLD-RETENTION-PLACE",
    createdAt: "2026-11-16T00:00:00.000Z"
  }, keys.privateKey);
  const release = createEvidenceLegalHoldEvent({
    ...input,
    sequence: 2,
    action: "release",
    requestId: "HOLD-RETENTION-RELEASE",
    createdAt: "2026-11-17T00:00:00.000Z"
  }, keys.privateKey);

  const result = evaluateEvidenceRetention([expired], {
    retentionDays: 30,
    now: "2026-11-18T00:00:00.000Z",
    legalHoldEvents: [place, release],
    legalHoldPublicKey: keys.publicKey
  });

  assert.equal(result.eligibleForPurge.length, 1);
  assert.deepEqual(result.held, []);
});

test("invalid or untrusted legal-hold events fail retention evaluation closed", () => {
  const keys = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const expired = evidence("invalid-hold", "2026-01-01T00:00:00.000Z");
  const hold = createEvidenceLegalHoldEvent({
    holdId: "HOLD-RETENTION-03",
    sequence: 1,
    action: "place",
    evidenceIds: [expired.id],
    requestId: "HOLD-RETENTION-INVALID",
    reasonCode: "investigation",
    requestedBy: "requester-03",
    approvedBy: "approver-03",
    createdAt: "2026-11-16T00:00:00.000Z"
  }, keys.privateKey);

  assert.throws(() => evaluateEvidenceRetention([expired], {
    retentionDays: 30,
    now: "2026-11-16T00:00:00.000Z",
    legalHoldEvents: [hold],
    legalHoldPublicKey: other.publicKey
  }), /invalid legal-hold event/);
  assert.throws(() => evaluateEvidenceRetention([expired], {
    retentionDays: 30,
    now: "2026-11-16T00:00:00.000Z",
    legalHoldEvents: [hold]
  }), /invalid legal-hold event/);
});

test("rejects ambiguous retention hold verification configuration", () => {
  const keys = generateKeyPairSync("ed25519");
  const registry = {};
  assert.throws(() => evaluateEvidenceRetention([], {
    retentionDays: 30,
    now: "2026-11-16T00:00:00.000Z",
    legalHoldPublicKey: keys.publicKey,
    legalHoldApproverRegistry: registry
  }), /provide legalHoldPublicKey or legalHoldApproverRegistry/);
});
