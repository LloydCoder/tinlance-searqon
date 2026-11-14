import { createHash } from "node:crypto";

export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const OBSERVATION_CLASSES = new Set(["crawl","first_party","consumer_observation","model_api","derived","estimate"]);
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEvidenceSource(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("source must be a non-empty string");
  }
  const source = value.trim();
  if ([...source].length > 2048 || /[\u0000-\u001f\u007f]/.test(source)) {
    throw new TypeError("source must be at most 2048 characters and contain no control characters");
  }
  if (!/^https?:\/\//i.test(source)) return source;
  let url;
  try { url = new URL(source); }
  catch { throw new TypeError("source URL must be valid"); }
  if (url.username || url.password) throw new TypeError("source URL must not contain credentials");
  url.search = "";
  url.hash = "";
  return url.href;
}

const EVIDENCE_FIELDS = new Set([
  "id", "source", "acquisitionMethod", "observationClass", "collectedAt",
  "contentType", "byteLength", "sha256", "methodologyVersion", "integrity"
]);

function isCanonicalTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function createEvidenceRecord(input) {
  if (!input || typeof input !== "object" || typeof input.source !== "string" || !input.source.trim() || [...input.source.trim()].length > 2048 || /[\u0000-\u001f\u007f]/.test(input.source)) {
    throw new TypeError("source must be non-empty, at most 2048 characters, and contain no control characters");
  }
  if (typeof input.content !== "string" || typeof input.contentType !== "string" || !input.contentType.trim()) {
    throw new TypeError("String content and contentType are required");
  }
  const contentType = input.contentType.split(";")[0].trim().toLowerCase();
  if (contentType.length > 255 || !MEDIA_TYPE_PATTERN.test(contentType)) {
    throw new TypeError("contentType must be a valid media type of at most 255 characters");
  }
  const byteLength = Buffer.byteLength(input.content,"utf8");
  if (byteLength > MAX_EVIDENCE_BYTES) throw new RangeError("Document exceeds the " + MAX_EVIDENCE_BYTES + " byte analysis limit");
  const acquisitionMethod = input.acquisitionMethod ?? "local_file";
  if (typeof acquisitionMethod !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(acquisitionMethod)) {
    throw new TypeError("acquisitionMethod must be a lowercase identifier");
  }
  const observationClass = input.observationClass ?? "first_party";
  if (!OBSERVATION_CLASSES.has(observationClass)) throw new TypeError("Unsupported observationClass");
  const collectedAt = input.collectedAt ?? new Date().toISOString();
  if (!isCanonicalTimestamp(collectedAt)) {
    throw new TypeError("collectedAt must be a canonical ISO 8601 UTC timestamp");
  }
  const methodologyVersion = input.methodologyVersion ?? "2026-11-14.1";
  if (typeof methodologyVersion !== "string" || !methodologyVersion.trim() || [...methodologyVersion.trim()].length > 128) {
    throw new TypeError("methodologyVersion must be non-empty and at most 128 characters");
  }
  const normalizedMethodologyVersion = methodologyVersion.trim();
  const contentDigest = sha256(input.content);
  const source = normalizeEvidenceSource(input.source);
  const id = "evidence_" + sha256(acquisitionMethod + "\0" + source + "\0" + contentDigest).slice(0,20);
  return Object.freeze({
    id,
    source,
    acquisitionMethod,
    observationClass,
    collectedAt,
    contentType,
    byteLength,
    sha256:contentDigest,
    methodologyVersion:normalizedMethodologyVersion,
    integrity:"sha256-content-digest"
  });
}


export function verifyEvidenceRecord(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["invalid_record_shape"]) });
  }
  for (const field of EVIDENCE_FIELDS) {
    if (!Object.hasOwn(record, field)) errors.push("missing_" + field);
  }
  for (const field of Object.keys(record)) {
    if (!EVIDENCE_FIELDS.has(field)) errors.push("unexpected_" + field);
  }
  if (typeof record.source !== "string") {
    errors.push("invalid_source");
  } else {
    try {
      if (normalizeEvidenceSource(record.source) !== record.source) errors.push("source_not_normalized");
    } catch {
      errors.push("invalid_source");
    }
  }
  if (typeof record.acquisitionMethod !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(record.acquisitionMethod)) {
    errors.push("invalid_acquisition_method");
  }
  if (!OBSERVATION_CLASSES.has(record.observationClass)) errors.push("invalid_observation_class");
  if (!isCanonicalTimestamp(record.collectedAt)) errors.push("invalid_collected_at");
  if (typeof record.contentType !== "string" || record.contentType.length > 255 || !MEDIA_TYPE_PATTERN.test(record.contentType)) {
    errors.push("invalid_content_type");
  }
  if (!Number.isInteger(record.byteLength) || record.byteLength < 0 || record.byteLength > MAX_EVIDENCE_BYTES) {
    errors.push("invalid_byte_length");
  }
  if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) errors.push("invalid_sha256");
  if (typeof record.methodologyVersion !== "string" || !record.methodologyVersion || record.methodologyVersion.trim() !== record.methodologyVersion || [...record.methodologyVersion].length > 128) {
    errors.push("invalid_methodology_version");
  }
  if (record.integrity !== "sha256-content-digest") errors.push("invalid_integrity");
  if (typeof record.id !== "string" || !/^evidence_[a-f0-9]{20}$/.test(record.id)) {
    errors.push("invalid_id");
  } else if (
    typeof record.acquisitionMethod === "string" &&
    typeof record.source === "string" &&
    typeof record.sha256 === "string" &&
    record.id !== "evidence_" + sha256(record.acquisitionMethod + "\0" + record.source + "\0" + record.sha256).slice(0, 20)
  ) {
    errors.push("evidence_id_mismatch");
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function verifyEvidenceContent(record, content) {
  const recordVerification = verifyEvidenceRecord(record);
  const errors = [...recordVerification.errors];
  if (typeof content !== "string") {
    errors.push("invalid_content");
  } else if (record && typeof record === "object") {
    if (Buffer.byteLength(content, "utf8") !== record.byteLength) errors.push("content_byte_length_mismatch");
    if (sha256(content) !== record.sha256) errors.push("content_digest_mismatch");
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
