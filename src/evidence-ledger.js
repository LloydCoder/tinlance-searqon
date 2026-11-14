import { createHash } from "node:crypto";
import { verifyEvidenceRecord } from "./evidence.js";

export const EVIDENCE_LEDGER_SCHEMA_VERSION = "1.0.0";
const LEDGER_FIELDS = new Set([
  "schemaVersion", "sequence", "previousHash", "createdAt", "record", "entryHash"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isCanonicalTimestamp(value) {
  return typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function canonicalRecord(record) {
  return {
    id: record.id,
    source: record.source,
    acquisitionMethod: record.acquisitionMethod,
    observationClass: record.observationClass,
    collectedAt: record.collectedAt,
    contentType: record.contentType,
    byteLength: record.byteLength,
    sha256: record.sha256,
    methodologyVersion: record.methodologyVersion,
    integrity: record.integrity
  };
}

function canonicalPayload({ sequence, previousHash, createdAt, record }) {
  return {
    schemaVersion: EVIDENCE_LEDGER_SCHEMA_VERSION,
    sequence,
    previousHash,
    createdAt,
    record: canonicalRecord(record)
  };
}

function hashPayload(payload) {
  return sha256(JSON.stringify(payload));
}

export function createEvidenceLedgerEntry(record, options = {}) {
  const verification = verifyEvidenceRecord(record);
  if (!verification.valid) throw new TypeError("A valid evidence record is required");
  const sequence = options.sequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new TypeError("sequence must be a positive safe integer");
  }
  const previousHash = options.previousHash ?? null;
  if (sequence === 1 && previousHash !== null) {
    throw new TypeError("The genesis entry previousHash must be null");
  }
  if (sequence > 1 && (typeof previousHash !== "string" || !/^[a-f0-9]{64}$/.test(previousHash))) {
    throw new TypeError("previousHash is required for entries after the genesis entry");
  }
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!isCanonicalTimestamp(createdAt)) throw new TypeError("createdAt must be a canonical ISO 8601 UTC timestamp");
  const payload = canonicalPayload({ sequence, previousHash, createdAt, record });
  const frozenPayload = Object.freeze({ ...payload, record: Object.freeze(payload.record) });
  return Object.freeze({ ...frozenPayload, entryHash: hashPayload(payload) });
}

export function verifyEvidenceLedgerEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["invalid_entry_shape"]) });
  }
  for (const field of LEDGER_FIELDS) {
    if (!Object.hasOwn(entry, field)) errors.push("missing_" + field);
  }
  for (const field of Object.keys(entry)) {
    if (!LEDGER_FIELDS.has(field)) errors.push("unexpected_" + field);
  }
  if (entry.schemaVersion !== EVIDENCE_LEDGER_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 1) errors.push("invalid_sequence");
  if (entry.sequence === 1 && entry.previousHash !== null) errors.push("invalid_genesis_previous_hash");
  if (entry.sequence > 1 && (typeof entry.previousHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.previousHash))) {
    errors.push("invalid_previous_hash");
  }
  if (!isCanonicalTimestamp(entry.createdAt)) errors.push("invalid_created_at");
  const recordVerification = verifyEvidenceRecord(entry.record);
  if (!recordVerification.valid) errors.push("invalid_evidence_record");
  if (typeof entry.entryHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.entryHash)) {
    errors.push("invalid_entry_hash");
  } else if (
    Number.isSafeInteger(entry.sequence) &&
    isCanonicalTimestamp(entry.createdAt) &&
    recordVerification.valid &&
    entry.entryHash !== hashPayload(canonicalPayload(entry))
  ) {
    errors.push("entry_hash_mismatch");
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function verifyEvidenceLedger(entries) {
  if (!Array.isArray(entries)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["ledger_must_be_an_array"]) });
  }
  const errors = [];
  let previousHash = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const verification = verifyEvidenceLedgerEntry(entry);
    for (const error of verification.errors) errors.push("entry_" + index + ":" + error);
    if (!entry || typeof entry !== "object" || entry.sequence !== index + 1) {
      errors.push("entry_" + index + ":sequence_gap_or_reordering");
    }
    if (entry && typeof entry === "object" && entry.previousHash !== previousHash) {
      errors.push("entry_" + index + ":previous_hash_link_mismatch");
    }
    previousHash = entry && typeof entry.entryHash === "string" ? entry.entryHash : null;
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
