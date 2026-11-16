import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGeoObservation } from "../src/geo.js";
import { detectCitationChanges } from "../src/geo-alerts.js";

function sample(overrides = {}) {
  return analyzeGeoObservation({
    prompt: "Which platform should teams use?",
    answer: "Searqon is a useful platform for teams.",
    brand: "Searqon",
    targetDomain: "searqon.com",
    citations: ["https://searqon.com/docs"],
    provider: overrides.provider ?? { name: "Example Search", observationClass: "consumer_observation", region: "US", locale: "en-US" },
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
  assert.equal(report.events.length, 2);
  assert.ok(report.events.some(event => event.changeType === "citation_disappearance"));
  assert.ok(report.events.some(event => event.changeType === "citation_appearance"));
  assert.equal(report.events.find(event => event.changeType === "citation_disappearance").baselineRate, 1);
  assert.equal(report.events.find(event => event.changeType === "citation_disappearance").currentRate, 0);
  assert.equal(report.events[0].baselineSampleSize, 30);
  assert.equal(report.events[0].currentSampleSize, 30);
  assert.ok(report.events.every(event => event.baselineEvidenceIds.length === 30 && event.currentEvidenceIds.length === 30));
});

test("suppresses low-sample and low-effect changes rather than emitting confident alerts", () => {
  const report = detectCitationChanges({
    baseline: cohort(3),
    current: cohort(3, { citations: ["https://competitor.example/guide"], sampledAt: "2026-11-16T12:00:00.000Z" }),
    observedAt: "2026-11-16T13:00:00.000Z",
    policy: { minimumSamples: 10, minimumAbsoluteChange: 0.1 }
  });
  assert.equal(report.events.length, 0);
  assert.ok(report.suppressed.length >= 1);
  assert.equal(report.suppressed[0].reason, "insufficient_samples");
});

test("rejects incomparable provider, locale, region, brand or observation-class cohorts", () => {
  const baseline = cohort(5);
  const current = cohort(5, { provider: { name: "Different Provider", observationClass: "consumer_observation", region: "US", locale: "en-US" } });
  assert.throws(() => detectCitationChanges({ baseline, current, observedAt: "2026-11-16T13:00:00.000Z" }), /comparable cohort/);
});

test("does not pool consumer observations with direct model API observations", () => {
  const baseline = cohort(5);
  const current = cohort(5, { provider: { name: "Example Search", observationClass: "model_api", region: "US", locale: "en-US" } });
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
