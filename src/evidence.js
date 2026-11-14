import { createHash } from "node:crypto";

export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const OBSERVATION_CLASSES = new Set(["crawl","first_party","consumer_observation","model_api","derived","estimate"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createEvidenceRecord(input) {
  if (!input || typeof input !== "object" || typeof input.source !== "string" || !input.source.trim() || [...input.source.trim()].length > 2048 || /[\u0000-\u001f\u007f]/.test(input.source)) {
    throw new TypeError("source must be non-empty, at most 2048 characters, and contain no control characters");
  }
  if (typeof input.content !== "string" || typeof input.contentType !== "string" || !input.contentType.trim()) {
    throw new TypeError("String content and contentType are required");
  }
  const contentType = input.contentType.split(";")[0].trim().toLowerCase();
  if (contentType.length > 255 || !/^[a-z0-9!#  if (!contentType) throw new TypeError("contentType must contain a media type");^_.+-]+\/[a-z0-9!#  if (!contentType) throw new TypeError("contentType must contain a media type");^_.+-]+$/.test(contentType)) {
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
  if (typeof collectedAt !== "string" || Number.isNaN(Date.parse(collectedAt)) || new Date(collectedAt).toISOString() !== collectedAt) {
    throw new TypeError("collectedAt must be a canonical ISO 8601 UTC timestamp");
  }
  const methodologyVersion = input.methodologyVersion ?? "2026-11-14.1";
  if (typeof methodologyVersion !== "string" || !methodologyVersion.trim() || [...methodologyVersion.trim()].length > 128) {
    throw new TypeError("methodologyVersion must be non-empty and at most 128 characters");
  }
  const normalizedMethodologyVersion = methodologyVersion.trim();
  const contentDigest = sha256(input.content);
  const source = input.source.trim();
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
