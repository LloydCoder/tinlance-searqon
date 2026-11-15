import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify
} from "node:crypto";
import { EVIDENCE_LEDGER_SCHEMA_VERSION, verifyEvidenceLedger } from "./evidence-ledger.js";

export const EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_VERSION = "1.0.0";
const CHECKPOINT_FIELDS = new Set([
  "schemaVersion", "algorithm", "keyId", "ledgerSchemaVersion",
  "entryCount", "headSequence", "headHash", "createdAt", "signature"
]);

function canonicalTimestamp(value) {
  return typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function privateEd25519Key(input) {
  const key = input && typeof input === "object" && input.type === "private"
    ? input
    : createPrivateKey(input);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError("An Ed25519 private key is required");
  }
  return key;
}

function publicEd25519Key(input) {
  const key = input && typeof input === "object" && input.type === "public"
    ? input
    : createPublicKey(input);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError("An Ed25519 public key is required");
  }
  return key;
}

function keyIdentifier(publicKey) {
  const der = publicKey.export({ format: "der", type: "spki" });
  const fingerprint = createHash("sha256").update(der).digest("hex");
  return "ed25519:" + fingerprint;
}

function checkpointPayload(checkpoint) {
  return {
    schemaVersion: checkpoint.schemaVersion,
    algorithm: checkpoint.algorithm,
    keyId: checkpoint.keyId,
    ledgerSchemaVersion: checkpoint.ledgerSchemaVersion,
    entryCount: checkpoint.entryCount,
    headSequence: checkpoint.headSequence,
    headHash: checkpoint.headHash,
    createdAt: checkpoint.createdAt
  };
}

export function createEvidenceLedgerCheckpoint(entries, privateKeyInput, options = {}) {
  const ledgerVerification = verifyEvidenceLedger(entries);
  if (!ledgerVerification.valid) {
    throw new TypeError("A valid evidence ledger is required to create a checkpoint");
  }
  const privateKey = privateEd25519Key(privateKeyInput);
  const publicKey = createPublicKey(privateKey);
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!canonicalTimestamp(createdAt)) {
    throw new TypeError("createdAt must be a canonical ISO 8601 UTC timestamp");
  }
  const payload = {
    schemaVersion: EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId: keyIdentifier(publicKey),
    ledgerSchemaVersion: EVIDENCE_LEDGER_SCHEMA_VERSION,
    entryCount: entries.length,
    headSequence: entries.length,
    headHash: entries.at(-1)?.entryHash ?? null,
    createdAt
  };
  const signature = sign(null, Buffer.from(JSON.stringify(payload), "utf8"), privateKey).toString("base64");
  return Object.freeze({ ...payload, signature });
}

export function verifyEvidenceLedgerCheckpoint(checkpoint, entries, publicKeyInput) {
  const errors = [];
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["invalid_checkpoint_shape"]) });
  }
  for (const field of CHECKPOINT_FIELDS) {
    if (!Object.hasOwn(checkpoint, field)) errors.push("missing_" + field);
  }
  for (const field of Object.keys(checkpoint)) {
    if (!CHECKPOINT_FIELDS.has(field)) errors.push("unexpected_" + field);
  }
  if (checkpoint.schemaVersion !== EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (checkpoint.algorithm !== "Ed25519") errors.push("invalid_algorithm");
  if (checkpoint.ledgerSchemaVersion !== EVIDENCE_LEDGER_SCHEMA_VERSION) errors.push("invalid_ledger_schema_version");
  if (!Number.isSafeInteger(checkpoint.entryCount) || checkpoint.entryCount < 0) errors.push("invalid_entry_count");
  if (!Number.isSafeInteger(checkpoint.headSequence) || checkpoint.headSequence < 0 ||
      checkpoint.headSequence !== checkpoint.entryCount) errors.push("invalid_head_sequence");
  if (checkpoint.entryCount === 0 && checkpoint.headHash !== null) errors.push("invalid_empty_head_hash");
  if (checkpoint.entryCount > 0 && (typeof checkpoint.headHash !== "string" || !/^[a-f0-9]{64}$/.test(checkpoint.headHash))) {
    errors.push("invalid_head_hash");
  }
  if (!canonicalTimestamp(checkpoint.createdAt)) errors.push("invalid_created_at");
  if (typeof checkpoint.keyId !== "string" || !/^ed25519:[a-f0-9]{64}$/.test(checkpoint.keyId)) errors.push("invalid_key_id");
  if (typeof checkpoint.signature !== "string") {
    errors.push("invalid_signature");
  } else {
    const decoded = Buffer.from(checkpoint.signature, "base64");
    if (decoded.length !== 64 || decoded.toString("base64") !== checkpoint.signature) errors.push("invalid_signature_encoding");
  }

  const ledgerVerification = verifyEvidenceLedger(entries);
  if (!ledgerVerification.valid) errors.push("invalid_evidence_ledger");
  if (Array.isArray(entries)) {
    if (checkpoint.entryCount !== entries.length) errors.push("ledger_entry_count_mismatch");
    const expectedHeadHash = entries.at(-1)?.entryHash ?? null;
    if (checkpoint.headHash !== expectedHeadHash) errors.push("ledger_head_hash_mismatch");
  }

  let publicKey;
  try {
    publicKey = publicEd25519Key(publicKeyInput);
    if (checkpoint.keyId !== keyIdentifier(publicKey)) errors.push("public_key_id_mismatch");
  } catch {
    errors.push("invalid_public_key");
  }

  if (publicKey && typeof checkpoint.signature === "string" &&
      !errors.some(error => ["invalid_schema_version","invalid_algorithm","invalid_ledger_schema_version","invalid_entry_count","invalid_head_sequence","invalid_empty_head_hash","invalid_head_hash","invalid_created_at","invalid_key_id","invalid_signature","invalid_signature_encoding"].includes(error))) {
    try {
      const signature = Buffer.from(checkpoint.signature, "base64");
      const validSignature = verify(
        null,
        Buffer.from(JSON.stringify(checkpointPayload(checkpoint)), "utf8"),
        publicKey,
        signature
      );
      if (!validSignature) errors.push("signature_verification_failed");
    } catch {
      errors.push("signature_verification_failed");
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
