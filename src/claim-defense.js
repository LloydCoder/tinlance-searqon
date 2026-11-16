import { createHash } from "node:crypto";
import { validateTargetUrl } from "./security/url-policy.js";
import { verifyBrandTruthRegistry } from "./geo-registry.js";

const MAX_ANSWER_CHARS = 100_000;
const MAX_CLAIMS = 1_000;
const MAX_CITATIONS_PER_CLAIM = 20;

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function id(prefix, value) {
  return prefix + digest(value).slice(0, 20);
}
function text(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(name + " must be a non-empty string of at most " + maxLength + " characters");
  }
  return value.trim().normalize("NFKC");
}
function timestamp(value, name) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(name + " must be a canonical ISO 8601 UTC timestamp");
  }
  return value;
}
function normalizedWords(value) {
  return value.toLocaleLowerCase("en").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function containsTerm(value, term) {
  const haystack = " " + normalizedWords(value) + " ";
  const needle = " " + normalizedWords(term) + " ";
  return needle.length > 2 && haystack.includes(needle);
}
function canonicalCitation(value) {
  let target;
  try { target = validateTargetUrl(text(value, "citationUrl", 2048)); }
  catch { throw new TypeError("citationUrl must be a public HTTP or HTTPS URL without credentials"); }
  const url = new URL(target.href);
  if (url.protocol !== "https:") throw new TypeError("citationUrl must use HTTPS");
  url.search = "";
  url.hash = "";
  return url.href;
}
function normalizeCompetitorDomains(values) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100) throw new RangeError("competitorDomains must contain at most 100 domains");
  return [...new Set(values.map(value => {
    const domain = text(value, "competitorDomain", 253).toLowerCase();
    let target;
    try { target = validateTargetUrl("https://" + domain); }
    catch { throw new TypeError("competitorDomains must contain public DNS hostnames"); }
    if (target.hostname !== domain) throw new TypeError("competitorDomains must contain hostnames only");
    return domain;
  }))].sort();
}
function factFreshness(fact, observedAt, maxAgeDays) {
  const referenceAt = fact.reviewedAt ?? fact.assertedAt;
  const ageMs = Date.parse(observedAt) - Date.parse(referenceAt);
  if (ageMs < 0) return { freshness: "future_dated", ageDays: null };
  const ageDays = Math.floor(ageMs / 86_400_000);
  return { freshness: ageDays > maxAgeDays ? "stale" : "fresh", ageDays };
}
function resolveBrandTerm(claim, registry) {
  const terms = [registry.brand.name, ...registry.brand.aliases];
  const supplied = claim.matchedBrandTerm ?? claim.entity;
  if (supplied) {
    const match = terms.find(term => normalizedWords(term) === normalizedWords(text(supplied, "claim entity", 128)));
    if (claim.matchedBrandTerm && !match) throw new TypeError("matchedBrandTerm must match the Brand Truth Registry name or an approved alias");
    return match ?? null;
  }
  return terms.sort((a, b) => b.length - a.length || a.localeCompare(b, "en")).find(term => containsTerm(claim.text, term)) ?? null;
}
function matchFact(claim, facts) {
  if (claim.attribute) return facts.find(fact => fact.attribute === claim.attribute) ?? null;
  const claimText = normalizedWords(claim.text);
  return facts.find(fact =>
    containsTerm(claim.text, fact.value) ||
    normalizedWords(fact.statement) === claimText
  ) ?? null;
}
function citationAssessment(claim, fact, competitorDomains) {
  const raw = claim.citationUrls ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_CITATIONS_PER_CLAIM) throw new RangeError("citationUrls must contain at most " + MAX_CITATIONS_PER_CLAIM + " URLs");
  const citations = [...new Set(raw.map(canonicalCitation))].sort();
  if (citations.length === 0) return { assessment: "missing_citation", citations };
  const factSources = new Set(fact?.sourceUrls ?? []);
  if (citations.some(url => factSources.has(url))) return { assessment: "matched_registry_source", citations };
  if (citations.some(url => competitorDomains.some(domain => new URL(url).hostname === domain || new URL(url).hostname.endsWith("." + domain)))) return { assessment: "attribution_swap", citations };
  return { assessment: "citation_unverified", citations };
}
function confidenceFor(fact) {
  if (!fact) return "none";
  if (fact.status === "corroborated" && fact.sourceUrls.length >= 2) return "high";
  if (fact.status === "corroborated" || fact.sourceUrls.length > 0) return "medium";
  return "low";
}

export function extractBrandClaims(answerText, registry) {
  verifyBrandTruthRegistry(registry);
  if (typeof answerText !== "string" || !answerText.trim() || [...answerText].length > MAX_ANSWER_CHARS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(answerText)) throw new TypeError("answerText must be non-empty text of at most " + MAX_ANSWER_CHARS + " characters");
  const answer = answerText.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  const terms = [registry.brand.name, ...registry.brand.aliases]
    .sort((a, b) => b.length - a.length || a.localeCompare(b, "en"));
  const sentences = answer.split(/(?<=[.!?])\s+|\n+/u).map(value => value.trim()).filter(Boolean);
  const claims = [];
  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex++) {
    const sentence = sentences[sentenceIndex];
    const matchedBrandTerm = terms.find(term => containsTerm(sentence, term));
    if (!matchedBrandTerm) continue;
    const normalized = normalizedWords(sentence);
    claims.push(Object.freeze({
      claimId: id("claim_", JSON.stringify([registry.registryId, sentenceIndex, normalized])),
      sentenceIndex,
      text: sentence,
      matchedBrandTerm
    }));
    if (claims.length > MAX_CLAIMS) throw new RangeError("answerText produced more than " + MAX_CLAIMS + " brand claims");
  }
  return Object.freeze(claims);
}

export function evaluateBrandClaims(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Claim defense input is required");
  const registry = input.registry;
  verifyBrandTruthRegistry(registry);
  const observedAt = timestamp(input.observedAt, "observedAt");
  const maxAgeDays = input.maxAgeDays ?? 365;
  if (!Number.isSafeInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650) throw new RangeError("maxAgeDays must be an integer from 1 to 3650");
  const competitorDomains = normalizeCompetitorDomains(input.competitorDomains);
  const claims = input.claims ?? (input.answerText ? extractBrandClaims(input.answerText, registry) : null);
  if (!Array.isArray(claims) || claims.length > MAX_CLAIMS) {
    throw new RangeError("claims must contain between 0 and " + MAX_CLAIMS + " items");
  }
  const results = claims.map((claim, index) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) throw new TypeError("claims[" + index + "] must be an object");
    const claimText = text(claim.text, "claim.text", 5000);
    const attribute = claim.attribute ? text(claim.attribute, "claim.attribute", 96).toLowerCase() : null;
    const claimedValue = claim.value ? text(claim.value, "claim.value", 512) : null;
    const matchedBrandTerm = resolveBrandTerm({ ...claim, text: claimText }, registry);
    const fact = matchedBrandTerm ? matchFact({ ...claim, text: claimText, attribute }, registry.facts) : null;
    const riskFlags = [];
    let assessment;
    let freshness = "unknown";
    let ageDays = null;
    if (!matchedBrandTerm) {
      assessment = "entity_unresolved";
      riskFlags.push("entity_unresolved");
    } else if (!fact) {
      assessment = "unverified";
      riskFlags.push("unverified_claim");
    } else {
      const fresh = factFreshness(fact, observedAt, maxAgeDays);
      freshness = fresh.freshness;
      ageDays = fresh.ageDays;
      if (fact.status === "disputed") {
        assessment = "disputed";
        riskFlags.push("disputed_registry_fact");
      } else if (fact.status === "retired" || freshness === "stale" || freshness === "future_dated") {
        assessment = "stale";
        riskFlags.push(fact.status === "retired" ? "retired_registry_fact" : freshness === "future_dated" ? "future_dated_registry_fact" : "stale_registry_fact");
      } else {
        const normalizedClaimedValue = claimedValue ? normalizedWords(claimedValue) : null;
        const normalizedFactValue = normalizedWords(fact.value);
        const matches = normalizedClaimedValue
          ? normalizedClaimedValue === normalizedFactValue
          : containsTerm(claimText, fact.value) || normalizedWords(fact.statement) === normalizedWords(claimText);
        if (matches) assessment = "registry_consistent";
        else {
          assessment = "potential_contradiction";
          riskFlags.push("potential_contradiction");
        }
      }
    }
    const citation = citationAssessment(claim, fact, competitorDomains);
    if (citation.assessment === "attribution_swap") riskFlags.push("attribution_swap");
    if (citation.assessment === "citation_unverified") riskFlags.push("citation_unverified");
    if (citation.assessment === "missing_citation") riskFlags.push("missing_citation");
    const claimId = claim.claimId
      ? text(claim.claimId, "claim.claimId", 64)
      : id("claim_", JSON.stringify([registry.registryId, index, normalizedWords(claimText)]));
    return Object.freeze({
      claimId,
      text: claimText,
      matchedBrandTerm,
      attribute,
      claimedValue,
      factId: fact?.factId ?? null,
      factStatus: fact?.status ?? null,
      registryValue: fact?.value ?? null,
      registryStatement: fact?.statement ?? null,
      assessment,
      freshness,
      ageDays,
      confidence: confidenceFor(fact),
      citationAssessment: citation.assessment,
      citations: Object.freeze(citation.citations),
      sourceUrls: Object.freeze(fact?.sourceUrls ?? []),
      riskFlags: Object.freeze([...new Set(riskFlags)].sort())
    });
  });
  const correctionItems = results.filter(result =>
    result.assessment !== "registry_consistent" ||
    ["citation_unverified", "attribution_swap", "missing_citation"].includes(result.citationAssessment)
  ).map(result => {
    const fact = registry.facts.find(item => item.factId === result.factId);
    const safeFact = fact && ["owner_asserted", "corroborated"].includes(fact.status) && result.freshness === "fresh";
    return Object.freeze({
      claimId: result.claimId,
      issueTypes: Object.freeze([...result.riskFlags]),
      proposedCorrection: safeFact ? fact.statement : null,
      sourceUrls: Object.freeze(safeFact ? fact.sourceUrls : []),
      approvalRequired: true
    });
  });
  const summary = Object.freeze({
    totalClaims: results.length,
    registryConsistent: results.filter(result => result.assessment === "registry_consistent").length,
    potentialContradictions: results.filter(result => result.assessment === "potential_contradiction").length,
    unverified: results.filter(result => result.assessment === "unverified").length,
    entityUnresolved: results.filter(result => result.assessment === "entity_unresolved").length,
    disputed: results.filter(result => result.assessment === "disputed").length,
    stale: results.filter(result => result.assessment === "stale").length,
    citationIssues: results.filter(result => ["citation_unverified", "attribution_swap", "missing_citation"].includes(result.citationAssessment)).length
  });
  const correctionCore = {
    schemaVersion: "1.0.0",
    type: "correction_manifest",
    status: correctionItems.length ? "requires_review" : "clear",
    approvalRequired: correctionItems.length > 0,
    autoPublish: false,
    items: Object.freeze(correctionItems)
  };
  const correctionManifest = Object.freeze({
    ...correctionCore,
    manifestId: id("correction_", JSON.stringify([registry.contentDigest, observedAt, correctionItems]))
  });
  const reportCore = {
    schemaVersion: "1.0.0",
    type: "claim_defense_report",
    registryId: registry.registryId,
    registryContentDigest: registry.contentDigest,
    observedAt,
    maxAgeDays,
    summary,
    results: Object.freeze(results),
    correctionManifest
  };
  return Object.freeze({
    ...reportCore,
    reportId: id("claim_report_", JSON.stringify([registry.contentDigest, observedAt, results.map(result => [result.claimId, result.assessment, result.citationAssessment])]))
  });
}
