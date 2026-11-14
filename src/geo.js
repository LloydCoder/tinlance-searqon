import { createEvidenceRecord } from "./evidence.js";

const GEO_METHOD_VERSION = "geo-2026-11-14.1";
const OBSERVATION_CLASSES = new Set(["consumer_observation","model_api"]);
const MAX_PROMPT_CHARS = 32_000;
const MAX_ANSWER_CHARS = 1_000_000;
const MAX_CITATIONS = 100;

function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TypeError(name + " must be a non-empty string of at most " + maxLength + " characters");
  }
  return value.trim();
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError("sampledAt must be a canonical ISO 8601 UTC timestamp");
  }
  return value;
}

function normalizeCitation(value) {
  if (typeof value !== "string" || value.length > 2048) throw new TypeError("Citation URL must be a string of at most 2048 characters");
  let url;
  try { url = new URL(value); }
  catch { throw new TypeError("Citation URL must be an absolute HTTP or HTTPS URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("Citation URLs must use HTTP or HTTPS");
  if (url.username || url.password) throw new TypeError("Citation URLs must not contain credentials");
  url.hash = "";
  return Object.freeze({url:url.toString(),domain:url.hostname.toLowerCase()});
}

function normalizeTargetDomain(value) {
  if (value === undefined || value === null || value === "") return null;
  const domain = requiredText(value,"targetDomain",253).toLowerCase();
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes("..")) {
    throw new TypeError("targetDomain must be a hostname without scheme, path, or credentials");
  }
  return domain;
}

function countBrandMentions(text, brand) {
  const metacharacters = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
  const escaped = [...brand].map(character => metacharacters.has(character) ? "\\" + character : character).join("");
  const pattern = new RegExp("(^|[^\\p{L}\\p{N}])" + escaped + "(?=$|[^\\p{L}\\p{N}])","giu");
  return [...text.matchAll(pattern)].length;
}

/**
 * Normalize a supplied GEO answer sample. This function does not query providers,
 * scrape consumer interfaces, or fetch cited URLs.
 */
export function analyzeGeoObservation(input) {
  if (!input || typeof input !== "object") throw new TypeError("GEO observation input is required");
  const prompt = requiredText(input.prompt,"prompt",MAX_PROMPT_CHARS);
  const answer = requiredText(input.answer,"answer",MAX_ANSWER_CHARS);
  const brand = requiredText(input.brand,"brand",128);
  const targetDomain = normalizeTargetDomain(input.targetDomain);
  const provider = input.provider;
  if (!provider || typeof provider !== "object") throw new TypeError("provider metadata is required");
  const providerName = requiredText(provider.name,"provider.name",128);
  if (!OBSERVATION_CLASSES.has(provider.observationClass)) throw new TypeError("provider.observationClass must be consumer_observation or model_api");
  const sampledAt = canonicalTimestamp(input.sampledAt ?? new Date().toISOString());
  if (!Array.isArray(input.citations ?? [])) throw new TypeError("citations must be an array");
  const rawCitations = input.citations ?? [];
  if (rawCitations.length > MAX_CITATIONS) throw new RangeError("A GEO observation may contain at most " + MAX_CITATIONS + " citations");
  const citationMap = new Map();
  for (const citation of rawCitations) {
    const normalized = normalizeCitation(citation);
    citationMap.set(normalized.url,normalized);
  }
  const citations = [...citationMap.values()];
  const mentionCount = countBrandMentions(answer,brand);
  const brandCited = targetDomain ? citations.some(item => item.domain === targetDomain || item.domain.endsWith("." + targetDomain)) : false;
  const providerMetadata = Object.freeze({
    name:providerName,
    model:provider.model ? requiredText(provider.model,"provider.model",128) : null,
    region:provider.region ? requiredText(provider.region,"provider.region",64) : null,
    locale:provider.locale ? requiredText(provider.locale,"provider.locale",32) : null
  });
  const evidencePayload = JSON.stringify({prompt,answer,brand,targetDomain,citations,provider:providerMetadata,sampledAt});
  const evidence = createEvidenceRecord({
    source:providerName,
    acquisitionMethod:"provider_observation",
    observationClass:provider.observationClass,
    collectedAt:sampledAt,
    contentType:"application/json",
    content:evidencePayload,
    methodologyVersion:GEO_METHOD_VERSION
  });
  return Object.freeze({
    schemaVersion:"1.0.0",
    type:"geo_observation",
    observationClass:provider.observationClass,
    provider:providerMetadata,
    sampledAt,
    brand,
    targetDomain,
    mentioned:mentionCount > 0,
    mentionCount,
    citationCount:citations.length,
    brandCited,
    citations:Object.freeze(citations),
    evidence
  });
}

function wilsonInterval(successes, total) {
  if (total === 0) return null;
  const z = 1.96;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) / total) + (z2 / (4 * total * total))) / denominator;
  return Object.freeze({
    lower:Number(Math.max(0,center - margin).toFixed(4)),
    upper:Number(Math.min(1,center + margin).toFixed(4))
  });
}

/**
 * Aggregate by both observation class and provider. Consumer-facing observations
 * and direct model API observations are never pooled into one rate.
 */
export function aggregateGeoObservations(observations) {
  if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
  const groups = new Map();
  for (const observation of observations) {
    if (!observation || observation.type!=="geo_observation" || observation.schemaVersion!=="1.0.0" || !OBSERVATION_CLASSES.has(observation.observationClass)) {
      throw new TypeError("Every item must be a valid GEO observation");
    }
    const provider=observation.provider;
    if (!provider || typeof provider.name!=="string" || !provider.name.trim() ||
        ![provider.model,provider.region,provider.locale].every(value=>value===null || typeof value==="string")) {
      throw new TypeError("GEO observation provider metadata is invalid");
    }
    if (typeof observation.brand!=="string" || !observation.brand.trim() ||
        !(observation.targetDomain===null || typeof observation.targetDomain==="string")) {
      throw new TypeError("GEO observation brand cohort is invalid");
    }
    if (typeof observation.sampledAt!=="string" || Number.isNaN(Date.parse(observation.sampledAt)) ||
        new Date(observation.sampledAt).toISOString()!==observation.sampledAt) {
      throw new TypeError("GEO observation sample timestamp is invalid");
    }
    if (!Number.isSafeInteger(observation.mentionCount) || observation.mentionCount<0 ||
        typeof observation.mentioned!=="boolean" || observation.mentioned!==(observation.mentionCount>0)) {
      throw new TypeError("GEO observation mention count is inconsistent");
    }
    if (!Array.isArray(observation.citations) || !Number.isSafeInteger(observation.citationCount) ||
        observation.citationCount!==observation.citations.length || observation.citations.some(item=>!item || typeof item.url!=="string" || typeof item.domain!=="string")) {
      throw new TypeError("GEO observation citation count is inconsistent");
    }
    if (typeof observation.brandCited!=="boolean" || (observation.targetDomain===null && observation.brandCited)) {
      throw new TypeError("GEO observation brand citation state is inconsistent");
    }
    const evidence=observation.evidence;
    if (!evidence || !/^evidence_[a-f0-9]{20}$/.test(evidence.id ?? "") ||
        evidence.observationClass!==observation.observationClass ||
        evidence.acquisitionMethod!=="provider_observation" ||
        evidence.source!==provider.name ||
        evidence.collectedAt!==observation.sampledAt ||
        evidence.contentType!=="application/json" ||
        !/^[a-f0-9]{64}$/.test(evidence.sha256 ?? "") ||
        !Number.isSafeInteger(evidence.byteLength) || evidence.byteLength<0) {
      throw new TypeError("GEO observation evidence provenance is invalid");
    }

    const providerKey=[provider.name,provider.model,provider.region,provider.locale];
    const key=JSON.stringify([observation.observationClass,providerKey,observation.brand,observation.targetDomain]);
    let group=groups.get(key);
    if (!group) {
      group={
        observationClass:observation.observationClass,
        provider:Object.freeze({...provider}),
        brand:observation.brand,
        targetDomain:observation.targetDomain,
        sampleSize:0,
        mentionCount:0,
        brandCitationCount:0,
        citationCount:0
      };
      groups.set(key,group);
    }
    group.sampleSize+=1;
    group.mentionCount+=observation.mentionCount;
    group.brandCitationCount+=observation.brandCited ? 1 : 0;
    group.citationCount+=observation.citationCount;
  }
  return [...groups.values()].map(group=>Object.freeze({
    ...group,
    mentionRate:Number((group.mentionCount/group.sampleSize).toFixed(4)),
    mentionRate95:wilsonInterval(group.mentionCount>0 ? Math.min(group.mentionCount,group.sampleSize) : 0,group.sampleSize),
    brandCitationRate:Number((group.brandCitationCount/group.sampleSize).toFixed(4)),
    brandCitationRate95:wilsonInterval(group.brandCitationCount,group.sampleSize)
  })).sort((a,b)=>
    a.observationClass.localeCompare(b.observationClass) ||
    a.provider.name.localeCompare(b.provider.name) ||
    a.brand.localeCompare(b.brand) ||
    String(a.targetDomain ?? "").localeCompare(String(b.targetDomain ?? ""))
  );
}
