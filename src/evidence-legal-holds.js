import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const EVIDENCE_LEGAL_HOLD_EVENT_SCHEMA_VERSION = "1.0.0";
export const EVIDENCE_LEGAL_HOLD_REASON_CODES = Object.freeze([
  "litigation",
  "regulatory",
  "investigation",
  "contractual",
  "security_incident"
]);

const EVENT_FIELDS = new Set([
  "schemaVersion", "algorithm", "keyId", "holdId", "sequence", "action",
  "requestId", "reasonCode", "requestedBy", "approvedBy", "createdAt",
  "evidenceIds", "signature"
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVIDENCE_ID_PATTERN = /^evidence_[a-f0-9]{20}$/;
const MAX_HOLD_EVIDENCE_IDS = 10_000;

function canonicalTimestamp(value) {
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
  return "ed25519:" + createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex");
}

function canonicalPayload(event) {
  return {
    schemaVersion: event.schemaVersion,
    algorithm: event.algorithm,
    keyId: event.keyId,
    holdId: event.holdId,
    sequence: event.sequence,
    action: event.action,
    requestId: event.requestId,
    reasonCode: event.reasonCode,
    requestedBy: event.requestedBy,
    approvedBy: event.approvedBy,
    createdAt: event.createdAt,
    evidenceIds: event.evidenceIds
  };
}

function validateEventShape(event) {
  const errors = [];
  if (!event || typeof event !== "object" || Array.isArray(event)) return ["invalid_event_shape"];
  for (const field of EVENT_FIELDS) if (!Object.hasOwn(event, field)) errors.push("missing_" + field);
  for (const field of Object.keys(event)) if (!EVENT_FIELDS.has(field)) errors.push("unexpected_" + field);
  if (event.schemaVersion !== EVIDENCE_LEGAL_HOLD_EVENT_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (event.algorithm !== "Ed25519") errors.push("invalid_algorithm");
  if (typeof event.keyId !== "string" || !/^ed25519:[a-f0-9]{64}$/.test(event.keyId)) errors.push("invalid_key_id");
  if (typeof event.holdId !== "string" || !ID_PATTERN.test(event.holdId)) errors.push("invalid_hold_id");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) errors.push("invalid_sequence");
  if (event.action !== "place" && event.action !== "release") errors.push("invalid_action");
  if (typeof event.requestId !== "string" || !ID_PATTERN.test(event.requestId)) errors.push("invalid_request_id");
  if (!EVIDENCE_LEGAL_HOLD_REASON_CODES.includes(event.reasonCode)) errors.push("invalid_reason_code");
  if (typeof event.requestedBy !== "string" || !ID_PATTERN.test(event.requestedBy)) errors.push("invalid_requester");
  if (typeof event.approvedBy !== "string" || !ID_PATTERN.test(event.approvedBy)) errors.push("invalid_approver");
  if (event.requestedBy === event.approvedBy) errors.push("requester_and_approver_must_be_different");
  if (!canonicalTimestamp(event.createdAt)) errors.push("invalid_created_at");
  if (!Array.isArray(event.evidenceIds) || event.evidenceIds.length < 1 || event.evidenceIds.length > MAX_HOLD_EVIDENCE_IDS) {
    errors.push("invalid_evidence_ids");
  } else {
    const keys = Reflect.ownKeys(event.evidenceIds).filter(key => key !== "length");
    if (keys.length !== event.evidenceIds.length || keys.some((key, index) => key !== String(index))) errors.push("invalid_evidence_ids");
    if (event.evidenceIds.some(id => typeof id !== "string" || !EVIDENCE_ID_PATTERN.test(id))) errors.push("invalid_evidence_id");
    if (new Set(event.evidenceIds).size !== event.evidenceIds.length) errors.push("duplicate_evidence_ids");
    const sorted = [...event.evidenceIds].sort();
    if (sorted.some((id, index) => id !== event.evidenceIds[index])) errors.push("non_canonical_evidence_ids");
  }
  if (typeof event.signature !== "string" || event.signature.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/.test(event.signature)) {
    errors.push("invalid_signature_encoding");
  } else {
    const decoded = Buffer.from(event.signature, "base64");
    if (decoded.length !== 64 || decoded.toString("base64") !== event.signature) errors.push("invalid_signature_encoding");
  }
  return errors;
}

export function createEvidenceLegalHoldEvent(input, privateKeyInput) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("legal-hold event input must be an object");
  const {
    holdId, sequence, action, evidenceIds, requestId, reasonCode,
    requestedBy, approvedBy, createdAt
  } = input;
  if (typeof holdId !== "string" || !ID_PATTERN.test(holdId)) throw new TypeError("holdId is invalid");
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("sequence must be a positive safe integer");
  if (action !== "place" && action !== "release") throw new TypeError("action must be place or release");
  if (!Array.isArray(evidenceIds) || evidenceIds.length < 1 || evidenceIds.length > MAX_HOLD_EVIDENCE_IDS) {
    throw new TypeError("evidenceIds must contain between 1 and 10000 identifiers");
  }
  const keys = Reflect.ownKeys(evidenceIds).filter(key => key !== "length");
  if (keys.length !== evidenceIds.length || keys.some((key, index) => key !== String(index)) ||
      evidenceIds.some(id => typeof id !== "string" || !EVIDENCE_ID_PATTERN.test(id))) {
    throw new TypeError("evidence ID is invalid");
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new TypeError("evidence IDs must be unique");
  if (typeof requestId !== "string" || !ID_PATTERN.test(requestId)) throw new TypeError("requestId is invalid");
  if (!EVIDENCE_LEGAL_HOLD_REASON_CODES.includes(reasonCode)) throw new TypeError("reasonCode is invalid");
  if (typeof requestedBy !== "string" || !ID_PATTERN.test(requestedBy)) throw new TypeError("requestedBy is invalid");
  if (typeof approvedBy !== "string" || !ID_PATTERN.test(approvedBy)) throw new TypeError("approvedBy is invalid");
  if (requestedBy === approvedBy) throw new TypeError("requester and approver must be different identities");
  if (!canonicalTimestamp(createdAt)) throw new TypeError("createdAt must be a canonical ISO 8601 UTC timestamp");

  const privateKey = privateEd25519Key(privateKeyInput);
  const publicKey = createPublicKey(privateKey);
  const payload = {
    schemaVersion: EVIDENCE_LEGAL_HOLD_EVENT_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId: keyIdentifier(publicKey),
    holdId,
    sequence,
    action,
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

export function verifyEvidenceLegalHoldEvent(event, publicKeyInput) {
  const errors = validateEventShape(event);
  let publicKey;
  try {
    publicKey = publicEd25519Key(publicKeyInput);
    if (event && typeof event === "object" && event.keyId !== keyIdentifier(publicKey)) errors.push("public_key_id_mismatch");
  } catch {
    errors.push("invalid_public_key");
  }
  if (publicKey && errors.length === 0) {
    try {
      if (!verify(null, Buffer.from(JSON.stringify(canonicalPayload(event)), "utf8"), publicKey, Buffer.from(event.signature, "base64"))) {
        errors.push("signature_verification_failed");
      }
    } catch {
      errors.push("signature_verification_failed");
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

/**
 * Reconstruct current hold state from a trusted, ordered event sequence.
 * Events are signed but actor authorization still depends on caller-managed
 * key custody; this function does not authenticate human identities.
 */
export function deriveActiveEvidenceHolds(events, publicKeyInput) {
  if (!Array.isArray(events)) throw new TypeError("legal-hold events must be an array");
  if (events.length === 0) {
    return Object.freeze({
      activeEvidenceIds: Object.freeze([]),
      activeHolds: Object.freeze([])
    });
  }

  const requestIds = new Set();
  const holds = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const verification = verifyEvidenceLegalHoldEvent(event, publicKeyInput);
    if (!verification.valid) throw new TypeError("invalid legal-hold event at index " + index + ": " + verification.errors.join(", "));
    if (requestIds.has(event.requestId)) throw new Error("duplicate legal-hold request identifier");
    requestIds.add(event.requestId);

    const previous = holds.get(event.holdId);
    if (!previous) {
      if (event.sequence !== 1) throw new Error("legal-hold sequence must begin at 1");
      if (event.action !== "place") throw new Error("first event must place a legal hold");
      holds.set(event.holdId, {
        holdId: event.holdId,
        evidenceIds: [...event.evidenceIds],
        sequence: 1,
        createdAt: event.createdAt,
        active: true
      });
      continue;
    }

    if (event.sequence !== previous.sequence + 1) throw new Error("legal-hold sequence is not contiguous");
    if (event.createdAt < previous.createdAt) throw new Error("legal-hold event timestamp must be monotonic");
    if (event.evidenceIds.length !== previous.evidenceIds.length ||
        event.evidenceIds.some((id, idIndex) => id !== previous.evidenceIds[idIndex])) {
      throw new Error("legal-hold event scope must remain identical for a hold ID");
    }
    if (previous.active && event.action !== "release") throw new Error("active legal hold must be released before another placement");
    if (!previous.active && event.action !== "place") throw new Error("inactive legal hold must be placed before release");
    holds.set(event.holdId, {
      ...previous,
      sequence: event.sequence,
      createdAt: event.createdAt,
      active: event.action === "place"
    });
  }

  const activeHolds = [...holds.values()]
    .filter(hold => hold.active)
    .sort((a, b) => a.holdId.localeCompare(b.holdId))
    .map(hold => Object.freeze({
      holdId: hold.holdId,
      evidenceIds: Object.freeze([...hold.evidenceIds])
    }));
  const activeEvidenceIds = [...new Set(activeHolds.flatMap(hold => hold.evidenceIds))].sort();
  return Object.freeze({
    activeEvidenceIds: Object.freeze(activeEvidenceIds),
    activeHolds: Object.freeze(activeHolds)
  });
}
