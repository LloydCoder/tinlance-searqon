import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const TEST_WEBHOOK_SECRET = "x".repeat(40);
import { analyzeGeoObservation, wilsonInterval } from "../src/geo.js";
import {
  detectCitationChanges,
  buildGeoAlerts,
  createSignedAlertEvent,
  verifySignedAlertEvent,
  createDeliveryReceipt,
  createWebhookReplayGuard,
  evaluateGeoCitationAlertQuality,
  toSlackWebhookPayload,
  toTeamsWorkflowPayload,
  toPagerDutyEvent
} from "../src/geo-alerts.js";

function sample(overrides = {}) {
  return analyzeGeoObservation({
    prompt: "Which platform should teams use?",
    answer: "Searqon is a useful platform for teams.",
    brand: "Searqon",
    targetDomain: "searqon.com",
    citations: ["https://searqon.com/docs"],
    provider: { name: "Example Search", observationClass: "consumer_observation", region: "US", locale: "en-US" },
    sampledAt: "2026-11-10T12:00:00.000Z",
    ...overrides
  });
}

function cohort(count, options = {}) {
  return Array.from({ length: count }, (_, index) => sample({
    prompt: "Which platform should teams use? variant " + index,
    answer: options.mentioned === false ? "A different platform is listed." : "Searqon is a useful platform for teams.",
    citations: options.citations ?? ["https://searqon.com/docs"],
    sampledAt: options.sampledAt ?? "2026-11-10T12:00:00.000Z"
  }));
}

test("detects citation disappearance only across comparable cohorts with sufficient samples", () => {
  const baseline = cohort(30);
  const current = cohort(30, { citations: ["https://competitor.example/guide"], sampledAt: "2026-11-16T12:00:00.000Z" });
  const report = detectCitationChanges({ baseline, current, observedAt: "2026-11-16T13:00:00.000Z", policy: { minimumSamples: 20, minimumAbsoluteChange: 0.2 } });
  assert.equal(report.events.length, 1);
  assert.equal(report.events[0].changeType, "citation_disappearance");
  assert.equal(report.events[0].baselineRate, 1);
  assert.equal(report.events[0].currentRate, 0);
  assert.equal(report.events[0].baselineSampleSize, 30);
  assert.equal(report.events[0].currentSampleSize, 30);
  assert.ok(report.events[0].evidenceIds.length >= 2);
});

test("suppresses low-sample and low-effect changes rather than emitting confident alerts", () => {
  const report = detectCitationChanges({
    baseline: cohort(3),
    current: cohort(3, { citations: ["https://competitor.example/guide"], sampledAt: "2026-11-16T12:00:00.000Z" }),
    observedAt: "2026-11-16T13:00:00.000Z",
    policy: { minimumSamples: 10, minimumAbsoluteChange: 0.1 }
  });
  assert.equal(report.events.length, 0);
  assert.equal(report.suppressed.length, 1);
  assert.equal(report.suppressed[0].reason, "insufficient_samples");
});

test("rejects incomparable provider, locale, region, brand or observation-class cohorts", () => {
  const baseline = cohort(5);
  const current = cohort(5).map(item => ({ ...item, provider: { ...item.provider, name: "Different Provider" } }));
  assert.throws(() => detectCitationChanges({ baseline, current, observedAt: "2026-11-16T13:00:00.000Z" }), /comparable cohort/);
});

test("does not pool consumer observations with direct model API observations", () => {
  const baseline = cohort(5);
  const current = cohort(5).map(item => ({ ...item, observationClass: "model_api", evidence: { ...item.evidence, observationClass: "model_api" } }));
  assert.throws(() => detectCitationChanges({ baseline, current, observedAt: "2026-11-16T13:00:00.000Z" }), /comparable cohort/);
});

test("rejects duplicate evidence identifiers and invalid policy bounds", () => {
  const one = sample();
  assert.throws(() => detectCitationChanges({ baseline: [one, one], current: cohort(2), observedAt: "2026-11-16T13:00:00.000Z" }), /duplicate evidence/);
  assert.throws(() => detectCitationChanges({ baseline: cohort(2), current: cohort(2), observedAt: "2026-11-16T13:00:00.000Z", policy: { minimumSamples: 0 } }), /minimumSamples/);
});

test("event identity is deterministic for the same evidence and methodology", () => {
  const input = { baseline: cohort(20), current: cohort(20, { citations: ["https://competitor.example/guide"], sampledAt: "2026-11-16T12:00:00.000Z" }), observedAt: "2026-11-16T13:00:00.000Z" };
  const first = detectCitationChanges(input);
  const second = detectCitationChanges(input);
  assert.equal(first.events[0].eventId, second.events[0].eventId);
});

const baselineAt = "2026-11-16T12:00:00.000Z";
const currentAt = "2026-11-16T13:00:00.000Z";
const evaluatedAt = "2026-11-16T13:01:00.000Z";

function row({ mentionCount = 80, brandCitationCount = 70, sampleSize = 100, providerName = "OpenAI", model = "gpt-4.1", region = "us", locale = "en-US", observationClass = "model_api", brand = "Searqon", targetDomain = "searqon.com", evidenceSeed = "baseline", evidenceIds = null } = {}) {
  return {
    observationClass,
    provider: { name: providerName, model, region, locale },
    brand,
    targetDomain,
    samplePeriod: null,
    sampleSize,
    mentionCount,
    mentionOccurrences: mentionCount,
    brandCitationCount,
    citationCount: brandCitationCount,
    evidenceIds: evidenceIds ?? Array.from({ length: Math.min(sampleSize, 500) }, (_, index) => "evidence_" + (index + (evidenceSeed === "current" ? 1001 : 1)).toString(16).padStart(20, "0")),
    evidenceCount: sampleSize,
    evidenceTruncated: sampleSize > 500,
    mentionRate: Number((mentionCount / sampleSize).toFixed(4)),
    mentionRate95: wilsonInterval(mentionCount, sampleSize),
    brandCitationRate: Number((brandCitationCount / sampleSize).toFixed(4)),
    brandCitationRate95: wilsonInterval(brandCitationCount, sampleSize)
  };
}

function input(overrides = {}) {
  return {
    baseline: [row()],
    current: [row({ mentionCount: 40, brandCitationCount: 20, evidenceSeed: "current" })],
    baselineId: "baseline-2026-11-16T12",
    currentId: "current-2026-11-16T13",
    baselineAt,
    currentAt,
    evaluatedAt,
    ...overrides
  };
}

test("alerts detect significant mention and citation declines only for comparable cohorts", () => {
  const result = buildGeoAlerts(input());
  assert.equal(result.alerts.length, 2);
  assert.equal(result.summary.alerts, 2);
  assert.ok(result.alerts.every(alert => alert.direction === "decline"));
  assert.deepEqual(result.alerts.map(alert => alert.metric).sort(), ["brand_citation", "mention"]);
  assert.equal(result.summary.cohortsCompared, 1);
  assert.equal(result.alerts[0].evidence.baselineEvidenceIds.length, 100);
  assert.equal(result.alerts[0].evidence.currentEvidenceIds.length, 100);
  assert.equal(result.alerts[0].evidence.truncated, false);
  assert.ok(result.alerts.every(alert => alert.severity === "high"));
  assert.ok(result.alerts.every(alert => alert.baseline.sampleSize === 100 && alert.current.sampleSize === 100));
  assert.equal(result.observationLagSeconds, 60);
  assert.ok(result.alerts.every(alert => alert.dimensions.observationClass === "model_api"));
});

test("small samples and overlapping Wilson intervals do not produce alerts", () => {
  const small = buildGeoAlerts(input({
    baseline: [row({ sampleSize: 4, mentionCount: 4, brandCitationCount: 3 })],
    current: [row({ sampleSize: 4, mentionCount: 1, brandCitationCount: 1, evidenceSeed: "current" })],
    minSampleSize: 5
  }));
  assert.equal(small.alerts.length, 0);
  assert.ok(small.evaluations.every(item => item.status === "insufficient_evidence"));

  const overlap = buildGeoAlerts(input({
    baseline: [row({ mentionCount: 70, brandCitationCount: 60 })],
    current: [row({ mentionCount: 65, brandCitationCount: 58, evidenceSeed: "current" })]
  }));
  assert.equal(overlap.alerts.length, 0);
  assert.ok(overlap.evaluations.every(item => item.status === "no_significant_change"));
});

test("cohort mismatches are reported as new/missing cohorts, never compared", () => {
  const result = buildGeoAlerts(input({
    current: [row({ mentionCount: 10, brandCitationCount: 5, model: "different-model" })]
  }));
  assert.equal(result.alerts.length, 0);
  assert.ok(result.evaluations.some(item => item.status === "new_cohort" && item.dimensions.observationClass));
  assert.ok(result.evaluations.some(item => item.status === "cohort_missing" && item.dimensions.provider.name));
});

test("alert evaluation rejects duplicate cohorts and invalid chronological inputs", () => {
  assert.throws(() => buildGeoAlerts(input({ baseline: [row(), row()] })), /duplicate/i);
  assert.throws(() => buildGeoAlerts(input({ currentAt: baselineAt })), /later/i);
  assert.throws(() => buildGeoAlerts(input({ minAbsoluteChange: 0 })), /minAbsoluteChange/i);
});

test("dedupe keys and cooldown suppress repeated notifications without hiding evaluations", () => {
  const first = buildGeoAlerts(input());
  const previousAlerts = first.alerts.map(alert => ({ dedupeKey: alert.dedupeKey, lastNotifiedAt: currentAt }));
  const repeated = buildGeoAlerts(input({ evaluatedAt: "2026-11-16T13:02:00.000Z", previousAlerts, cooldownSeconds: 3600 }));
  assert.equal(repeated.alerts.length, 0);
  assert.equal(repeated.suppressedAlerts.length, 2);
  assert.ok(repeated.suppressedAlerts.every(alert => alert.suppressionReason === "cooldown"));
  assert.equal(repeated.evaluations.length, 2);
});

test("signed alert webhooks verify HMAC, reject tampering and enforce timestamp tolerance", () => {
  const alert = buildGeoAlerts(input()).alerts[0];
  const secret = TEST_WEBHOOK_SECRET;
  const timestampSeconds = 1_800_000_000;
  const signed = createSignedAlertEvent(alert, secret, timestampSeconds);
  const verified = verifySignedAlertEvent({
    rawBody: signed.body,
    secret,
    timestamp: signed.headers["x-searqon-timestamp"],
    signature: signed.headers["x-searqon-signature"],
    eventId: signed.headers["x-searqon-event-id"],
    nowSeconds: timestampSeconds
  });
  assert.equal(verified.data.alertId, alert.alertId);
  assert.throws(() => verifySignedAlertEvent({
    rawBody: signed.body + " ",
    secret,
    timestamp: signed.headers["x-searqon-timestamp"],
    signature: signed.headers["x-searqon-signature"],
    nowSeconds: timestampSeconds
  }), /signature/i);
  assert.throws(() => verifySignedAlertEvent({
    rawBody: signed.body,
    secret,
    timestamp: signed.headers["x-searqon-timestamp"],
    signature: signed.headers["x-searqon-signature"],
    nowSeconds: timestampSeconds + 301
  }), /timestamp/i);
  assert.throws(() => createSignedAlertEvent(alert, "short", timestampSeconds), /32/i);
});

test("delivery receipts record success and bounded retry schedules without secrets", () => {
  const alert = buildGeoAlerts(input()).alerts[0];
  const failed = createDeliveryReceipt({
    alert,
    destination: "slack-workspace-01",
    attempt: 2,
    attemptedAt: evaluatedAt,
    outcome: "retryable_failure",
    httpStatus: 429,
    retryAfterSeconds: 120
  });
  assert.equal(failed.status, "retryable_failure");
  assert.equal(failed.nextAttemptAt, "2026-11-16T13:03:00.000Z");
  assert.equal(JSON.stringify(failed).includes("secret"), false);

  const delivered = createDeliveryReceipt({
    alert,
    destination: "pagerduty-service-01",
    attempt: 1,
    attemptedAt: evaluatedAt,
    outcome: "delivered",
    httpStatus: 202,
    providerReceiptId: "pd-receipt-01"
  });
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.providerReceiptId, "pd-receipt-01");
  assert.equal(delivered.nextAttemptAt, null);
});

test("Slack, Teams Workflows and PagerDuty payload builders produce bounded provider formats", () => {
  const alert = buildGeoAlerts(input()).alerts[0];
  const slack = toSlackWebhookPayload(alert);
  assert.equal(typeof slack.text, "string");
  assert.ok(Array.isArray(slack.blocks));
  assert.equal(slack.mrkdwn, false);
  assert.ok(slack.blocks.every(block => block.text?.type === "plain_text" || block.elements?.every(element => element.type === "plain_text")));
  assert.equal(Object.hasOwn(slack, "webhookUrl"), false);

  const teams = toTeamsWorkflowPayload(alert);
  assert.equal(teams.type, "message");
  assert.equal(teams.attachments[0].content.type, "AdaptiveCard");
  assert.equal(teams.attachments[0].content.version, "1.2");
  assert.equal(teams.attachments[0].contentUrl, null);

  const pagerDuty = toPagerDutyEvent(alert, { routingKey: "a".repeat(32), source: "searqon.geo" });
  assert.equal(pagerDuty.event_action, "trigger");
  assert.equal(pagerDuty.dedup_key, alert.dedupeKey);
  assert.equal(pagerDuty.routing_key, "a".repeat(32));
  assert.equal(pagerDuty.payload.severity, "critical");
  assert.throws(() => toPagerDutyEvent(alert, { routingKey: "short", source: "searqon.geo" }), /routingKey/i);
});

test("consumer and model API observations remain separate cohorts", () => {
  const result = buildGeoAlerts(input({
    baseline: [row()],
    current: [row({ observationClass: "consumer_observation", mentionCount: 10, brandCitationCount: 5 })]
  }));
  assert.equal(result.alerts.length, 0);
  assert.ok(result.evaluations.some(item => item.status === "new_cohort"));
  assert.ok(result.evaluations.some(item => item.status === "cohort_missing"));
});

test("invalid aggregate counts, normalized metadata and stale time windows fail closed", () => {
  assert.throws(() => buildGeoAlerts(input({ baseline: [row({ sampleSize: 10, mentionCount: 11 })] })), /mentionCount/);
  assert.throws(() => buildGeoAlerts(input({ current: [row({ providerName: " OpenAI" })] })), /normalized/);
  assert.throws(() => buildGeoAlerts(input({ evaluatedAt: "2026-11-16T12:59:00.000Z" })), /earlier/);
});

test("webhook verification binds the event id and rejects malformed envelopes", () => {
  const alert = buildGeoAlerts(input()).alerts[0];
  const signed = createSignedAlertEvent(alert, TEST_WEBHOOK_SECRET, 1_800_000_000);
  assert.throws(() => verifySignedAlertEvent({
    rawBody: signed.body,
    secret: TEST_WEBHOOK_SECRET,
    timestamp: signed.headers["x-searqon-timestamp"],
    signature: signed.headers["x-searqon-signature"],
    eventId: "00000000-0000-4000-8000-000000000000",
    nowSeconds: 1_800_000_000
  }), /envelope/);
});

test("delivery receipts bound retries and reject impossible success states", () => {
  const alert = buildGeoAlerts(input()).alerts[0];
  assert.throws(() => createDeliveryReceipt({
    alert, destination: "slack-1", attempt: 9, attemptedAt: evaluatedAt, outcome: "retryable_failure"
  }), /attempt/);
  assert.throws(() => createDeliveryReceipt({
    alert, destination: "slack-1", attempt: 1, attemptedAt: evaluatedAt, outcome: "delivered", httpStatus: 503
  }), /successful/);
});

test("citation disappearance requires valid evidence provenance", () => {
  const baseline = cohort(3);
  const current = cohort(3, { citations: ["https://competitor.example/guide"], sampledAt: "2026-11-16T12:00:00.000Z" });
  const corrupted = current.map((item, index) => index === 0
    ? { ...item, evidence: { ...item.evidence, source: "untrusted-source" } }
    : item);
  assert.throws(() => detectCitationChanges({
    baseline,
    current: corrupted,
    observedAt: "2026-11-16T13:00:00.000Z",
    policy: { minimumSamples: 2, minimumAbsoluteChange: 0.2 }
  }), /evidence provenance/i);
});

test("signed webhook envelope creation time must match the signed timestamp header", () => {
  const alert = buildGeoAlerts(input()).alerts[0];
  const signed = createSignedAlertEvent(alert, TEST_WEBHOOK_SECRET, 1_800_000_000);
  const altered = JSON.parse(signed.body);
  altered.createdAt = "2026-11-16T13:00:00.000Z";
  const rawBody = JSON.stringify(altered);
  const signature = "v1=" + createHmac("sha256", TEST_WEBHOOK_SECRET)
    .update(signed.headers["x-searqon-timestamp"] + "." + rawBody)
    .digest("hex");
  assert.throws(() => verifySignedAlertEvent({
    rawBody,
    secret: TEST_WEBHOOK_SECRET,
    timestamp: signed.headers["x-searqon-timestamp"],
    signature,
    eventId: signed.headers["x-searqon-event-id"],
    nowSeconds: 1_800_000_000
  }), /envelope/i);
});

test("webhook replay guard rejects duplicate IDs and fails closed at capacity", () => {
  assert.throws(() => createWebhookReplayGuard({ ttlSeconds: 300, timestampToleranceSeconds: 300 }), /exceed/i);
  const guard = createWebhookReplayGuard({ maxEntries: 1, ttlSeconds: 900, timestampToleranceSeconds: 300 });
  const firstId = "123e4567-e89b-42d3-a456-426614174000";
  const secondId = "123e4567-e89b-42d3-a456-426614174001";
  assert.equal(guard.claim(firstId, 1_800_000_000, 1_800_000_000), true);
  assert.equal(guard.claim(firstId, 1_800_000_000, 1_800_000_000), false);
  assert.equal(guard.size(), 1);
  assert.throws(() => guard.claim(secondId, 1_800_000_000, 1_800_000_000), /capacity/i);
  assert.throws(() => guard.claim(secondId, 1_800_000_000, 1_800_000_400), /timestamp/i);
});

test("labelled citation alert evaluation reports precision recall and false-positive rate", () => {
  const positiveBaseline = cohort(20);
  const positiveCurrent = cohort(20, { citations: ["https://competitor.example/guide"], sampledAt: "2026-11-16T12:00:00.000Z" });
  const negativeBaseline = cohort(20);
  const negativeCurrent = cohort(20, { sampledAt: "2026-11-16T12:00:00.000Z" });
  const quality = evaluateGeoCitationAlertQuality({
    cases: [
      {
        caseId: "positive-loss",
        baseline: positiveBaseline,
        current: positiveCurrent,
        observedAt: "2026-11-16T13:00:00.000Z",
        candidateDomains: ["searqon.com", "competitor.example"],
        expectedDisappearedDomains: ["searqon.com"]
      },
      {
        caseId: "negative-stable",
        baseline: negativeBaseline,
        current: negativeCurrent,
        observedAt: "2026-11-16T13:00:00.000Z",
        candidateDomains: ["searqon.com"],
        expectedDisappearedDomains: []
      }
    ],
    policy: { minimumSamples: 10, minimumAbsoluteChange: 0.2 }
  });
  assert.equal(quality.caseCount, 2);
  assert.equal(quality.counts.truePositive, 1);
  assert.equal(quality.counts.falsePositive, 0);
  assert.equal(quality.counts.falseNegative, 0);
  assert.equal(quality.metrics.precision, 1);
  assert.equal(quality.metrics.recall, 1);
  assert.equal(quality.metrics.falsePositiveRate, 0);
});

test("citation alert reports disclose observation lag and stale data status", () => {
  const baseline = cohort(20);
  const current = cohort(20, { citations: ["https://competitor.example/guide"], sampledAt: "2026-11-16T12:00:00.000Z" });
  const report = detectCitationChanges({
    baseline,
    current,
    observedAt: "2026-11-16T13:00:00.000Z",
    policy: { minimumSamples: 10, minimumAbsoluteChange: 0.2, maxObservationAgeSeconds: 60 }
  });
  assert.equal(report.observationLagSeconds, 3600);
  assert.equal(report.observationFreshness, "stale");
});

test("aggregate snapshot comparisons reject reused evidence identifiers", () => {
  assert.throws(() => buildGeoAlerts(input({
    current: [row({ mentionCount: 40, brandCitationCount: 20, evidenceSeed: "baseline" })]
  })), /duplicate evidence identifiers/i);
});

test("aggregate alert generation fails closed when evidence references are missing", () => {
  assert.throws(() => buildGeoAlerts(input({ baseline: [row({ evidenceIds: [] })] })), /evidence/);
});
