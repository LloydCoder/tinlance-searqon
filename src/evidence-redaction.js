import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { verifyEvidenceRecord } from "./evidence.js";

export const EVIDENCE_REDACTION_MANIFEST_SCHEMA_VERSION = "1.0.0";
export const EVIDENCE_REDACTION_REASON_CODES = Object.freeze([
  "data_subject_request",
  "customer_request",
  "retention_expired",
  "incorrect_capture",
  "security_incident",
  "legal_requirement"
]);

const MANIFEST_FIELDS = new Set([
  "schemaVersion", "action", "algorithm", "keyId", "requestId", "reasonCode",
  "requestedBy", "approvedBy", "createdAt", "evidenceIds", "signature"
]);
const EVIDENCE_ID_PATTERN = /^evidence_[a-f0-9]{20}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const REQUEST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_REDACTION_EVIDENCE_IDS = 10_000;

function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  try { return new Date(value).toISOString() === value; }
  catch { return false; }
}

function privateEd25519Key(input) {
  const key = input && typeof input === "object" && input.type === "private" ? input : createPrivateKey(input);
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("An Ed25519 private key is required");
  return key;
}

function publicEd25519Key(input) {
  const key = input && typeof input === "object" && input.type === "public" ? input : createPublicKey(input);
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("An Ed25519 public key is required");
  return key;
}

function keyIdentifier(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  return "ed25519:" + createHash("sha256").update(der).digest("hex");
}

function canonicalPayload(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    action: manifest.action,
    algorithm: manifest.algorithm,
    keyId: manifest.keyId,
    requestId: manifest.requestId,
    reasonCode: manifest.reasonCode,
    requestedBy: manifest.requestedBy,
    approvedBy: manifest.approvedBy,
    createdAt: manifest.createdAt,
    evidenceIds: manifest.evidenceIds
  };
}

function validateManifestShape(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["invalid_manifest_shape"];
  }
  for (const field of MANIFEST_FIELDS) {
    if (!Object.hasOwn(manifest, field)) errors.push("missing_" + field);
  }
  for (const field of Object.keys(manifest)) {
    if (!MANIFEST_FIELDS.has(field)) errors.push("unexpected_" + field);
  }
  if (manifest.schemaVersion !== EVIDENCE_REDACTION_MANIFEST_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (manifest.action !== "suppress_from_exports") errors.push("invalid_action");
  if (manifest.algorithm !== "Ed25519") errors.push("invalid_algorithm");
  if (typeof manifest.keyId !== "string" || !/^ed25519:[a-f0-9]{64}$/.test(manifest.keyId)) errors.push("invalid_key_id");
  if (typeof manifest.requestId !== "string" || !REQUEST_PATTERN.test(manifest.requestId)) errors.push("invalid_request_id");
  if (!EVIDENCE_REDACTION_REASON_CODES.includes(manifest.reasonCode)) errors.push("invalid_reason_code");
  if (typeof manifest.requestedBy !== "string" || !ACTOR_PATTERN.test(manifest.requestedBy)) errors.push("invalid_requester");
  if (typeof manifest.approvedBy !== "string" || !ACTOR_PATTERN.test(manifest.approvedBy)) errors.push("invalid_approver");
  if (manifest.requestedBy === manifest.approvedBy) errors.push("requester_and_approver_must_be_different");
  if (!isCanonicalTimestamp(manifest.createdAt)) errors.push("invalid_created_at");
  if (!Array.isArray(manifest.evidenceIds) || manifest.evidenceIds.length < 1 || manifest.evidenceIds.length > MAX_REDACTION_EVIDENCE_IDS) {
    errors.push("invalid_evidence_ids");
  } else {
    const arrayKeys = Reflect.ownKeys(manifest.evidenceIds).filter(key => key !== "length");
    if (arrayKeys.length !== manifest.evidenceIds.length || arrayKeys.some((key, index) => key !== String(index))) errors.push("invalid_evidence_ids");
    if (manifest.evidenceIds.some(id => typeof id !== "string" || !EVIDENCE_ID_PATTERN.test(id))) errors.push("invalid_evidence_id");
    if (new Set(manifest.evidenceIds).size !== manifest.evidenceIds.length) errors.push("duplicate_evidence_ids");
    const sorted = [...manifest.evidenceIds].sort();
    if (sorted.some((id, index) => id !== manifest.evidenceIds[index])) errors.push("non_canonical_evidence_ids");
  }
  if (typeof manifest.signature !== "string") {
    errors.push("invalid_signature");
  } else {
    if (manifest.signature.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature)) {
      errors.push("invalid_signature_encoding");
    } else {
      const decoded = Buffer.from(manifest.signature, "base64");
      if (decoded.length !== 64 || decoded.toString("base64") !== manifest.signature) errors.push("invalid_signature_encoding");
    }
  }
  return errors;
}

export function createEvidenceRedactionManifest(input, privateKeyInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("redaction request must be an object");
  const { evidenceIds, requestId, reasonCode, requestedBy, approvedBy, createdAt } = input;
  if (!Array.isArray(evidenceIds) || evidenceIds.length < 1 || evidenceIds.length > MAX_REDACTION_EVIDENCE_IDS) throw new TypeError("evidenceIds must contain between 1 and 10000 identifiers");
  if (evidenceIds.some(id => typeof id !== "string" || !EVIDENCE_ID_PATTERN.test(id))) {
    throw new TypeError("invalid evidence identifier");
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new TypeError("evidence identifiers must be unique");
  if (typeof requestId !== "string" || !REQUEST_PATTERN.test(requestId)) throw new TypeError("requestId is invalid");
  if (!EVIDENCE_REDACTION_REASON_CODES.includes(reasonCode)) throw new TypeError("reasonCode is invalid");
  if (typeof requestedBy !== "string" || !ACTOR_PATTERN.test(requestedBy)) throw new TypeError("requestedBy is invalid");
  if (typeof approvedBy !== "string" || !ACTOR_PATTERN.test(approvedBy)) throw new TypeError("approvedBy is invalid");
  if (requestedBy === approvedBy) throw new TypeError("requester and approver must be different identities");
  if (!isCanonicalTimestamp(createdAt)) throw new TypeError("createdAt must be a canonical ISO 8601 UTC timestamp");

  const privateKey = privateEd25519Key(privateKeyInput);
  const publicKey = createPublicKey(privateKey);
  const payload = {
    schemaVersion: EVIDENCE_REDACTION_MANIFEST_SCHEMA_VERSION,
    action: "suppress_from_exports",
    algorithm: "Ed25519",
    keyId: keyIdentifier(publicKey),
    requestId,
    reasonCode,
    requestedBy,
    approvedBy,
    createdAt,
    evidenceIds: [...evidenceIds].sort()
  };
  const signature = sign(null, Buffer.from(JSON.stringify(payload), "utf8"), privateKey).toString("base64");
  return Object.freeze({ ...payload, evidenceIds: Object.freeze(payload.evidenceIds), signature });
}

export function verifyEvidenceRedactionManifest(manifest, publicKeyInput) {
  const errors = validateManifestShape(manifest);
  let publicKey;
  try {
    publicKey = publicEd25519Key(publicKeyInput);
    if (manifest && typeof manifest === "object" && manifest.keyId !== keyIdentifier(publicKey)) errors.push("public_key_id_mismatch");
  } catch {
    errors.push("invalid_public_key");
  }

  if (publicKey && errors.length === 0) {
    try {
      const validSignature = verify(
        null,
        Buffer.from(JSON.stringify(canonicalPayload(manifest)), "utf8"),
        publicKey,
        Buffer.from(manifest.signature, "base64")
      );
      if (!validSignature) errors.push("signature_verification_failed");
    } catch {
      errors.push("signature_verification_failed");
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Applies signed logical suppression to export views. Source ledger entries
 * are not modified or deleted; physical deletion is a separate storage duty.
 */
export function filterEvidenceByRedaction(records, manifests, publicKeyInput) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  if (!Array.isArray(manifests)) throw new TypeError("manifests must be an array");

  const recordIds = new Set();
  for (const record of records) {
    const validation = verifyEvidenceRecord(record);
    if (!validation.valid) throw new TypeError("invalid evidence record: " + validation.errors.join(", "));
    if (recordIds.has(record.id)) throw new Error("duplicate evidence identifier: " + record.id);
    recordIds.add(record.id);
  }

  const suppressed = new Set();
  const requestIds = new Set();
  for (const manifest of manifests) {
    const validation = verifyEvidenceRedactionManifest(manifest, publicKeyInput);
    if (!validation.valid) throw new Error("invalid redaction manifest: " + validation.errors.join(", "));
    if (requestIds.has(manifest.requestId)) throw new Error("duplicate redaction request identifier: " + manifest.requestId);
    requestIds.add(manifest.requestId);
    for (const id of manifest.evidenceIds) suppressed.add(id);
  }

  const suppressedEvidenceIds = [...suppressed].filter(id => recordIds.has(id)).sort();
  const suppressedSet = new Set(suppressedEvidenceIds);
  const visibleRecords = records.filter(record => !suppressedSet.has(record.id));
  return Object.freeze({
    visibleRecords: Object.freeze(visibleRecords),
    suppressedEvidenceIds: Object.freeze(suppressedEvidenceIds),
    counts: Object.freeze({
      input: records.length,
      visible: visibleRecords.length,
      suppressed: suppressedEvidenceIds.length
    })
  });
}
