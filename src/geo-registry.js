import { createHash } from "node:crypto";

const MAX_FACTS = 500;
const MAX_PROMPTS = 500;
const MAX_PROVIDERS = 20;
const MAX_SAMPLE_COUNT = 20;
const MAX_PLAN_TASKS = 10_000;
const OBSERVATION_CLASSES = new Set(["consumer_observation", "model_api"]);
const FACT_STATUSES = new Set(["owner_asserted", "corroborated", "disputed", "retired"]);
const JOURNEY_STAGES = new Set(["awareness", "consideration", "decision", "retention", "other"]);

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function identifier(prefix, value) {
  return prefix + digest(value).slice(0, 20);
}
function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(name + " must be a non-empty string of at most " + maxLength + " characters");
  }
  return value.trim().normalize("NFKC");
}
function canonicalTimestamp(value, name) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(name + " must be a canonical ISO 8601 UTC timestamp");
  }
  return value;
}
function normalizeDomain(value) {
  const domain = requiredText(value, "primaryDomain", 253).toLowerCase().replace(/\.$/, "");
  let parsed;
  try { parsed = new URL("https://" + domain); } catch { throw new TypeError("primaryDomain must be a DNS hostname"); }
  if (parsed.hostname !== domain || parsed.pathname !== "/" || parsed.port || parsed.username || parsed.password || domain.split(".").length < 2) {
    throw new TypeError("primaryDomain must be a hostname without scheme, path, port or credentials");
  }
  if (domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".local") || domain.endsWith(".test") || domain.endsWith(".example")) {
    throw new TypeError("primaryDomain must be a public DNS domain");
  }
  return domain;
}
function normalizeSourceUrl(value) {
  let url;
  try { url = new URL(requiredText(value, "sourceUrl", 2048)); }
  catch { throw new TypeError("sourceUrl must be an absolute HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new TypeError("sourceUrl must use HTTPS without credentials");
  url.search = "";
  url.hash = "";
  return url.href;
}
function normalizeLocale(value) {
  const locale = requiredText(value, "locale", 35);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) throw new TypeError("locale must be a BCP 47 language tag");
  return locale.split("-").map((part, index) => index === 0 ? part.toLowerCase() : part.length === 2 ? part.toUpperCase() : part).join("-");
}
function normalizeAliases(value, brandName) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new TypeError("aliases must be an array of at most 50 strings");
  const brandKey = brandName.toLocaleLowerCase("en");
  const seen = new Set([brandKey]);
  const aliases = [];
  for (const item of value) {
    const alias = requiredText(item, "alias", 128);
    const key = alias.toLocaleLowerCase("en");
    if (!seen.has(key)) { seen.add(key); aliases.push(alias); }
  }
  return aliases.sort((a, b) => a.localeCompare(b));
}

export function createBrandTruthRegistry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Brand truth registry input is required");
  const brandName = requiredText(input.brandName, "brandName", 128);
  const primaryDomain = normalizeDomain(input.primaryDomain);
  const assertedBy = requiredText(input.assertedBy, "assertedBy", 128);
  const createdAt = canonicalTimestamp(input.createdAt, "createdAt");
  const updatedAt = canonicalTimestamp(input.updatedAt ?? createdAt, "updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new TypeError("updatedAt cannot be earlier than createdAt");
  const aliases = normalizeAliases(input.aliases, brandName);
  const rawFacts = input.facts ?? [];
  if (!Array.isArray(rawFacts) || rawFacts.length > MAX_FACTS) throw new RangeError("facts must be an array of at most " + MAX_FACTS + " items");
  const seenAttributes = new Set();
  const facts = rawFacts.map((fact, index) => {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) throw new TypeError("facts[" + index + "] must be an object");
    const attribute = requiredText(fact.attribute, "fact.attribute", 96).toLowerCase();
    if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(attribute)) throw new TypeError("fact.attribute must be a stable dotted identifier");
    if (seenAttributes.has(attribute)) throw new TypeError("duplicate fact attribute: " + attribute);
    seenAttributes.add(attribute);
    const value = requiredText(fact.value, "fact.value", 512);
    const statement = requiredText(fact.statement, "fact.statement", 2048);
    const status = fact.status ?? "owner_asserted";
    if (!FACT_STATUSES.has(status)) throw new TypeError("fact.status is unsupported");
    const sourceUrls = [...new Set((fact.sourceUrls ?? []).map(normalizeSourceUrl))].sort();
    if (sourceUrls.length > 20) throw new RangeError("A fact may have at most 20 source URLs");
    const assertedByForFact = requiredText(fact.assertedBy ?? assertedBy, "fact.assertedBy", 128);
    const assertedAt = canonicalTimestamp(fact.assertedAt ?? createdAt, "fact.assertedAt");
    if (Date.parse(assertedAt) > Date.parse(updatedAt)) throw new TypeError("fact.assertedAt cannot be later than registry updatedAt");
    const reviewedBy = fact.reviewedBy ? requiredText(fact.reviewedBy, "fact.reviewedBy", 128) : null;
    const reviewedAt = fact.reviewedAt ? canonicalTimestamp(fact.reviewedAt, "fact.reviewedAt") : null;
    if (Boolean(reviewedBy) !== Boolean(reviewedAt)) throw new TypeError("fact reviewedBy and reviewedAt must be provided together");
    if (reviewedAt && Date.parse(reviewedAt) < Date.parse(assertedAt)) throw new TypeError("fact.reviewedAt cannot be earlier than assertedAt");
    if (["corroborated", "disputed"].includes(status) && (!reviewedBy || !reviewedAt || sourceUrls.length === 0)) {
      throw new TypeError("corroborated or disputed facts require reviewedBy, reviewedAt and at least one source URL");
    }
    return Object.freeze({
      factId: identifier("fact_", JSON.stringify([attribute, value, statement])),
      attribute,
      value,
      statement,
      status,
      sourceUrls: Object.freeze(sourceUrls),
      assertedBy: assertedByForFact,
      assertedAt,
      reviewedBy,
      reviewedAt
    });
  }).sort((a, b) => a.attribute.localeCompare(b.attribute));
  const registryId = identifier("btr_", JSON.stringify([brandName.toLocaleLowerCase("en"), primaryDomain]));
  const body = {
    schemaVersion: "1.0.0",
    type: "brand_truth_registry",
    registryId,
    brand: Object.freeze({ name: brandName, primaryDomain, aliases: Object.freeze(aliases) }),
    assertedBy,
    createdAt,
    updatedAt,
    facts: Object.freeze(facts)
  };
  return Object.freeze({ ...body, contentDigest: digest(stableStringify(body)) });
}

function assertRegistry(registry) {
  if (!registry || registry.type !== "brand_truth_registry" || registry.schemaVersion !== "1.0.0" || !/^btr_[a-f0-9]{20}$/.test(registry.registryId ?? "")) {
    throw new TypeError("A normalized version 1.0.0 brand truth registry is required");
  }
  const { contentDigest, ...body } = registry;
  if (typeof contentDigest !== "string" || digest(stableStringify(body)) !== contentDigest) {
    throw new TypeError("Brand Truth Registry content digest failed integrity verification");
  }
  const expectedId = identifier("btr_", JSON.stringify([registry.brand?.name?.toLocaleLowerCase("en"), registry.brand?.primaryDomain]));
  if (expectedId !== registry.registryId) throw new TypeError("Brand Truth Registry identity does not match its brand and domain");
}

export function createPromptCohort(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Prompt cohort input is required");
  assertRegistry(input.registry);
  const locale = normalizeLocale(input.locale);
  const market = input.market ? requiredText(input.market, "market", 3).toUpperCase() : null;
  if (market && !/^[A-Z]{2,3}$/.test(market)) throw new TypeError("market must be an ISO country or market code");
  const createdAt = canonicalTimestamp(input.createdAt, "createdAt");
  if (!Array.isArray(input.prompts) || input.prompts.length < 1 || input.prompts.length > MAX_PROMPTS) {
    throw new RangeError("prompts must contain between 1 and " + MAX_PROMPTS + " items");
  }
  const promptMap = new Map();
  for (const raw of input.prompts) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Each prompt must be an object");
    const prompt = requiredText(raw.prompt, "prompt", 4000).replace(/\s+/g, " ");
    const normalizedPrompt = prompt.toLocaleLowerCase(locale);
    const intent = raw.intent ? requiredText(raw.intent, "intent", 64).toLowerCase() : "unspecified";
    const journeyStage = raw.journeyStage ?? "other";
    if (!JOURNEY_STAGES.has(journeyStage)) throw new TypeError("journeyStage is unsupported");
    const key = JSON.stringify([normalizedPrompt, intent, journeyStage, locale]);
    const candidate = Object.freeze({
      promptId: identifier("prompt_", key),
      prompt,
      intent,
      journeyStage,
      locale
    });
    const existing = promptMap.get(key);
    if (!existing || candidate.prompt.localeCompare(existing.prompt, "en") < 0) promptMap.set(key, candidate);
  }
  const prompts = [...promptMap.values()].sort((a, b) => a.promptId.localeCompare(b.promptId));
  const brand = Object.freeze({ name: input.registry.brand.name, primaryDomain: input.registry.brand.primaryDomain });
  const registryContentDigest = input.registry.contentDigest;
  const cohortId = identifier("cohort_", JSON.stringify([input.registry.registryId, registryContentDigest, brand.name, brand.primaryDomain, locale, market, prompts.map(item => item.promptId)]));
  return Object.freeze({
    schemaVersion: "1.0.0",
    type: "geo_prompt_cohort",
    cohortId,
    registryId: input.registry.registryId,
    registryContentDigest,
    brand,
    locale,
    market,
    createdAt,
    prompts: Object.freeze(prompts)
  });
}

function validateProvider(provider, planCreatedAt) {
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) throw new TypeError("provider must be an object");
  if (Object.keys(provider).some(key => /(?:api.?key|secret|token|credential|authorization)/i.test(key))) throw new TypeError("provider credentials and secrets must never be embedded in a sampling plan");
  const name = requiredText(provider.name, "provider.name", 128);
  if (!OBSERVATION_CLASSES.has(provider.observationClass)) throw new TypeError("provider.observationClass is unsupported");
  const expectedMode = provider.observationClass === "consumer_observation" ? "manual_capture" : "official_api";
  if (provider.collectionMode !== expectedMode) {
    throw new TypeError(provider.observationClass === "consumer_observation"
      ? "consumer_observation collectionMode must be manual_capture; automated consumer UI scraping is not permitted"
      : "model_api collectionMode must be official_api");
  }
  const policy = provider.policyReview;
  if (!policy || policy.status !== "approved") throw new TypeError("provider requires an approved policyReview");
  const reviewedAt = canonicalTimestamp(policy.reviewedAt, "policyReview.reviewedAt");
  if (Date.parse(reviewedAt) > Date.parse(planCreatedAt)) throw new TypeError("policyReview must be approved before the sampling plan is created");
  const policyReview = Object.freeze({
    status: "approved",
    reviewedAt,
    reviewerId: requiredText(policy.reviewerId, "policyReview.reviewerId", 128),
    sourceUrl: normalizeSourceUrl(policy.sourceUrl)
  });
  const estimatedCostPerSampleUsd = provider.estimatedCostPerSampleUsd;
  if (typeof estimatedCostPerSampleUsd !== "number" || !Number.isFinite(estimatedCostPerSampleUsd) || estimatedCostPerSampleUsd < 0 || estimatedCostPerSampleUsd > 1000) {
    throw new TypeError("estimatedCostPerSampleUsd must be between 0 and 1000");
  }
  if (!Number.isSafeInteger(provider.maxSamples) || provider.maxSamples < 1 || provider.maxSamples > MAX_PLAN_TASKS) {
    throw new TypeError("provider.maxSamples must be an integer between 1 and " + MAX_PLAN_TASKS);
  }
  const adapterId = provider.observationClass === "model_api"
    ? requiredText(provider.adapterId, "provider.adapterId", 128)
    : null;
  if (provider.observationClass === "consumer_observation" && provider.adapterId !== undefined && provider.adapterId !== null) throw new TypeError("consumer_observation must use manual capture and cannot declare an automated adapter");
  return Object.freeze({ name, observationClass: provider.observationClass, collectionMode: expectedMode, adapterId, policyReview, estimatedCostPerSampleUsd, maxSamples: provider.maxSamples });
}

function assertCohort(cohort) {
  if (!cohort || cohort.type !== "geo_prompt_cohort" || cohort.schemaVersion !== "1.0.0" ||
      !/^cohort_[a-f0-9]{20}$/.test(cohort.cohortId ?? "") ||
      !/^btr_[a-f0-9]{20}$/.test(cohort.registryId ?? "") ||
      !Array.isArray(cohort.prompts) || cohort.prompts.length < 1 || cohort.prompts.length > MAX_PROMPTS) {
    throw new TypeError("A normalized version 1.0.0 GEO prompt cohort is required");
  }
  const locale = normalizeLocale(cohort.locale);
  canonicalTimestamp(cohort.createdAt, "cohort.createdAt");
  const brandName = requiredText(cohort.brand?.name, "cohort.brand.name", 128);
  const primaryDomain = normalizeDomain(cohort.brand?.primaryDomain);
  const expectedRegistryId = identifier("btr_", JSON.stringify([brandName.toLocaleLowerCase("en"), primaryDomain]));
  if (expectedRegistryId !== cohort.registryId) throw new TypeError("GEO prompt cohort brand and domain do not match registry identity");
  if (typeof cohort.registryContentDigest !== "string" || !/^[a-f0-9]{64}$/.test(cohort.registryContentDigest)) throw new TypeError("GEO prompt cohort must pin a valid registry content digest");
  const market = cohort.market === null ? null : requiredText(cohort.market, "cohort.market", 3).toUpperCase();
  if (market && !/^[A-Z]{2,3}$/.test(market)) throw new TypeError("GEO prompt cohort market is invalid");
  const promptIds = [];
  for (const prompt of cohort.prompts) {
    if (!prompt || typeof prompt !== "object" || prompt.locale !== locale ||
        !/^prompt_[a-f0-9]{20}$/.test(prompt.promptId ?? "") ||
        !JOURNEY_STAGES.has(prompt.journeyStage)) {
      throw new TypeError("GEO prompt cohort contains an invalid prompt");
    }
    const normalizedPrompt = requiredText(prompt.prompt, "prompt", 4000).toLocaleLowerCase(locale).replace(/\\s+/g, " ");
    const expectedPromptId = identifier("prompt_", JSON.stringify([normalizedPrompt, prompt.intent, prompt.journeyStage, locale]));
    if (expectedPromptId !== prompt.promptId) throw new TypeError("GEO prompt cohort prompt identity failed integrity verification");
    promptIds.push(prompt.promptId);
  }
  if (new Set(promptIds).size !== promptIds.length) throw new TypeError("GEO prompt cohort contains duplicate prompt identifiers");
  const expectedCohortId = identifier("cohort_", JSON.stringify([cohort.registryId, cohort.registryContentDigest, brandName, primaryDomain, locale, market, promptIds]));
  if (expectedCohortId !== cohort.cohortId) throw new TypeError("GEO prompt cohort identity failed integrity verification");
}
 
export function buildGeoSamplingPlan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Sampling plan input is required");
  const cohort = input.cohort;
  assertCohort(cohort);
  const sampleCount = input.sampleCount;
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > MAX_SAMPLE_COUNT) {
    throw new RangeError("sampleCount must be an integer between 1 and " + MAX_SAMPLE_COUNT);
  }
  const costCapUsd = input.costCapUsd;
  if (!Number.isFinite(costCapUsd) || costCapUsd <= 0 || costCapUsd > 100_000) throw new RangeError("costCapUsd must be greater than 0 and at most 100000");
  if (!Array.isArray(input.providers) || input.providers.length < 1 || input.providers.length > MAX_PROVIDERS) {
    throw new RangeError("providers must contain between 1 and " + MAX_PROVIDERS + " items");
  }
  const createdAt = canonicalTimestamp(input.createdAt, "createdAt");
  const providers = input.providers.map(provider => validateProvider(provider, createdAt)).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(providers.map(item => item.name.toLocaleLowerCase("en"))).size !== providers.length) throw new TypeError("provider names must be unique");
  const samplesPerProvider = cohort.prompts.length * sampleCount;
  for (const provider of providers) {
    if (provider.maxSamples < samplesPerProvider) throw new RangeError("provider.maxSamples is below the requested sample count for " + provider.name);
  }
  const totalTasks = samplesPerProvider * providers.length;
  if (totalTasks > MAX_PLAN_TASKS) throw new RangeError("sampling plan exceeds the maximum task count of " + MAX_PLAN_TASKS);
  const estimatedCostUsd = Number((providers.reduce((sum, provider) => sum + samplesPerProvider * provider.estimatedCostPerSampleUsd, 0)).toFixed(6));
  if (estimatedCostUsd > costCapUsd) throw new RangeError("sampling plan estimated cost exceeds costCapUsd");
  const tasks = [];
  for (const provider of providers) {
    for (const prompt of cohort.prompts) {
      for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex++) {
        const taskKey = JSON.stringify([cohort.cohortId, provider.name, provider.observationClass, prompt.promptId, sampleIndex]);
        tasks.push(Object.freeze({
          taskId: identifier("sample_", taskKey),
          providerName: provider.name,
          observationClass: provider.observationClass,
          collectionMode: provider.collectionMode,
          promptId: prompt.promptId,
          sampleIndex,
          estimatedCostUsd: provider.estimatedCostPerSampleUsd,
          status: "planned"
        }));
      }
    }
  }
  const planCore = {
    schemaVersion: "1.0.0",
    type: "geo_sampling_plan",
    cohortId: cohort.cohortId,
    registryId: cohort.registryId,
    registryContentDigest: cohort.registryContentDigest,
    createdAt,
    sampleCount,
    costCapUsd,
    estimatedCostUsd,
    providers: Object.freeze(providers),
    tasks: Object.freeze(tasks)
  };
  return Object.freeze({ ...planCore, planId: identifier("sampling_", JSON.stringify(planCore)) });
}
