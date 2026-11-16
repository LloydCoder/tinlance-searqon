import { verifyEvidenceRecord } from "./evidence.js";
import { deriveActiveEvidenceHolds } from "./evidence-legal-holds.js";

export const EVIDENCE_RETENTION_POLICY_VERSION = "1.1.0";
const MAX_RETENTION_DAYS = 36_500;
const DAY_MS = 86_400_000;

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Evaluate retention eligibility without deleting, modifying, or exporting
 * source records. Purge execution and storage sanitization are separate duties.
 */
export function evaluateEvidenceRetention(records, { retentionDays, now, legalHoldEvents = [], legalHoldPublicKey, legalHoldApproverRegistry } = {}) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS) {
    throw new TypeError("retentionDays must be a positive safe integer no greater than 36500");
  }
  if (!isCanonicalUtcTimestamp(now)) {
    throw new TypeError("now must be a canonical ISO 8601 UTC timestamp");
  }

  if (legalHoldPublicKey && legalHoldApproverRegistry) {
    throw new TypeError("provide legalHoldPublicKey or legalHoldApproverRegistry, not both");
  }
  const nowMs = Date.parse(now);
  const holdVerifier = legalHoldApproverRegistry ?? legalHoldPublicKey;
  const holdState = deriveActiveEvidenceHolds(legalHoldEvents, holdVerifier);
  const heldIds = new Set(holdState.activeEvidenceIds);
  const seenIds = new Set();
  const eligibleForPurge = [];
  const retained = [];
  const held = [];

  for (const record of records) {
    const verification = verifyEvidenceRecord(record);
    if (!verification.valid) {
      throw new TypeError("invalid evidence record: " + verification.errors.join(", "));
    }
    if (seenIds.has(record.id)) throw new Error("duplicate evidence identifier: " + record.id);
    seenIds.add(record.id);

    const expiryMs = Date.parse(record.collectedAt) + retentionDays * DAY_MS;
    const expiryDate = new Date(expiryMs);
    if (!Number.isFinite(expiryMs) || Number.isNaN(expiryDate.getTime())) {
      throw new RangeError("evidence expiry timestamp is outside the supported ISO timestamp range");
    }

    const item = Object.freeze({
      evidenceId: record.id,
      collectedAt: record.collectedAt,
      expiresAt: expiryDate.toISOString()
    });
    if (heldIds.has(record.id)) {
      retained.push(item);
      held.push(item);
    } else if (expiryMs <= nowMs) eligibleForPurge.push(item);
    else retained.push(item);
  }

  const sortById = (a, b) => a.evidenceId.localeCompare(b.evidenceId);
  eligibleForPurge.sort(sortById);
  retained.sort(sortById);

  return deepFreeze({
    policyVersion: EVIDENCE_RETENTION_POLICY_VERSION,
    evaluatedAt: now,
    retentionDays,
    eligibleForPurge,
    retained,
    held,
    counts: {
      evaluated: records.length,
      eligibleForPurge: eligibleForPurge.length,
      retained: retained.length,
      held: held.length
    }
  });
}
