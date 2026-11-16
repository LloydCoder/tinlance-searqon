import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createBrandTruthRegistry,
  createPromptCohort,
  buildGeoSamplingPlan
} from "../src/geo-registry.js";

const reviewed = {
  status: "approved",
  reviewedAt: "2026-11-16T12:00:00.000Z",
  reviewerId: "policy-reviewer-01",
  sourceUrl: "https://provider.example.com/policies/terms?campaign=private#section"
};

function registry() {
  return createBrandTruthRegistry({
    brandName: "Searqon",
    primaryDomain: "searqon.com",
    aliases: ["Searqon Intelligence", "Searqon"],
    assertedBy: "founder-01",
    createdAt: "2026-11-16T12:00:00.000Z",
    facts: [
      {
        attribute: "product.category",
        value: "AI-search intelligence platform",
        statement: "Searqon is an AI-search intelligence platform.",
        status: "owner_asserted",
        sourceUrls: ["https://searqon.com/about?utm_source=private"]
      },
      {
        attribute: "product.license",
        value: "Apache-2.0",
        statement: "The local toolkit is licensed under Apache-2.0.",
        status: "corroborated",
        sourceUrls: ["https://github.com/LloydCoder/tinlance-searqon"],
        reviewedBy: "reviewer-02",
        reviewedAt: "2026-11-16T12:00:00.000Z"
      }
    ]
  });
}

function cohort() {
  return createPromptCohort({
    registry: registry(),
    locale: "en-CA",
    market: "CA",
    createdAt: "2026-11-16T12:00:00.000Z",
    prompts: [
      { prompt: "What are the best AI search visibility tools for B2B SaaS?", intent: "commercial", journeyStage: "consideration" },
      { prompt: "  WHAT are the best AI search visibility tools for B2B SaaS? ", intent: "commercial", journeyStage: "consideration" },
      { prompt: "How can a company improve its visibility in AI answers?", intent: "informational", journeyStage: "awareness" }
    ]
  });
}

test("brand truth registry normalizes identity, aliases, and fact provenance", () => {
  const result = registry();
  assert.equal(result.schemaVersion, "1.0.0");
  assert.equal(result.brand.primaryDomain, "searqon.com");
  assert.deepEqual(result.brand.aliases, ["Searqon Intelligence"]);
  assert.equal(result.facts.length, 2);
  assert.equal(result.facts[0].sourceUrls[0], "https://searqon.com/about");
  assert.equal(result.facts[1].status, "corroborated");
  assert.ok(result.registryId.startsWith("btr_"));
});

test("brand truth registry rejects unreviewed corroboration and duplicate attributes without versioning", () => {
  assert.throws(() => createBrandTruthRegistry({
    brandName: "Searqon",
    primaryDomain: "searqon.com",
    assertedBy: "founder",
    createdAt: "2026-11-16T12:00:00.000Z",
    facts: [{ attribute: "product.category", value: "SaaS", statement: "Searqon is SaaS.", status: "corroborated", sourceUrls: [] }]
  }), /reviewedBy|reviewedAt|source/i);
  assert.throws(() => createBrandTruthRegistry({
    brandName: "Searqon",
    primaryDomain: "searqon.com",
    assertedBy: "founder",
    createdAt: "2026-11-16T12:00:00.000Z",
    facts: [
      { attribute: "product.category", value: "A", statement: "A", status: "owner_asserted" },
      { attribute: "product.category", value: "B", statement: "B", status: "owner_asserted" }
    ]
  }), /duplicate/i);
});

test("prompt cohorts normalize locale and deterministically deduplicate equivalent prompts", () => {
  const first = cohort();
  const second = cohort();
  assert.equal(first.cohortId, second.cohortId);
  assert.equal(first.prompts.length, 2);
  assert.equal(first.locale, "en-CA");
  assert.equal(first.brand.registryId, registry().registryId);
  assert.ok(first.prompts.every(item => item.promptId.startsWith("prompt_")));
});

test("sampling plans keep consumer observations manual and model API samples separate", () => {
  const plan = buildGeoSamplingPlan({
    cohort: cohort(),
    sampleCount: 2,
    costCapUsd: 1,
    createdAt: "2026-11-16T12:00:00.000Z",
    providers: [
      { name: "ChatGPT consumer UI", observationClass: "consumer_observation", collectionMode: "manual_capture", policyReview: reviewed, estimatedCostPerSampleUsd: 0.1, maxSamples: 10 },
      { name: "OpenAI API", observationClass: "model_api", collectionMode: "official_api", adapterId: "openai.responses.v1", policyReview: reviewed, estimatedCostPerSampleUsd: 0.1, maxSamples: 10 }
    ]
  });
  assert.equal(plan.tasks.length, 8);
  assert.equal(plan.estimatedCostUsd, 0.8);
  assert.equal(plan.providers[0].observationClass, "consumer_observation");
  assert.equal(plan.providers[0].collectionMode, "manual_capture");
  assert.equal(plan.providers[1].observationClass, "model_api");
  assert.equal(plan.providers[1].collectionMode, "official_api");
  assert.equal(plan.tasks.some(item => item.status !== "planned"), false);
  assert.equal(JSON.stringify(plan).includes("private"), false);
});

test("sampling plans reject automated consumer UI collection and unapproved provider policy", () => {
  assert.throws(() => buildGeoSamplingPlan({
    cohort: cohort(),
    sampleCount: 1,
    costCapUsd: 1,
    providers: [{ name: "Consumer UI", observationClass: "consumer_observation", collectionMode: "browser_automation", policyReview: reviewed, maxSamples: 2 }]
  }), /manual_capture/i);
  assert.throws(() => buildGeoSamplingPlan({
    cohort: cohort(),
    sampleCount: 1,
    costCapUsd: 1,
    providers: [{ name: "Model API", observationClass: "model_api", collectionMode: "official_api", adapterId: "provider.v1", policyReview: { ...reviewed, status: "pending" }, maxSamples: 2 }]
  }), /approved/i);
});

test("sampling plans enforce per-provider caps, request caps, and budget ceilings", () => {
  const provider = { name: "API", observationClass: "model_api", collectionMode: "official_api", adapterId: "api.v1", policyReview: reviewed, estimatedCostPerSampleUsd: 1, maxSamples: 2 };
  assert.throws(() => buildGeoSamplingPlan({ cohort: cohort(), sampleCount: 2, costCapUsd: 100, providers: [provider] }), /maxSamples/i);
  assert.throws(() => buildGeoSamplingPlan({ cohort: cohort(), sampleCount: 1, costCapUsd: 0.5, providers: [{ ...provider, maxSamples: 10 }] }), /budget/i);
});


test("GEO registry, cohort and sampling outputs match their published schemas", async () => {
  const registrySchema = JSON.parse(await readFile(new URL("../schemas/brand-truth-registry.schema.json", import.meta.url), "utf8"));
  const cohortSchema = JSON.parse(await readFile(new URL("../schemas/geo-prompt-cohort.schema.json", import.meta.url), "utf8"));
  const planSchema = JSON.parse(await readFile(new URL("../schemas/geo-sampling-plan.schema.json", import.meta.url), "utf8"));
  const brand = registry();
  const prompts = cohort();
  const plan = buildGeoSamplingPlan({
    cohort: prompts, sampleCount: 1, costCapUsd: 1,
    createdAt: "2026-11-16T12:00:00.000Z",
    providers: [{ name: "Manual", observationClass: "consumer_observation", collectionMode: "manual_capture", policyReview: reviewed, estimatedCostPerSampleUsd: 0, maxSamples: 2 }]
  });
  assert.deepEqual(Object.keys(brand).sort(), [...registrySchema.required].sort());
  assert.deepEqual(Object.keys(brand.facts[0]).sort(), [...registrySchema.properties.facts.items.required].sort());
  assert.deepEqual(Object.keys(prompts).sort(), [...cohortSchema.required].sort());
  assert.deepEqual(Object.keys(plan).sort(), [...planSchema.required].sort());
  assert.deepEqual(Object.keys(plan.providers[0]).sort(), [...planSchema.properties.providers.items.required].sort());
});

test("registry timestamps are monotonic and provider credentials are rejected", () => {
  assert.throws(() => createBrandTruthRegistry({
    brandName: "Searqon", primaryDomain: "searqon.com", assertedBy: "founder",
    createdAt: "2026-11-16T12:00:00.000Z", updatedAt: "2026-11-15T12:00:00.000Z"
  }), /updatedAt/i);
  assert.throws(() => buildGeoSamplingPlan({
    cohort: cohort(), sampleCount: 1, costCapUsd: 1,
    createdAt: "2026-11-16T12:00:00.000Z",
    providers: [{ name: "API", observationClass: "model_api", collectionMode: "official_api", adapterId: "api.v1", apiKey: "never-store-this", policyReview: reviewed, estimatedCostPerSampleUsd: 0, maxSamples: 2 }]
  }), /credential|secret|token|api.?key/i);
});


test("prompt cohorts reject a tampered Brand Truth Registry digest", () => {
  const altered = structuredClone(registry());
  altered.brand.name = "Different Brand";
  assert.throws(() => createPromptCohort({
    registry: altered,
    locale: "en-CA",
    createdAt: "2026-11-16T12:00:00.000Z",
    prompts: [{ prompt: "Best tools?" }]
  }), /digest|integrity/i);
});
