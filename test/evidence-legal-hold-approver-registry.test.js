import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  createEvidenceLegalHoldEvent,
  deriveActiveEvidenceHolds,
  EvidenceLegalHoldApproverRegistry
} from "../src/evidence-legal-holds.js";

function createEvent(keys, input = {}) {
  return createEvidenceLegalHoldEvent({
    holdId: "HOLD-IDENTITY-01",
    sequence: 1,
    action: "place",
    evidenceIds: ["evidence_0123456789abcdefabcd"],
    requestId: "HOLD-IDENTITY-REQUEST-01",
    reasonCode: "regulatory",
    requestedBy: "requester-01",
    approvedBy: "approver-01",
    createdAt: "2026-11-16T00:00:00.000Z",
    ...input
  }, keys.privateKey);
}

test("approver registry binds the signing key to the approvedBy actor", () => {
  const keys = generateKeyPairSync("ed25519");
  const registry = new EvidenceLegalHoldApproverRegistry();
  const keyId = registry.register({ actorId: "approver-01", publicKey: keys.publicKey });
  const hold = createEvent(keys);
  const state = deriveActiveEvidenceHolds([hold], registry);

  assert.equal(state.activeEvidenceIds.length, 1);
  assert.equal(registry.list()[0].keyId, keyId);
  assert.equal(registry.list()[0].actorId, "approver-01");
});

test("rejects a valid signature when the key is registered to a different approver", () => {
  const keys = generateKeyPairSync("ed25519");
  const registry = new EvidenceLegalHoldApproverRegistry();
  registry.register({ actorId: "different-approver", publicKey: keys.publicKey });
  const hold = createEvent(keys);

  assert.throws(() => deriveActiveEvidenceHolds([hold], registry), /approver_identity_mismatch/);
});

test("revoked approver keys fail closed", () => {
  const keys = generateKeyPairSync("ed25519");
  const registry = new EvidenceLegalHoldApproverRegistry();
  const keyId = registry.register({ actorId: "approver-01", publicKey: keys.publicKey });
  registry.revoke(keyId);

  assert.throws(() => deriveActiveEvidenceHolds([createEvent(keys)], registry), /approver_key_revoked/);
});

test("supports explicit key rotation for one approver across a hold lifecycle", () => {
  const first = generateKeyPairSync("ed25519");
  const second = generateKeyPairSync("ed25519");
  const registry = new EvidenceLegalHoldApproverRegistry();
  registry.register({ actorId: "approver-01", publicKey: first.publicKey });
  registry.register({ actorId: "approver-01", publicKey: second.publicKey });

  const place = createEvent(first);
  const release = createEvent(second, {
    sequence: 2,
    action: "release",
    requestId: "HOLD-IDENTITY-RELEASE-01",
    createdAt: "2026-11-17T00:00:00.000Z"
  });

  assert.deepEqual(deriveActiveEvidenceHolds([place, release], registry).activeEvidenceIds, []);
});

test("prevents assigning one signing key to two different actors", () => {
  const keys = generateKeyPairSync("ed25519");
  const registry = new EvidenceLegalHoldApproverRegistry();
  registry.register({ actorId: "approver-01", publicKey: keys.publicKey });
  assert.throws(
    () => registry.register({ actorId: "approver-02", publicKey: keys.publicKey }),
    /already registered/
  );
});

test("registry listing is immutable and never exposes public key material", () => {
  const keys = generateKeyPairSync("ed25519");
  const registry = new EvidenceLegalHoldApproverRegistry();
  registry.register({ actorId: "approver-01", publicKey: keys.publicKey });
  const listing = registry.list();

  assert.equal(Object.isFrozen(listing), true);
  assert.equal(Object.isFrozen(listing[0]), true);
  assert.deepEqual(Object.keys(listing[0]).sort(), ["active", "actorId", "keyId"]);
});
