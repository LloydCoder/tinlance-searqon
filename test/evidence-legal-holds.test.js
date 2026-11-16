import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceLegalHoldEvent, deriveActiveEvidenceHolds } from "../src/evidence-legal-holds.js";

function event(keys, input) {
  return createEvidenceLegalHoldEvent({
    holdId: "HOLD-2026-01",
    sequence: 1,
    action: "place",
    evidenceIds: ["evidence_0123456789abcdefabcd"],
    requestId: "HOLD-REQUEST-01",
    reasonCode: "litigation",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-16T00:00:00.000Z",
    ...input
  }, keys.privateKey);
}

test("creates and verifies signed legal-hold events with canonical evidence IDs", () => {
  const keys = generateKeyPairSync("ed25519");
  const hold = event(keys, { evidenceIds: [
    "evidence_ffffffffffffffffffff",
    "evidence_0123456789abcdefabcd"
  ] });
  const state = deriveActiveEvidenceHolds([hold], keys.publicKey);
  assert.equal(state.activeEvidenceIds.length, 2);
  assert.deepEqual(hold.evidenceIds, [...hold.evidenceIds].sort());
  assert.equal(state.activeHolds[0].holdId, "HOLD-2026-01");
});

test("release events must follow a matching active hold and exact scope", () => {
  const keys = generateKeyPairSync("ed25519");
  const place = event(keys);
  const release = event(keys, {
    sequence: 2,
    action: "release",
    requestId: "HOLD-RELEASE-01",
    createdAt: "2026-11-17T00:00:00.000Z"
  });
  const state = deriveActiveEvidenceHolds([place, release], keys.publicKey);
  assert.deepEqual(state.activeEvidenceIds, []);
  assert.deepEqual(state.activeHolds, []);
});

test("rejects release without a prior placement, sequence gaps and scope changes", () => {
  const keys = generateKeyPairSync("ed25519");
  const release = event(keys, { action: "release" });
  assert.throws(() => deriveActiveEvidenceHolds([release], keys.publicKey), /first event must place/);

  const place = event(keys);
  const gap = event(keys, { sequence: 3, action: "release", requestId: "HOLD-RELEASE-02" });
  assert.throws(() => deriveActiveEvidenceHolds([place, gap], keys.publicKey), /sequence/);

  const changedScope = event(keys, {
    sequence: 2,
    action: "release",
    requestId: "HOLD-RELEASE-03",
    evidenceIds: ["evidence_ffffffffffffffffffff"]
  });
  assert.throws(() => deriveActiveEvidenceHolds([place, changedScope], keys.publicKey), /scope/);
});

test("rejects invalid signatures, duplicate request IDs and non-monotonic event times", () => {
  const keys = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const place = event(keys);
  assert.throws(() => deriveActiveEvidenceHolds([place], other.publicKey), /invalid legal-hold event/);

  const duplicate = event(keys, { sequence: 2, action: "release" });
  assert.throws(() => deriveActiveEvidenceHolds([place, duplicate], keys.publicKey), /request identifier/);

  const backwards = event(keys, {
    sequence: 2,
    action: "release",
    requestId: "HOLD-RELEASE-04",
    createdAt: "2026-11-15T00:00:00.000Z"
  });
  assert.throws(() => deriveActiveEvidenceHolds([place, backwards], keys.publicKey), /timestamp/);
});

test("rejects malformed IDs, actors, reason codes and same-person approval", () => {
  const keys = generateKeyPairSync("ed25519");
  assert.throws(() => event(keys, { evidenceIds: ["not-an-evidence-id"] }), /evidence ID/);
  assert.throws(() => event(keys, { reasonCode: "free_text" }), /reasonCode/);
  assert.throws(() => event(keys, { requestedBy: "same", approvedBy: "same" }), /different/);
  assert.throws(() => event(keys, { createdAt: "2026-11-16" }), /canonical/);
});

test("requires explicit event arrays and a trusted verification key for non-empty holds", () => {
  const keys = generateKeyPairSync("ed25519");
  const hold = event(keys);
  assert.throws(() => deriveActiveEvidenceHolds(hold, keys.publicKey), /array/);
  assert.throws(() => deriveActiveEvidenceHolds([hold]), /invalid_public_key/);
});
