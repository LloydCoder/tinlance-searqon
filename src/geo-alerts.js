import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { wilsonInterval } from "./geo.js";
import { verifyEvidenceRecord } from "./evidence.js";

const OBSERVATION_CLASSES = new Set(["consumer_observation", "model_api"]);
const METRICS = Object.freeze([
  Object.freeze({ metricName: "mention", label: "Brand mentions", countField: "mentionCount", rateField: "mentionRate", intervalField: "mentionRate95" }),
  Object.freeze({ metricName: "brand_citation", label: "Brand citations", countField: "brandCitationCount", rateField: "brandCitationRate", intervalField: "brandCitationRate95" })
]);
const MAX_COHORTS = 2_000;
const MAX_ALERTS = 500;
const MAX_PREVIOUS_ALERTS = 10_000;
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const MAX_RETRY_ATTEMPTS = 8;
const MAX_RETRY_AFTER_SECONDS = 3_600;
const DEFAULT_MIN_SAMPLE_SIZE = 30;
const DEFAULT_MIN_ABSOLUTE_CHANGE = 0.1;

function canonicalTimestamp(value, field) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(field + " must be a canonical ISO 8601 UTC timestamp");
  }
  const date = new Date(value);
  if (date.toISOString() !== value) throw new TypeError(field + " must be a canonical ISO 8601 UTC timestamp");
  return date;
}

function boundedIdentifier(value, field, maxLength = 128) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || value.trim() !== value) {
    throw new TypeError(field + " must be a normalized non-empty string of at most " + maxLength + " characters");
  }
  return value;
}

function boundedInteger(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(field + " must be an integer between " + min + " and " + max);
  }
  return value;
}

function validateAggregateRow(row, field) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError(field + " must contain aggregate objects");
  if (!OBSERVATION_CLASSES.has(row.observationClass)) throw new TypeError(field + " observationClass is invalid");
  if (!row.provider || typeof row.provider !== "object" || Array.isArray(row.provider)) throw new TypeError(field + " provider metadata is invalid");
  const provider = {
    name: boundedIdentifier(row.provider.name, field + ".provider.name"),
    model: row.provider.model === null ? null : boundedIdentifier(row.provider.model, field + ".provider.model"),
    region: row.provider.region === null ? null : boundedIdentifier(row.provider.region, field + ".provider.region"),
    locale: row.provider.locale === null ? null : boundedIdentifier(row.provider.locale, field + ".provider.locale", 32)
  };
  const brand = boundedIdentifier(row.brand, field + ".brand");
  const targetDomain = row.targetDomain === null ? null : boundedIdentifier(row.targetDomain, field + ".targetDomain", 253).toLowerCase();
  if (targetDomain !== null && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(targetDomain)) throw new TypeError(field + " targetDomain must be a normalized hostname");
  if (row.samplePeriod !== null && row.samplePeriod !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(row.samplePeriod) || new Date(row.samplePeriod + "T00:00:00.000Z").toISOString().slice(0, 10) !== row.samplePeriod)) {
    throw new TypeError(field + " samplePeriod must be null or YYYY-MM-DD");
  }
  const sampleSize = boundedInteger(row.sampleSize, field + ".sampleSize", 1, 1_000_000);
  const mentionCount = boundedInteger(row.mentionCount, field + ".mentionCount", 0, sampleSize);
  const brandCitationCount = boundedInteger(row.brandCitationCount, field + ".brandCitationCount", 0, sampleSize);
  if (!Array.isArray(row.evidenceIds) || row.evidenceIds.length > 500) throw new TypeError(field + " evidenceIds must be a bounded array");
  const evidenceIds = row.evidenceIds.map((id, index) => boundedIdentifier(id, field + ".evidenceIds[" + index + "]", 64));
  if (evidenceIds.some(id => !/^evidence_[a-f0-9]{20}$/.test(id)) || new Set(evidenceIds).size !== evidenceIds.length) {
    throw new TypeError(field + " evidenceIds must contain unique evidence references");
  }
  const evidenceCount = boundedInteger(row.evidenceCount, field + ".evidenceCount", sampleSize, sampleSize);
  if (typeof row.evidenceTruncated !== "boolean" || row.evidenceTruncated !== (evidenceCount > evidenceIds.length) ||
      (!row.evidenceTruncated && evidenceIds.length !== evidenceCount) || (row.evidenceTruncated && evidenceIds.length !== 500)) {
    throw new TypeError(field + " evidence reference completeness is inconsistent");
  }
  if (row.mentionRate !== undefined && (typeof row.mentionRate !== "number" || Math.abs(row.mentionRate - mentionCount / sampleSize) > 0.00011)) {
    throw new TypeError(field + " mentionRate does not match its counts");
  }
  if (row.brandCitationRate !== undefined && (typeof row.brandCitationRate !== "number" || Math.abs(row.brandCitationRate - brandCitationCount / sampleSize) > 0.00011)) {
    throw new TypeError(field + " brandCitationRate does not match its counts");
  }
  return Object.freeze({
    observationClass: row.observationClass,
    provider: Object.freeze(provider),
    brand,
    targetDomain,
    samplePeriod: row.samplePeriod ?? null,
    sampleSize,
    mentionCount,
    brandCitationCount,
    evidenceIds: Object.freeze(evidenceIds),
    evidenceCount,
    evidenceTruncated: row.evidenceTruncated,
    mentionRate: mentionCount / sampleSize,
    mentionRate95: wilsonInterval(mentionCount, sampleSize),
    brandCitationRate: brandCitationCount / sampleSize,
    brandCitationRate95: wilsonInterval(brandCitationCount, sampleSize)
  });
}

function dimensionsFromKey(key) {
  const [observationClass, providerName, model, region, locale, brand, targetDomain, samplePeriod] = JSON.parse(key);
  return Object.freeze({ observationClass, provider: Object.freeze({ name: providerName, model, region, locale }), brand, targetDomain, samplePeriod });
}

function cohortKey(row) {
  return JSON.stringify([
    row.observationClass, row.provider.name, row.provider.model, row.provider.region,
    row.provider.locale, row.brand, row.targetDomain, row.samplePeriod
  ]);
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareMetric(cohort, metric, baseline, current, policy, evaluatedAt) {
  const beforeCount = baseline[metric.countField];
  const afterCount = current[metric.countField];
  const beforeRate = beforeCount / baseline.sampleSize;
  const afterRate = afterCount / current.sampleSize;
  const delta = Number((afterRate - beforeRate).toFixed(4));
  const absoluteChange = Math.abs(delta);
  const baseInterval = wilsonInterval(beforeCount, baseline.sampleSize);
  const currentInterval = wilsonInterval(afterCount, current.sampleSize);
  const intervalsOverlap = baseInterval.lower <= currentInterval.upper && currentInterval.lower <= baseInterval.upper;
  const evaluation = {
    metric: metric.metricName,
    label: metric.label,
    status: "no_significant_change",
    baseline: { sampleSize: baseline.sampleSize, count: beforeCount, rate: Number(beforeRate.toFixed(4)), interval95: baseInterval, evidenceIds: baseline.evidenceIds, evidenceCount: baseline.evidenceCount, evidenceTruncated: baseline.evidenceTruncated },
    current: { sampleSize: current.sampleSize, count: afterCount, rate: Number(afterRate.toFixed(4)), interval95: currentInterval, evidenceIds: current.evidenceIds, evidenceCount: current.evidenceCount, evidenceTruncated: current.evidenceTruncated },
    delta,
    intervalsOverlap
  };

  if (baseline.sampleSize < policy.minSampleSize || current.sampleSize < policy.minSampleSize) {
    evaluation.status = "insufficient_evidence";
    return { evaluation };
  }
  if (absoluteChange < policy.minAbsoluteChange || intervalsOverlap || delta === 0) {
    return { evaluation };
  }

  const direction = delta < 0 ? "decline" : "increase";
  const severity = absoluteChange >= 0.25 ? "high" : absoluteChange >= 0.15 ? "medium" : "low";
  const dimensions = {
    observationClass: cohort.observationClass,
    provider: cohort.provider,
    brand: cohort.brand,
    targetDomain: cohort.targetDomain,
    samplePeriod: cohort.samplePeriod
  };
  const dedupeKey = digest(JSON.stringify({ dimensions, metric: metric.metricName, direction }));
  const alertId = "geoalert_" + digest(JSON.stringify({ dedupeKey, baselineId: policy.baselineId, currentId: policy.currentId })).slice(0, 24);
  const alert = Object.freeze({
    alertId,
    dedupeKey,
    type: metric.metricName === "mention" ? "mention_change" : "brand_citation_change",
    metric: metric.metricName,
    label: metric.label,
    direction,
    severity,
    dimensions,
    baseline: evaluation.baseline,
    current: evaluation.current,
    delta,
    absoluteChange: Number(absoluteChange.toFixed(4)),
    confidenceMethod: "non_overlapping_wilson_95",
    baselineId: policy.baselineId,
    currentId: policy.currentId,
    baselineAt: policy.baselineAt,
    currentAt: policy.currentAt,
    evaluatedAt: evaluatedAt.toISOString(),
    evidence: {
      baselineSampleSize: baseline.sampleSize,
      currentSampleSize: current.sampleSize,
      baselineEvidenceIds: baseline.evidenceIds,
      currentEvidenceIds: current.evidenceIds,
      baselineEvidenceCount: baseline.evidenceCount,
      currentEvidenceCount: current.evidenceCount,
      truncated: baseline.evidenceTruncated || current.evidenceTruncated
    }
  });
  evaluation.status = "alert";
  evaluation.alertId = alertId;
  return { evaluation, alert };
}

/**
 * Compare two already-aggregated GEO snapshots. This function never combines
 * consumer observations with direct model API observations and never fetches data.
 */
export function buildGeoAlerts(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("GEO alert input is required");
  if (!Array.isArray(input.baseline) || !Array.isArray(input.current)) throw new TypeError("baseline and current must be arrays");
  if (input.baseline.length > MAX_COHORTS || input.current.length > MAX_COHORTS) throw new RangeError("GEO alert snapshots exceed the cohort limit");
  const baselineAt = canonicalTimestamp(input.baselineAt, "baselineAt");
  const currentAt = canonicalTimestamp(input.currentAt, "currentAt");
  const evaluatedAt = canonicalTimestamp(input.evaluatedAt, "evaluatedAt");
  if (currentAt <= baselineAt) throw new RangeError("currentAt must be later than baselineAt");
  if (evaluatedAt < currentAt) throw new RangeError("evaluatedAt must not be earlier than currentAt");
  const baselineId = boundedIdentifier(input.baselineId, "baselineId");
  const currentId = boundedIdentifier(input.currentId, "currentId");
  if (baselineId === currentId) throw new TypeError("baselineId and currentId must be different");
  const policy = {
    baselineId, currentId, baselineAt: baselineAt.toISOString(), currentAt: currentAt.toISOString(),
    minSampleSize: input.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE,
    minAbsoluteChange: input.minAbsoluteChange ?? DEFAULT_MIN_ABSOLUTE_CHANGE,
    cooldownSeconds: input.cooldownSeconds ?? 0,
    maxObservationAgeSeconds: input.maxObservationAgeSeconds ?? 86_400
  };
  boundedInteger(policy.minSampleSize, "minSampleSize", 2, 1_000_000);
  if (typeof policy.minAbsoluteChange !== "number" || !Number.isFinite(policy.minAbsoluteChange) || policy.minAbsoluteChange <= 0 || policy.minAbsoluteChange > 1) {
    throw new RangeError("minAbsoluteChange must be greater than 0 and no greater than 1");
  }
  boundedInteger(policy.cooldownSeconds, "cooldownSeconds", 0, 31_536_000);
  boundedInteger(policy.maxObservationAgeSeconds, "maxObservationAgeSeconds", 1, 604_800);
  if (!Array.isArray(input.previousAlerts ?? []) || (input.previousAlerts ?? []).length > MAX_PREVIOUS_ALERTS) {
    throw new RangeError("previousAlerts must be a bounded array");
  }
  const previous = new Map();
  for (const item of input.previousAlerts ?? []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("previousAlerts entries must be objects");
    const key = boundedIdentifier(item.dedupeKey, "previousAlerts.dedupeKey", 64);
    const notifiedAt = canonicalTimestamp(item.lastNotifiedAt, "previousAlerts.lastNotifiedAt");
    const prior = previous.get(key);
    if (notifiedAt > evaluatedAt) throw new RangeError("previousAlerts timestamps cannot be in the future");
    if (!prior || notifiedAt > prior) previous.set(key, notifiedAt);
  }
  const baselineMap = new Map();
  const currentMap = new Map();
  for (const row of input.baseline) {
    const normalized = validateAggregateRow(row, "baseline");
    const key = cohortKey(normalized);
    if (baselineMap.has(key)) throw new TypeError("duplicate baseline cohort");
    baselineMap.set(key, normalized);
  }
  for (const row of input.current) {
    const normalized = validateAggregateRow(row, "current");
    const key = cohortKey(normalized);
    if (currentMap.has(key)) throw new TypeError("duplicate current cohort");
    currentMap.set(key, normalized);
  }

  const evaluations = [];
  const comparedCohorts = new Set();
  const alerts = [];
  const suppressedAlerts = [];
  const keys = [...new Set([...baselineMap.keys(), ...currentMap.keys()])].sort();
  for (const key of keys) {
    const before = baselineMap.get(key);
    const after = currentMap.get(key);
    if (!before) {
      evaluations.push(Object.freeze({ status: "new_cohort", dimensions: dimensionsFromKey(key) }));
      continue;
    }
    if (!after) {
      evaluations.push(Object.freeze({ status: "cohort_missing", dimensions: dimensionsFromKey(key) }));
      continue;
    }
    comparedCohorts.add(key);
    const currentEvidenceSet = new Set(after.evidenceIds);
    if (before.evidenceIds.some(id => currentEvidenceSet.has(id))) throw new TypeError("baseline and current snapshots contain duplicate evidence identifiers");
    const cohort = {
      observationClass: before.observationClass,
      provider: before.provider,
      brand: before.brand,
      targetDomain: before.targetDomain,
      samplePeriod: before.samplePeriod
    };
    for (const metric of METRICS) {
      const result = compareMetric(cohort, metric, before, after, policy, evaluatedAt);
      evaluations.push(Object.freeze({ ...result.evaluation, dimensions: cohort }));
      if (!result.alert) continue;
      const lastNotifiedAt = previous.get(result.alert.dedupeKey);
      if (lastNotifiedAt && policy.cooldownSeconds > 0 &&
          evaluatedAt.getTime() - lastNotifiedAt.getTime() < policy.cooldownSeconds * 1000) {
        suppressedAlerts.push(Object.freeze({ ...result.alert, suppressionReason: "cooldown", lastNotifiedAt: lastNotifiedAt.toISOString() }));
      } else {
        alerts.push(result.alert);
      }
    }
  }
  if (alerts.length > MAX_ALERTS || suppressedAlerts.length > MAX_ALERTS) throw new RangeError("GEO alert output exceeds the alert limit");
  return Object.freeze({
    schemaVersion: "1.0.0",
    type: "geo_alert_report",
    baselineId,
    currentId,
    baselineAt: baselineAt.toISOString(),
    currentAt: currentAt.toISOString(),
    evaluatedAt: evaluatedAt.toISOString(),
    observationLagSeconds: Math.floor((evaluatedAt.getTime() - currentAt.getTime()) / 1000),
    observationFreshness: (evaluatedAt.getTime() - currentAt.getTime()) / 1000 <= policy.maxObservationAgeSeconds ? "fresh" : "stale",
    policy: Object.freeze({ minSampleSize: policy.minSampleSize, minAbsoluteChange: policy.minAbsoluteChange, cooldownSeconds: policy.cooldownSeconds, maxObservationAgeSeconds: policy.maxObservationAgeSeconds, confidenceMethod: "wilson_95_non_overlap" }),
    summary: Object.freeze({ cohortsCompared: comparedCohorts.size, alerts: alerts.length, suppressed: suppressedAlerts.length, evaluations: evaluations.length }),
    evaluations: Object.freeze(evaluations),
    alerts: Object.freeze(alerts),
    suppressedAlerts: Object.freeze(suppressedAlerts)
  });
}

function validateSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) throw new TypeError("Webhook secret must contain at least 32 bytes");
  return secret;
}

function eventSignature(secret, timestamp, body) {
  return createHmac("sha256", secret).update(timestamp + "." + body, "utf8").digest("hex");
}

export function createSignedAlertEvent(alert, secret, timestampSeconds = Math.floor(Date.now() / 1000)) {
  validateSecret(secret);
  boundedInteger(timestampSeconds, "timestampSeconds", 1, Number.MAX_SAFE_INTEGER);
  if (!alert || typeof alert !== "object" || typeof alert.alertId !== "string" || typeof alert.dedupeKey !== "string") {
    throw new TypeError("A validated GEO alert is required");
  }
  const eventId = randomUUID();
  const envelope = {
    id: eventId,
    type: "searqon.geo.alert",
    apiVersion: "1.0.0",
    createdAt: new Date(timestampSeconds * 1000).toISOString(),
    data: alert
  };
  const body = JSON.stringify(envelope);
  if (Buffer.byteLength(body, "utf8") > MAX_WEBHOOK_BODY_BYTES) throw new RangeError("Webhook event exceeds the maximum body size");
  const timestamp = String(timestampSeconds);
  const signature = eventSignature(secret, timestamp, body);
  return Object.freeze({
    body,
    headers: Object.freeze({
      "content-type": "application/json",
      "x-searqon-timestamp": timestamp,
      "x-searqon-signature": "v1=" + signature,
      "x-searqon-event-id": eventId
    })
  });
}

export function verifySignedAlertEvent({ rawBody, secret, timestamp, signature, eventId, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300 } = {}) {
  validateSecret(secret);
  if (typeof rawBody !== "string" || Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) throw new TypeError("Webhook body is invalid or too large");
  if (typeof timestamp !== "string" || !/^\d{1,12}$/.test(timestamp)) throw new TypeError("Webhook timestamp is invalid");
  boundedInteger(nowSeconds, "nowSeconds", 1, Number.MAX_SAFE_INTEGER);
  boundedInteger(toleranceSeconds, "toleranceSeconds", 1, 900);
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) throw new TypeError("Webhook timestamp is outside the accepted tolerance");
  if (typeof signature !== "string" || !/^v1=[a-f0-9]{64}$/.test(signature)) throw new TypeError("Webhook signature is invalid");
  const expected = Buffer.from("v1=" + eventSignature(secret, timestamp, rawBody), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new TypeError("Webhook signature verification failed");
  let envelope;
  try { envelope = JSON.parse(rawBody); } catch { throw new TypeError("Webhook body is not valid JSON"); }
  if (!envelope || envelope.type !== "searqon.geo.alert" || envelope.apiVersion !== "1.0.0" ||
      typeof envelope.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.id) ||
      typeof eventId !== "string" || envelope.id !== eventId ||
      canonicalTimestamp(envelope.createdAt, "createdAt").getTime() / 1000 !== timestampSeconds ||
      !envelope.data || typeof envelope.data.alertId !== "string") {
    throw new TypeError("Webhook event envelope is invalid");
  }
  return Object.freeze(envelope);
}

export function createDeliveryReceipt({ alert, destination, attempt, attemptedAt, outcome, httpStatus = null, retryAfterSeconds = null, providerReceiptId = null } = {}) {
  if (!alert || typeof alert.alertId !== "string" || typeof alert.dedupeKey !== "string") throw new TypeError("A validated GEO alert is required");
  boundedIdentifier(destination, "destination", 160);
  boundedInteger(attempt, "attempt", 1, MAX_RETRY_ATTEMPTS);
  const at = canonicalTimestamp(attemptedAt, "attemptedAt");
  if (!["delivered", "retryable_failure", "permanent_failure"].includes(outcome)) throw new TypeError("outcome is invalid");
  if (httpStatus !== null) boundedInteger(httpStatus, "httpStatus", 100, 599);
  if (retryAfterSeconds !== null) boundedInteger(retryAfterSeconds, "retryAfterSeconds", 1, MAX_RETRY_AFTER_SECONDS);
  if (providerReceiptId !== null) boundedIdentifier(providerReceiptId, "providerReceiptId", 256);
  if (outcome === "delivered" && (httpStatus === null || httpStatus < 200 || httpStatus >= 300)) throw new TypeError("delivered receipts require a successful HTTP status");
  if (outcome !== "delivered" && httpStatus !== null && httpStatus >= 200 && httpStatus < 300) throw new TypeError("failed receipts cannot use a successful HTTP status");
  if (outcome === "retryable_failure" && attempt >= MAX_RETRY_ATTEMPTS) outcome = "permanent_failure";
  const delay = outcome === "retryable_failure"
    ? (retryAfterSeconds ?? Math.min(300, 2 ** attempt * 5))
    : null;
  const nextAttemptAt = delay === null ? null : new Date(at.getTime() + delay * 1000).toISOString();
  return Object.freeze({
    schemaVersion: "1.0.0",
    type: "geo_delivery_receipt",
    alertId: alert.alertId,
    dedupeKey: alert.dedupeKey,
    destination,
    attempt,
    attemptedAt: at.toISOString(),
    outcome,
    status: outcome,
    httpStatus,
    providerReceiptId,
    nextAttemptAt
  });
}

function safeText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}

export function toSlackWebhookPayload(alert) {
  if (!alert || typeof alert.alertId !== "string") throw new TypeError("A validated GEO alert is required");
  const direction = alert.direction === "decline" ? "declined" : "increased";
  const title = safeText(alert.label, 100);
  const provider = safeText(alert.dimensions?.provider?.name, 100);
  const brand = safeText(alert.dimensions?.brand, 100);
  const percent = (Math.abs(alert.delta) * 100).toFixed(1);
  const text = "Searqon GEO alert: " + title + " " + direction + " by " + percent + "% for " + brand + " (" + provider + ").";
  return Object.freeze({
    text,
    mrkdwn: false,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "Searqon GEO alert" } },
      { type: "section", text: { type: "plain_text", text: title + " " + direction + " by " + percent + "%." } },
      { type: "context", elements: [{ type: "plain_text", text: safeText(brand + " · " + provider + " · " + alert.dimensions?.observationClass, 200) }] }
    ]
  });
}

export function toTeamsWorkflowPayload(alert) {
  if (!alert || typeof alert.alertId !== "string") throw new TypeError("A validated GEO alert is required");
  const direction = alert.direction === "decline" ? "declined" : "increased";
  const card = {
    type: "AdaptiveCard",
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.2",
    body: [
      { type: "TextBlock", text: "Searqon GEO alert", weight: "Bolder", size: "Medium" },
      { type: "TextBlock", text: safeText(alert.label, 100) + " " + direction + " by " + (Math.abs(alert.delta) * 100).toFixed(1) + "%.", wrap: true },
      { type: "FactSet", facts: [
        { title: "Brand", value: safeText(alert.dimensions?.brand, 100) },
        { title: "Provider", value: safeText(alert.dimensions?.provider?.name, 100) },
        { title: "Samples", value: String(alert.baseline.sampleSize) + " → " + String(alert.current.sampleSize) }
      ]}
    ]
  };
  return Object.freeze({
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }]
  });
}

export function toPagerDutyEvent(alert, { routingKey, source = "searqon.geo" } = {}) {
  if (!alert || typeof alert.alertId !== "string") throw new TypeError("A validated GEO alert is required");
  if (typeof routingKey !== "string" || !/^[A-Za-z0-9]{32}$/.test(routingKey)) throw new TypeError("PagerDuty routingKey must be a 32-character integration key");
  boundedIdentifier(source, "source", 100);
  return Object.freeze({
    routing_key: routingKey,
    event_action: "trigger",
    dedup_key: alert.dedupeKey,
    payload: {
      summary: safeText("Searqon: " + alert.label + " " + alert.direction + " for " + alert.dimensions?.brand, 1024),
      source,
      severity: alert.severity === "high" ? "critical" : alert.severity === "medium" ? "error" : "warning",
      timestamp: alert.evaluatedAt,
      custom_details: {
        alertId: alert.alertId,
        baselineId: alert.baselineId,
        currentId: alert.currentId,
        delta: alert.delta,
        dimensions: alert.dimensions
      }
    }
  });
}


/**
 * Detect citation-domain disappearance across two raw, already-captured GEO
 * observation cohorts. The caller is responsible for ensuring both snapshots
 * were collected with the same prompt set and sampling configuration.
 */
export function detectCitationChanges({ baseline, current, observedAt, policy = {} } = {}) {
  if (!Array.isArray(baseline) || !Array.isArray(current) || baseline.length === 0 || current.length === 0) {
    throw new TypeError("baseline and current must be non-empty observation arrays");
  }
  if (baseline.length > 10_000 || current.length > 10_000) throw new RangeError("citation change snapshots exceed the 10,000 observation limit");
  const observed = canonicalTimestamp(observedAt, "observedAt");
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new TypeError("policy must be an object");
  const minSamples = policy.minimumSamples ?? 10;
  const minChange = policy.minimumAbsoluteChange ?? 0.1;
  const maxObservationAgeSeconds = policy.maxObservationAgeSeconds ?? 86_400;
  boundedInteger(minSamples, "minimumSamples", 2, 10_000);
  boundedInteger(maxObservationAgeSeconds, "maxObservationAgeSeconds", 1, 604_800);
  if (typeof minChange !== "number" || !Number.isFinite(minChange) || minChange <= 0 || minChange > 1) {
    throw new RangeError("minimumAbsoluteChange must be greater than 0 and no greater than 1");
  }

  function normalizeObservations(items, label) {
    const seen = new Set();
    const normalized = [];
    for (const item of items) {
      if (!item || item.type !== "geo_observation" || item.schemaVersion !== "1.0.0" ||
          !OBSERVATION_CLASSES.has(item.observationClass) || !item.provider || typeof item.provider !== "object" ||
          !item.evidence || typeof item.evidence.id !== "string" || !/^evidence_[a-f0-9]{20}$/.test(item.evidence.id)) {
        throw new TypeError(label + " contains an invalid GEO observation or evidence reference");
      }
      if (seen.has(item.evidence.id)) throw new TypeError("duplicate evidence identifier in " + label);
      seen.add(item.evidence.id);
      boundedIdentifier(item.provider.name, label + ".provider.name");
      if (item.provider.model !== undefined && item.provider.model !== null) boundedIdentifier(item.provider.model, label + ".provider.model");
      if (item.provider.region !== undefined && item.provider.region !== null) boundedIdentifier(item.provider.region, label + ".provider.region");
      if (item.provider.locale !== undefined && item.provider.locale !== null) boundedIdentifier(item.provider.locale, label + ".provider.locale", 32);
      boundedIdentifier(item.brand, label + ".brand");
      if (item.targetDomain !== null && item.targetDomain !== undefined) boundedIdentifier(item.targetDomain, label + ".targetDomain", 253);
      const sampledAt = canonicalTimestamp(item.sampledAt, label + ".sampledAt");
      if (!Array.isArray(item.citations) || item.citations.length > 100) throw new TypeError(label + " citations are invalid");
      const domains = new Set();
      for (const citation of item.citations) {
        if (!citation || typeof citation.url !== "string" || typeof citation.domain !== "string") throw new TypeError(label + " citation metadata is invalid");
        let url;
        try { url = new URL(citation.url); } catch { throw new TypeError(label + " citation URL is invalid"); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
            url.hostname.toLowerCase() !== citation.domain || url.hash || url.toString() !== citation.url) {
          throw new TypeError(label + " citation URL is not normalized");
        }
        domains.add(citation.domain);
      }
      normalized.push({
        observation: item,
        sampledAt,
        domains,
        evidenceId: item.evidence.id
      });
    }
    return normalized;
  }

  const before = normalizeObservations(baseline, "baseline");
  const after = normalizeObservations(current, "current");
  const cohort = item => JSON.stringify([
    item.observation.observationClass,
    item.observation.provider.name ?? null,
    item.observation.provider.model ?? null,
    item.observation.provider.region ?? null,
    item.observation.provider.locale ?? null,
    item.observation.brand,
    item.observation.targetDomain ?? null
  ]);
  const baselineCohort = cohort(before[0]);
  const currentCohort = cohort(after[0]);
  if (before.some(item => cohort(item) !== baselineCohort) ||
      after.some(item => cohort(item) !== currentCohort) || baselineCohort !== currentCohort) {
    throw new TypeError("baseline and current must belong to the same comparable cohort");
  }
  const allEvidenceIds = new Set();
  for (const item of [...before, ...after]) {
    if (allEvidenceIds.has(item.evidenceId)) throw new TypeError("duplicate evidence identifier across GEO snapshots");
    allEvidenceIds.add(item.evidenceId);
    const evidence = item.observation.evidence;
    const verification = verifyEvidenceRecord(evidence);
    if (!verification.valid || evidence.source !== item.observation.provider.name ||
        evidence.acquisitionMethod !== "provider_observation" ||
        evidence.observationClass !== item.observation.observationClass ||
        evidence.collectedAt !== item.observation.sampledAt || evidence.contentType !== "application/json") {
      throw new TypeError("GEO observation evidence provenance is invalid");
    }
  }
  const baselineTime = Math.max(...before.map(item => item.sampledAt.getTime()));
  const currentTime = Math.min(...after.map(item => item.sampledAt.getTime()));
  if (currentTime <= baselineTime) throw new RangeError("current observations must be later than baseline observations");
  if (observed < new Date(Math.max(...after.map(item => item.sampledAt.getTime())))) {
    throw new RangeError("observedAt must not be earlier than current observations");
  }

  const domainCounts = items => {
    const counts = new Map();
    for (const item of items) for (const domain of item.domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
    return counts;
  };
  const beforeCounts = domainCounts(before);
  const afterCounts = domainCounts(after);
  const events = [];
  const suppressed = [];
  const evaluations = [];
  const dimensions = JSON.parse(baselineCohort);
  for (const domain of [...beforeCounts.keys()].sort()) {
    const baselineCount = beforeCounts.get(domain);
    const currentCount = afterCounts.get(domain) ?? 0;
    const baselineRate = baselineCount / before.length;
    const currentRate = currentCount / after.length;
    const delta = Number((currentRate - baselineRate).toFixed(4));
    if (delta >= 0 || Math.abs(delta) < minChange) continue;
    const baselineInterval = wilsonInterval(baselineCount, before.length);
    const currentInterval = wilsonInterval(currentCount, after.length);
    const intervalsOverlap = baselineInterval.lower <= currentInterval.upper && currentInterval.lower <= baselineInterval.upper;
    const evaluation = {
      domain,
      status: "candidate",
      baselineRate: Number(baselineRate.toFixed(4)),
      currentRate: Number(currentRate.toFixed(4)),
      baselineSampleSize: before.length,
      currentSampleSize: after.length,
      baselineInterval95: baselineInterval,
      currentInterval95: currentInterval
    };
    if (before.length < minSamples || after.length < minSamples) {
      evaluation.status = "insufficient_evidence";
      suppressed.push(Object.freeze({ domain, reason: "insufficient_samples", baselineSampleSize: before.length, currentSampleSize: after.length }));
      evaluations.push(Object.freeze(evaluation));
      continue;
    }
    if (intervalsOverlap) {
      evaluation.status = "not_significant";
      suppressed.push(Object.freeze({ domain, reason: "overlapping_confidence_intervals", baselineSampleSize: before.length, currentSampleSize: after.length }));
      evaluations.push(Object.freeze(evaluation));
      continue;
    }
    const evidenceIds = [
      ...before.filter(item => item.domains.has(domain)).map(item => item.evidenceId),
      ...after.map(item => item.evidenceId)
    ].sort();
    const eventId = "geocite_" + digest(JSON.stringify({
      method: "citation-domain-disappearance-v1",
      dimensions,
      domain,
      evidenceIds
    })).slice(0, 24);
    const event = Object.freeze({
      eventId,
      changeType: "citation_disappearance",
      domain,
      dimensions: Object.freeze({
        observationClass: dimensions[0],
        provider: dimensions[1],
        model: dimensions[2],
        region: dimensions[3],
        locale: dimensions[4],
        brand: dimensions[5],
        targetDomain: dimensions[6]
      }),
      baselineRate: Number(baselineRate.toFixed(4)),
      currentRate: Number(currentRate.toFixed(4)),
      delta,
      baselineSampleSize: before.length,
      currentSampleSize: after.length,
      baselineInterval95: baselineInterval,
      currentInterval95: currentInterval,
      evidenceIds: Object.freeze(evidenceIds),
      observedAt: observed.toISOString(),
      confidenceMethod: "non_overlapping_wilson_95"
    });
    evaluation.status = "alert";
    evaluation.eventId = eventId;
    events.push(event);
    evaluations.push(Object.freeze(evaluation));
  }
  return Object.freeze({
    schemaVersion: "1.0.0",
    type: "geo_citation_change_report",
    dimensions: Object.freeze({
      observationClass: dimensions[0],
      provider: dimensions[1],
      model: dimensions[2],
      region: dimensions[3],
      locale: dimensions[4],
      brand: dimensions[5],
      targetDomain: dimensions[6]
    }),
    observedAt: observed.toISOString(),
    observationLagSeconds: Math.floor((observed.getTime() - Math.max(...after.map(item => item.sampledAt.getTime()))) / 1000),
    observationFreshness: (observed.getTime() - Math.max(...after.map(item => item.sampledAt.getTime()))) / 1000 <= maxObservationAgeSeconds ? "fresh" : "stale",
    policy: Object.freeze({ minimumSamples: minSamples, minimumAbsoluteChange: minChange, maxObservationAgeSeconds, confidenceMethod: "wilson_95_non_overlap" }),
    summary: Object.freeze({ baselineSampleSize: before.length, currentSampleSize: after.length, events: events.length, suppressed: suppressed.length }),
    events: Object.freeze(events),
    suppressed: Object.freeze(suppressed),
    evaluations: Object.freeze(evaluations)
  });
}


/**
 * In-memory replay guard for a single process/test worker. Production receivers
 * must use a durable unique constraint keyed by event ID.
 */
export function createWebhookReplayGuard({ maxEntries = 10_000, ttlSeconds = 900, timestampToleranceSeconds = 300 } = {}) {
  boundedInteger(maxEntries, "maxEntries", 1, 100_000);
  boundedInteger(ttlSeconds, "ttlSeconds", 1, 86_400);
  boundedInteger(timestampToleranceSeconds, "timestampToleranceSeconds", 1, 900);
  if (ttlSeconds <= timestampToleranceSeconds) throw new RangeError("ttlSeconds must exceed timestampToleranceSeconds");
  const seen = new Map();
  return Object.freeze({
    claim(eventId, timestampSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
      if (typeof eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
        throw new TypeError("eventId must be a UUID v4");
      }
      boundedInteger(timestampSeconds, "timestampSeconds", 1, Number.MAX_SAFE_INTEGER);
      boundedInteger(nowSeconds, "nowSeconds", 1, Number.MAX_SAFE_INTEGER);
      if (Math.abs(nowSeconds - timestampSeconds) > timestampToleranceSeconds) throw new TypeError("Webhook timestamp is outside the accepted tolerance");
      for (const [id, seenAt] of seen) if (nowSeconds - seenAt > ttlSeconds) seen.delete(id);
      if (seen.has(eventId)) return false;
      if (seen.size >= maxEntries) throw new RangeError("Webhook replay guard capacity reached; fail closed");
      seen.set(eventId, nowSeconds);
      return true;
    },
    size() { return seen.size; }
  });
}

/**
 * Evaluate detector behavior against explicitly labelled domains. This reports
 * precision/recall on the supplied labels only; synthetic fixtures are not market evidence.
 */
export function evaluateGeoCitationAlertQuality({ cases, policy = {} } = {}) {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > 1_000) throw new RangeError("cases must contain between 1 and 1,000 labelled cases");
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new TypeError("policy must be an object");
  const caseIds = new Set();
  const counts = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 };
  const results = [];
  for (const item of cases) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("labelled cases must be objects");
    const caseId = boundedIdentifier(item.caseId, "caseId", 128);
    if (caseIds.has(caseId)) throw new TypeError("duplicate labelled caseId");
    caseIds.add(caseId);
    if (!Array.isArray(item.candidateDomains) || item.candidateDomains.length === 0 || item.candidateDomains.length > 500) {
      throw new TypeError("candidateDomains must be a non-empty bounded array");
    }
    if (!Array.isArray(item.expectedDisappearedDomains)) throw new TypeError("expectedDisappearedDomains must be an array");
    const candidates = item.candidateDomains.map((domain, index) => boundedIdentifier(domain, "candidateDomains[" + index + "]", 253).toLowerCase());
    const expected = item.expectedDisappearedDomains.map((domain, index) => boundedIdentifier(domain, "expectedDisappearedDomains[" + index + "]", 253).toLowerCase());
    if (new Set(candidates).size !== candidates.length || new Set(expected).size !== expected.length) throw new TypeError("candidate and expected domains must be unique");
    if (expected.some(domain => !candidates.includes(domain))) throw new TypeError("expected domains must be included in candidateDomains");
    const report = detectCitationChanges({
      baseline: item.baseline,
      current: item.current,
      observedAt: item.observedAt,
      policy: { ...policy, ...(item.policy ?? {}) }
    });
    const predicted = new Set(report.events.map(event => event.domain));
    const domainUniverse = new Set([...candidates, ...predicted]);
    const local = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 };
    for (const domain of domainUniverse) {
      const truth = expected.includes(domain);
      const prediction = predicted.has(domain);
      if (truth && prediction) local.truePositive++;
      else if (!truth && prediction) local.falsePositive++;
      else if (truth && !prediction) local.falseNegative++;
      else local.trueNegative++;
    }
    for (const key of Object.keys(counts)) counts[key] += local[key];
    results.push(Object.freeze({
      caseId,
      ...local,
      predictedDomains: Object.freeze([...predicted].sort()),
      expectedDisappearedDomains: Object.freeze([...expected].sort()),
      observationLagSeconds: report.observationLagSeconds,
      observationFreshness: report.observationFreshness
    }));
  }
  const ratio = (numerator, denominator) => denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
  const precision = ratio(counts.truePositive, counts.truePositive + counts.falsePositive);
  const recall = ratio(counts.truePositive, counts.truePositive + counts.falseNegative);
  const specificity = ratio(counts.trueNegative, counts.trueNegative + counts.falsePositive);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : Number((2 * precision * recall / (precision + recall)).toFixed(4));
  return Object.freeze({
    schemaVersion: "1.0.0",
    type: "geo_citation_alert_quality_report",
    evaluationMethod: "caller_labelled_domain_disappearance",
    labelSource: "caller_supplied",
    caseCount: results.length,
    counts: Object.freeze(counts),
    metrics: Object.freeze({
      precision,
      recall,
      specificity,
      falsePositiveRate: specificity === null ? null : Number((1 - specificity).toFixed(4)),
      f1
    }),
    cases: Object.freeze(results)
  });
}
