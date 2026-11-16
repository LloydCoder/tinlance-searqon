import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceRecord } from "../src/evidence.js";
import {
  createEvidenceRedactionManifest,
  verifyEvidenceRedactionManifest,
  filterEvidenceByRedaction
} from "../src/evidence-redaction.js";

function evidence(label) {
  return createEvidenceRecord({
    source: label + ".example",
    content: "evidence:" + label,
    contentType: "text/plain",
    collectedAt: "2026-11-15T00:00:00.000Z"
  });
}

function request(evidenceIds) {
  return {
    evidenceIds,
    requestId: "REQ-2026-001",
    reasonCode: "customer_request",
    requestedBy: "user-requester-01",
    approvedBy: "user-approver-02",
    createdAt: "2026-11-16T00:00:00.000Z"
  };
}

test("creates and verifies a signed redaction manifest with canonical evidence IDs", () => {
  const keys = generateKeyPairSync("ed25519");
  const first = evidence("first");
  const second = evidence("second");
  const manifest = createEvidenceRedactionManifest(request([second.id, first.id]), keys.privateKey);

  assert.equal(manifest.schemaVersion, "1.0.0");
  assert.equal(manifest.action, "suppress_from_exports");
  assert.deepEqual(manifest.evidenceIds, [first.id, second.id].sort());
  assert.equal(manifest.algorithm, "Ed25519");
  assert.equal(verifyEvidenceRedactionManifest(manifest, keys.publicKey).valid, true);
  assert.deepEqual(verifyEvidenceRedactionManifest(manifest, keys.publicKey).errors, []);
});

test("redaction manifests are deterministic for identical input and key", () => {
  const keys = generateKeyPairSync("ed25519");
  const record = evidence("deterministic");
  const input = request([record.id]);
  const one = createEvidenceRedactionManifest(input, keys.privateKey);
  const two = createEvidenceRedactionManifest(input, keys.privateKey);
  assert.deepEqual(one, two);
});

test("rejects invalid identities, reason codes, duplicate IDs and same-person approval", () => {
  const keys = generateKeyPairSync("ed25519");
  const record = evidence("invalid");
  assert.throws(() => createEvidenceRedactionManifest({ ...request([record.id]), approvedBy: "user-requester-01" }, keys.privateKey), /different identities/);
  assert.throws(() => createEvidenceRedactionManifest({ ...request([record.id]), reasonCode: "free-form personal details" }, keys.privateKey), /reasonCode/);
  assert.throws(() => createEvidenceRedactionManifest(request([record.id, record.id]), keys.privateKey), /unique/);
  assert.throws(() => createEvidenceRedactionManifest(request(["not-an-evidence-id"]), keys.privateKey), /evidence identifier/);
});

test("rejects invalid keys and non-canonical timestamps", () => {
  const keys = generateKeyPairSync("ed25519");
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const record = evidence("keys");
  assert.throws(() => createEvidenceRedactionManifest(request([record.id]), rsa.privateKey), /Ed25519/);
  assert.throws(() => createEvidenceRedactionManifest({ ...request([record.id]), createdAt: "2026-11-16" }, keys.privateKey), /canonical ISO 8601 UTC timestamp/);
});

test("verification detects altered manifest fields and a mismatched public key", () => {
  const keys = generateKeyPairSync("ed25519");
  const other = generateKeyPairSync("ed25519");
  const record = evidence("tamper");
  const manifest = createEvidenceRedactionManifest(request([record.id]), keys.privateKey);

  assert.equal(verifyEvidenceRedactionManifest({ ...manifest, reasonCode: "legal_requirement" }, keys.publicKey).valid, false);
  assert.equal(verifyEvidenceRedactionManifest(manifest, other.publicKey).valid, false);
  assert.equal(verifyEvidenceRedactionManifest({ ...manifest, unexpected: true }, keys.publicKey).valid, false);
});

test("filters suppressed records from exports without mutating source records", () => {
  const keys = generateKeyPairSync("ed25519");
  const privateRecord = evidence("private");
  const publicRecord = evidence("public");
  const records = [privateRecord, publicRecord];
  const before = structuredClone(records);
  const manifest = createEvidenceRedactionManifest(request([privateRecord.id]), keys.privateKey);

  const result = filterEvidenceByRedaction(records, [manifest], keys.publicKey);

  assert.deepEqual(result.visibleRecords, [publicRecord]);
  assert.deepEqual(result.suppressedEvidenceIds, [privateRecord.id]);
  assert.deepEqual(result.counts, { input: 2, visible: 1, suppressed: 1 });
  assert.deepEqual(records, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.visibleRecords), true);
});

test("refuses to apply an invalid or unverifiable redaction manifest", () => {
  const keys = generateKeyPairSync("ed25519");
  const record = evidence("invalid-manifest");
  const manifest = createEvidenceRedactionManifest(request([record.id]), keys.privateKey);
  const altered = { ...manifest, evidenceIds: [] };
  assert.throws(() => filterEvidenceByRedaction([record], [altered], keys.publicKey), /invalid redaction manifest/);
});

test("empty redaction manifest list preserves all valid evidence records", () => {
  const record = evidence("unchanged");
  const result = filterEvidenceByRedaction([record], []);
  assert.deepEqual(result.visibleRecords, [record]);
  assert.deepEqual(result.suppressedEvidenceIds, []);
  assert.deepEqual(result.counts, { input: 1, visible: 1, suppressed: 0 });
});

test("bounds redaction manifest size and rejects sparse evidence identifier arrays", () => {
  const keys = generateKeyPairSync("ed25519");
  const record = evidence("bounded");
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => createEvidenceRedactionManifest({ ...request([record.id]), evidenceIds: sparse }, keys.privateKey), /invalid evidence identifier/);
  assert.throws(() => createEvidenceRedactionManifest({ ...request([record.id]), evidenceIds: Array(10001).fill(record.id) }, keys.privateKey), /between 1 and 10000/);
});
