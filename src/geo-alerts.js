import { createHash } from "node:crypto";
import { aggregateGeoObservations } from "./geo.js";

const MAX_OBSERVATIONS = 5_000;
const DEFAULT_POLICY = Object.freeze({ minimumSamples: 20, minimumAbsoluteChange: 0.2 });

function canonicalTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError("observedAt must be a canonical ISO 8601 UTC timestamp");
  }
  return value;
}

function normalizePolicy(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("policy must be an object");
  const minimumSamples = input.minimumSamples ?? DEFAULT_POLICY.minimumSamples;
  const minimumAbsoluteChange = input.minimumAbsoluteChange ?? DEFAULT_POLICY.minimumAbsoluteChange;
  if (!Number.isSafeInteger(minimumSamples) || minimumSamples < 2 || minimumSamples > 1_000) {
    throw new RangeError("minimumSamples must be an integer between 2 and 1000");
  }
  if (typeof minimumAbsoluteChange !== "number" || !Number.isFinite(minimumAbsoluteChange) || minimumAbsoluteChange <= 0 || minimumAbsoluteChange > 1) {
    throw new RangeError("minimumAbsoluteChange must be greater than 0 and at most 1");
  }
  return Object.freeze({ minimumSamples, minimumAbsoluteChange });
}

function cohortKey(group) {
  return JSON.stringify({
    observationClass: group.observationClass,
    provider: group.provider.name,
    model: group.provider.model,
    region: group.provider.region,
    locale: group.provider.locale,
    brand: group.brand,
    targetDomain: group.targetDomain
  });
}

function citationCounts(observations) {
  const counts = new Map();
  for (const observation of observations) {
    const seen = new Set();
    for (const citation of observation.citations) {
      if (seen.has(citation.url)) continue;
      seen.add(citation.url);
      counts.set(citation.url, (counts.get(citation.url) ?? 0) + 1);
    }
  }
  return counts;
}

function wilson(successes, total) {
  const z = 1.96;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / total) + z2 / (4 * total * total)) / denominator;
  return Object.freeze({ lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) });
}

function eventId(changeType, url, baselineIds, currentIds) {
  const material = JSON.stringify({
    changeType, url,
    baselineEvidenceIds: [...baselineIds].sort(),
    currentEvidenceIds: [...currentIds].sort()
  });
  return "geo_change_" + createHash("sha256").update(material).digest("hex").slice(0, 24);
}

/**
 * Compare two independently captured, comparable GEO cohorts. This function
 * performs no provider calls, URL fetches, scheduling, or notification delivery.
 * Rates describe citation presence per observation, not citation ranking.
 */
export function detectCitationChanges(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("citation change input is required");
  const baseline = input.baseline;
  const current = input.current;
  if (!Array.isArray(baseline) || !Array.isArray(current) || baseline.length === 0 || current.length === 0) {
    throw new TypeError("baseline and current must be non-empty observation arrays");
  }
  if (baseline.length > MAX_OBSERVATIONS || current.length > MAX_OBSERVATIONS) {
    throw new RangeError("each cohort may contain at most " + MAX_OBSERVATIONS + " observations");
  }
  const observedAt = canonicalTimestamp(input.observedAt);
  const policy = normalizePolicy(input.policy);
  const baselineGroups = aggregateGeoObservations(baseline);
  const currentGroups = aggregateGeoObservations(current);
  if (baselineGroups.length !== 1 || currentGroups.length !== 1 || cohortKey(baselineGroups[0]) !== cohortKey(currentGroups[0])) {
    throw new TypeError("baseline and current must be one comparable cohort with identical provider, channel, brand, locale, region and target domain");
  }
  const baselineEnd = baseline.reduce((latest, item) => item.sampledAt > latest ? item.sampledAt : latest, "");
  const currentStart = current.reduce((earliest, item) => item.sampledAt < earliest ? item.sampledAt : earliest, "9999");
  if (currentStart <= baselineEnd) throw new TypeError("current cohort must be sampled strictly after the baseline cohort");
  if (observedAt < current.reduce((latest, item) => item.sampledAt > latest ? item.sampledAt : latest, "")) {
    throw new TypeError("observedAt cannot precede the current cohort");
  }

  const baselineCounts = citationCounts(baseline);
  const currentCounts = citationCounts(current);
  const urls = [...new Set([...baselineCounts.keys(), ...currentCounts.keys()])].sort();
  const baselineIds = baseline.map(item => item.evidence.id);
  const currentIds = current.map(item => item.evidence.id);
  const events = [];
  const suppressed = [];
  for (const url of urls) {
    const before = baselineCounts.get(url) ?? 0;
    const after = currentCounts.get(url) ?? 0;
    const baselineRate = before / baseline.length;
    const currentRate = after / current.length;
    const delta = Number((currentRate - baselineRate).toFixed(4));
    const absoluteChange = Math.abs(delta);
    if (absoluteChange === 0) continue;
    if (baseline.length < policy.minimumSamples || current.length < policy.minimumSamples) {
      suppressed.push(Object.freeze({ citationUrl: url, reason: "insufficient_samples", baselineSampleSize: baseline.length, currentSampleSize: current.length }));
      continue;
    }
    if (absoluteChange < policy.minimumAbsoluteChange) {
      suppressed.push(Object.freeze({ citationUrl: url, reason: "below_minimum_effect", baselineRate, currentRate, absoluteChange }));
      continue;
    }
    const baselineInterval = wilson(before, baseline.length);
    const currentInterval = wilson(after, current.length);
    if (baselineInterval.lower <= currentInterval.upper && currentInterval.lower <= baselineInterval.upper) {
      suppressed.push(Object.freeze({ citationUrl: url, reason: "overlapping_uncertainty_intervals", baselineRate, currentRate, baselineInterval, currentInterval }));
      continue;
    }
    const changeType = before > 0 && after === 0
      ? "citation_disappearance"
      : before === 0 && after > 0
        ? "citation_appearance"
        : "citation_prevalence_change";
    events.push(Object.freeze({
      eventId: eventId(changeType, url, baselineIds, currentIds),
      schemaVersion: "1.0.0",
      type: "geo_citation_change",
      changeType,
      citationUrl: url,
      provider: baselineGroups[0].provider,
      observationClass: baselineGroups[0].observationClass,
      brand: baselineGroups[0].brand,
      targetDomain: baselineGroups[0].targetDomain,
      baselineSampleSize: baseline.length,
      currentSampleSize: current.length,
      baselineCitationCount: before,
      currentCitationCount: after,
      baselineRate: Number(baselineRate.toFixed(4)),
      currentRate: Number(currentRate.toFixed(4)),
      delta,
      baselineInterval,
      currentInterval,
      baselineEvidenceIds: Object.freeze([...new Set(baselineIds)].sort()),
      currentEvidenceIds: Object.freeze([...new Set(currentIds)].sort()),
      observedAt,
      limitations: Object.freeze(["Cohort-relative citation presence only; not citation ranking, causal attribution, or real-time monitoring.", "Wilson intervals are descriptive and do not correct for repeated testing or prompt dependence."])
    }));
  }
  return Object.freeze({
    schemaVersion: "1.0.0",
    type: "geo_citation_change_report",
    methodologyVersion: "geo-citation-change-2026-11-16.1",
    observedAt,
    policy,
    cohort: Object.freeze({
      observationClass: baselineGroups[0].observationClass,
      provider: baselineGroups[0].provider,
      brand: baselineGroups[0].brand,
      targetDomain: baselineGroups[0].targetDomain
    }),
    events: Object.freeze(events.sort((a, b) => a.citationUrl.localeCompare(b.citationUrl))),
    suppressed: Object.freeze(suppressed.sort((a, b) => a.citationUrl.localeCompare(b.citationUrl))),
    summary: Object.freeze({ comparedCitations: urls.length, eventCount: events.length, suppressedCount: suppressed.length })
  });
}
