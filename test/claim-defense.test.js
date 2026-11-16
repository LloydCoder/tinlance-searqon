import test from "node:test";
import assert from "node:assert/strict";
import { createBrandTruthRegistry } from "../src/geo-registry.js";
import { extractBrandClaims, evaluateBrandClaims } from "../src/claim-defense.js";

function makeRegistry(overrides = {}) {
  return createBrandTruthRegistry({
    brandName: "Searqon",
    primaryDomain: "searqon.com",
    aliases: ["Searqon Intelligence"],
    assertedBy: "founder-01",
    createdAt: "2026-11-16T12:00:00.000Z",
    facts: [
      {
        attribute: "product.category",
        value: "AI-search intelligence platform",
        statement: "Searqon is an AI-search intelligence platform.",
        status: "corroborated",
        sourceUrls: ["https://searqon.com/about", "https://docs.searqon.com/product"],
        reviewedBy: "reviewer-01",
        reviewedAt: "2026-11-16T12:00:00.000Z"
      },
      {
        attribute: "product.license",
        value: "Apache-2.0",
        statement: "The local toolkit is licensed under Apache-2.0.",
        status: "owner_asserted",
        sourceUrls: ["https://github.com/LloydCoder/tinlance-searqon"]
      }
    ],
    ...overrides
  });
}

const observedAt = "2026-11-16T13:00:00.000Z";

test("claim extraction finds brand sentences and resolves approved aliases", () => {
  const registry = makeRegistry();
  const claims = extractBrandClaims(
    "Searqon is an AI-search intelligence platform. Other products exist. Searqon Intelligence helps teams assess visibility.",
    registry
  );
  assert.equal(claims.length, 2);
  assert.equal(claims[0].matchedBrandTerm.toLowerCase(), "searqon");
  assert.equal(claims[1].matchedBrandTerm, "Searqon Intelligence");
  assert.ok(claims.every(claim => claim.claimId.startsWith("claim_")));
});

test("registry-consistent claims are distinguished from independently verified facts", () => {
  const registry = makeRegistry();
  const claims = extractBrandClaims("Searqon is an AI-search intelligence platform.", registry);
  const report = evaluateBrandClaims({ registry, claims, observedAt });
  assert.equal(report.results[0].assessment, "registry_consistent");
  assert.equal(report.results[0].factStatus, "corroborated");
  assert.equal(report.results[0].confidence, "high");
  assert.equal(report.results[0].citationAssessment, "missing_citation");
  assert.equal(report.summary.registryConsistent, 1);
});

test("contradictory structured claims produce a review-only correction manifest", () => {
  const registry = makeRegistry();
  const report = evaluateBrandClaims({
    registry,
    observedAt,
    claims: [{
      text: "Searqon is a social media scheduling tool.",
      attribute: "product.category",
      value: "social media scheduling tool",
      citationUrls: []
    }]
  });
  assert.equal(report.results[0].assessment, "potential_contradiction");
  assert.equal(report.results[0].registryValue, "AI-search intelligence platform");
  assert.equal(report.correctionManifest.approvalRequired, true);
  assert.equal(report.correctionManifest.autoPublish, false);
  assert.equal(report.correctionManifest.items.length, 1);
  assert.equal(report.correctionManifest.items[0].proposedCorrection, "Searqon is an AI-search intelligence platform.");
});

test("unsupported claims are not silently rewritten or treated as facts", () => {
  const registry = makeRegistry();
  const report = evaluateBrandClaims({
    registry, observedAt,
    claims: [{ text: "Searqon is the world's most accurate platform.", attribute: "product.accuracy", value: "world's most accurate" }]
  });
  assert.equal(report.results[0].assessment, "unverified");
  assert.equal(report.results[0].confidence, "none");
  assert.equal(report.correctionManifest.items[0].proposedCorrection, null);
});

test("citation attribution distinguishes registry sources, unrelated sources and competitor sources", () => {
  const registry = makeRegistry();
  const claim = { text: "Searqon is an AI-search intelligence platform.", attribute: "product.category", value: "AI-search intelligence platform" };
  const matched = evaluateBrandClaims({ registry, observedAt, claims: [{ ...claim, citationUrls: ["https://searqon.com/about?utm_source=answer"] }] });
  assert.equal(matched.results[0].citationAssessment, "matched_registry_source");
  const unrelated = evaluateBrandClaims({ registry, observedAt, claims: [{ ...claim, citationUrls: ["https://news.example.com/story"] }] });
  assert.equal(unrelated.results[0].citationAssessment, "citation_unverified");
  const competitor = evaluateBrandClaims({ registry, observedAt, competitorDomains: ["competitor.com"], claims: [{ ...claim, citationUrls: ["https://competitor.com/searqon"] }] });
  assert.equal(competitor.results[0].citationAssessment, "attribution_swap");
  assert.ok(competitor.results[0].riskFlags.includes("attribution_swap"));
});

test("stale and disputed registry facts are never treated as supported", () => {
  const staleRegistry = createBrandTruthRegistry({
    brandName: "Searqon", primaryDomain: "searqon.com", assertedBy: "founder",
    createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
    facts: [{ attribute: "product.category", value: "Old category", statement: "Searqon is an old category.", status: "owner_asserted", assertedAt: "2024-01-01T00:00:00.000Z" }]
  });
  const stale = evaluateBrandClaims({
    registry: staleRegistry, observedAt,
    claims: [{ text: "Searqon is an old category.", attribute: "product.category", value: "Old category" }]
  });
  assert.equal(stale.results[0].assessment, "stale");
  assert.ok(stale.results[0].riskFlags.includes("stale_registry_fact"));

  const disputedRegistry = createBrandTruthRegistry({
    brandName: "Searqon", primaryDomain: "searqon.com", assertedBy: "founder",
    createdAt: "2026-11-16T12:00:00.000Z",
    facts: [{ attribute: "product.category", value: "AI-search platform", statement: "Searqon is an AI-search platform.", status: "disputed", sourceUrls: ["https://searqon.com/about"], reviewedBy: "reviewer", reviewedAt: "2026-11-16T12:00:00.000Z" }]
  });
  const disputed = evaluateBrandClaims({
    registry: disputedRegistry, observedAt,
    claims: [{ text: "Searqon is an AI-search platform.", attribute: "product.category", value: "AI-search platform" }]
  });
  assert.equal(disputed.results[0].assessment, "disputed");
  assert.ok(disputed.results[0].riskFlags.includes("disputed_registry_fact"));
});

test("claim defense rejects tampered registries and oversized inputs", () => {
  const registry = makeRegistry();
  const altered = structuredClone(registry);
  altered.brand.name = "Different";
  assert.throws(() => extractBrandClaims("Searqon is great.", altered), /digest|integrity/i);
  assert.throws(() => extractBrandClaims("x".repeat(100_001), registry), /100000|maximum/i);
  assert.throws(() => evaluateBrandClaims({ registry, observedAt: "not-a-date", claims: [{ text: "Searqon" }] }), /ISO 8601/i);
});
