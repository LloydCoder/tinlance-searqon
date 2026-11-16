import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { verifyEvidenceRedactionJournal } from "./evidence-redaction-store.js";

export const EVIDENCE_REDACTION_JOURNAL_CHECKPOINT_SCHEMA_VERSION = "1.0.0";

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

function canonicalPayload(checkpoint) {
  return {
    schemaVersion: checkpoint.schemaVersion,
    algorithm: checkpoint.algorithm,
    keyId: checkpoint.keyId,
    entryCount: checkpoint.entryCount,
    headHash: checkpoint.headHash,
    createdAt: checkpoint.createdAt
  };
}

function validateCheckpointShape(checkpoint) {
  const errors = [];
  const fields = new Set(["schemaVersion", "algorithm", "keyId", "entryCount", "headHash", "createdAt", "signature"]);
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return ["invalid_checkpoint_shape"];
  for (const field of fields) if (!Object.hasOwn(checkpoint, field)) errors.push("missing_" + field);
  for (const field of Object.keys(checkpoint)) if (!fields.has(field)) errors.push("unexpected_" + field);
  if (checkpoint.schemaVersion !== EVIDENCE_REDACTION_JOURNAL_CHECKPOINT_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (checkpoint.algorithm !== "Ed25519") errors.push("invalid_algorithm");
  if (typeof checkpoint.keyId !== "string" || !/^ed25519:[a-f0-9]{64}$/.test(checkpoint.keyId)) errors.push("invalid_key_id");
  if (!Number.isSafeInteger(checkpoint.entryCount) || checkpoint.entryCount < 0) errors.push("invalid_entry_count");
  if (checkpoint.entryCount === 0 && checkpoint.headHash !== null) errors.push("invalid_empty_head_hash");
  if (checkpoint.entryCount > 0 && (typeof checkpoint.headHash !== "string" || !/^[a-f0-9]{64}$/.test(checkpoint.headHash))) {
    errors.push("invalid_head_hash");
  }
  if (!canonicalTimestamp(checkpoint.createdAt)) errors.push("invalid_created_at");
  if (typeof checkpoint.signature !== "string" || checkpoint.signature.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/.test(checkpoint.signature)) {
    errors.push("invalid_signature_encoding");
  } else {
    const decoded = Buffer.from(checkpoint.signature, "base64");
    if (decoded.length !== 64 || decoded.toString("base64") !== checkpoint.signature) errors.push("invalid_signature_encoding");
  }
  return errors;
}

export function createEvidenceRedactionJournalCheckpoint(entries, privateKeyInput, { createdAt } = {}) {
  if (!canonicalTimestamp(createdAt)) throw new TypeError("createdAt must be a canonical ISO 8601 UTC timestamp");
  const privateKey = privateEd25519Key(privateKeyInput);
  const publicKey = createPublicKey(privateKey);
  const verification = verifyEvidenceRedactionJournal(entries, publicKey);
  if (!verification.valid) throw new TypeError("A valid redaction journal is required: " + verification.errors.join(", "));

  const payload = {
    schemaVersion: EVIDENCE_REDACTION_JOURNAL_CHECKPOINT_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId: keyIdentifier(publicKey),
    entryCount: entries.length,
    headHash: entries.at(-1)?.entryHash ?? null,
    createdAt
  };
  const signature = sign(null, Buffer.from(JSON.stringify(payload), "utf8"), privateKey).toString("base64");
  return Object.freeze({ ...payload, signature });
}

export function verifyEvidenceRedactionJournalCheckpoint(checkpoint, entries, publicKeyInput) {
  const errors = validateCheckpointShape(checkpoint);
  let publicKey;
  try {
    publicKey = publicEd25519Key(publicKeyInput);
    if (checkpoint && typeof checkpoint === "object" && checkpoint.keyId !== keyIdentifier(publicKey)) {
      errors.push("public_key_id_mismatch");
    }
  } catch {
    errors.push("invalid_public_key");
  }

  if (!Array.isArray(entries)) {
    errors.push("journal_must_be_an_array");
  } else if (Number.isSafeInteger(checkpoint?.entryCount) && entries.length < checkpoint.entryCount) {
    errors.push("journal_is_shorter_than_checkpoint");
  }

  if (publicKey && errors.length === 0) {
    try {
      if (!verify(null, Buffer.from(JSON.stringify(canonicalPayload(checkpoint)), "utf8"), publicKey, Buffer.from(checkpoint.signature, "base64"))) {
        errors.push("checkpoint_signature_verification_failed");
      }
    } catch {
      errors.push("checkpoint_signature_verification_failed");
    }
  }

  if (Array.isArray(entries) && publicKey && Number.isSafeInteger(checkpoint?.entryCount) && checkpoint.entryCount >= 0 && entries.length >= checkpoint.entryCount) {
    const journalVerification = verifyEvidenceRedactionJournal(entries, publicKey);
    if (!journalVerification.valid) errors.push("journal_integrity_verification_failed");
    const prefix = entries.slice(0, checkpoint.entryCount);
    const actualHead = prefix.at(-1)?.entryHash ?? null;
    if (actualHead !== checkpoint.headHash) errors.push("checkpoint_head_mismatch");
  }

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
