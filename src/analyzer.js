import { createHash } from "node:crypto";

const MAX_BYTES = 2 * 1024 * 1024;
const RULES_VERSION = "2026-11-14.1";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function finding({ ruleId, dimension, severity, title, description, recommendation, evidenceId }) {
  return Object.freeze({
    id: `finding_${digest(ruleId + evidenceId).slice(0, 16)}`,
    ruleId,
    dimension,
    severity,
    title,
    description,
    recommendation,
    evidenceId
  });
}

function extractTag(html, tag) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "i"));
  return match?.[1]?.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim() ?? "";
}

function hasMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  return new RegExp(`<meta\\b(?=[^>]*\\bname=["']${escaped}["'])[^>]*>`, "i").test(html);
}

function analyzeHtml(input, evidenceId) {
  const html = input.content;
  const findings = [];
  const title = extractTag(html, "title");
  const description = /<meta\\b(?=[^>]*\\bname=["']description["'])[^>]*\\bcontent=["'][^"']+["'][^>]*>/i.test(html);
  const h1 = extractTag(html, "h1");
  const canonical = /<link\\b(?=[^>]*\\brel=["']canonical["'])[^>]*\\bhref=["'][^"']+["'][^>]*>/i.test(html);
  const jsonLd = /<script\\b(?=[^>]*\\btype=["']application\\/ld\\+json["'])/i.test(html);
  const robotsNoIndex = /<meta\\b(?=[^>]*\\bname=["']robots["'])[^>]*\\bcontent=["'][^"']*noindex/i.test(html);

  if (!title) findings.push(finding({ruleId:"html.title.missing",dimension:"SEO",severity:"high",title:"Document title is missing",description:"The document has no detectable title element.",recommendation:"Add a concise, page-specific title that describes the page's primary subject.",evidenceId}));
  if (!description) findings.push(finding({ruleId:"html.meta_description.missing",dimension:"SEO",severity:"medium",title:"Meta description is missing",description:"No non-empty meta description was detected.",recommendation:"Add a unique summary of the page's purpose and content.",evidenceId}));
  if (!h1) findings.push(finding({ruleId:"html.h1.missing",dimension:"AEO",severity:"medium",title:"Primary heading is missing",description:"No H1 heading was detected.",recommendation:"Provide a clear primary heading that states the page's subject.",evidenceId}));
  if (!canonical) findings.push(finding({ruleId:"html.canonical.missing",dimension:"SEO",severity:"low",title:"Canonical URL is not declared",description:"No canonical link element was detected.",recommendation:"Declare a canonical URL when duplicate or parameterized URLs are possible.",evidenceId}));
  if (!jsonLd) findings.push(finding({ruleId:"html.structured_data.absent",dimension:"AEO",severity:"low",title:"JSON-LD structured data not detected",description:"No JSON-LD script block was detected; structured data is optional and context-dependent.",recommendation:"Assess whether a supported schema.org type would clarify the page's entities; do not add irrelevant markup.",evidenceId}));
  if (robotsNoIndex) findings.push(finding({ruleId:"html.robots.noindex",dimension:"SEO",severity:"high",title:"Page declares noindex",description:"A robots meta directive appears to request that crawlers not index this page.",recommendation:"Confirm this is intentional for the page's publishing and discovery goals.",evidenceId}));

  return { findings, observations: { titlePresent:Boolean(title), descriptionPresent:description, h1Present:Boolean(h1), canonicalPresent:canonical, jsonLdPresent:jsonLd, noindex:robotsNoIndex } };
}

function analyzeOpenApi(input, evidenceId) {
  let document;
  try { document = JSON.parse(input.content); }
  catch { throw new TypeError("Invalid JSON document: expected a valid OpenAPI JSON document"); }
  if (!document || typeof document !== "object" || Array.isArray(document) || typeof document.openapi !== "string" || !document.info || typeof document.info !== "object") {
    throw new TypeError("Invalid OpenAPI document: openapi and info fields are required");
  }
  const findings = [];
  if (!Array.isArray(document.servers) || document.servers.length === 0) findings.push(finding({ruleId:"openapi.servers.missing",dimension:"AgEO",severity:"medium",title:"API server endpoints are not declared",description:"The OpenAPI document does not declare a non-empty servers array.",recommendation:"Document intended server URLs and environments without exposing private infrastructure.",evidenceId}));
  if (!document.security && !Object.values(document.paths ?? {}).some(path => Object.values(path ?? {}).some(operation => operation?.security))) findings.push(finding({ruleId:"openapi.security.missing",dimension:"AgEO",severity:"medium",title:"Authentication requirements are not explicit",description:"No root-level or operation-level security requirement was detected. This does not prove the API is unauthenticated.",recommendation:"Explicitly document whether operations are public or require a declared security scheme.",evidenceId}));
  if (!document.info.description) findings.push(finding({ruleId:"openapi.description.missing",dimension:"AEO",severity:"low",title:"API description is missing",description:"The API info object has no description.",recommendation:"Describe the API's purpose, intended users, and primary capabilities.",evidenceId}));
  if (!document.paths || Object.keys(document.paths).length === 0) findings.push(finding({ruleId:"openapi.paths.empty",dimension:"AgEO",severity:"high",title:"No API paths are described",description:"The document contains no declared API paths.",recommendation:"Publish the intended operations or verify that this is the correct OpenAPI document.",evidenceId}));
  return { findings, observations: { openapiVersion:document.openapi, apiTitle:document.info.title ?? null, apiVersion:document.info.version ?? null, pathCount:Object.keys(document.paths ?? {}).length, serverCount:document.servers?.length ?? 0 } };
}

/**
 * Analyze caller-supplied local content. This function never performs network I/O,
 * follows links, resolves hosts, or executes document content.
 */
export function analyzeDocument(input) {
  if (!input || typeof input !== "object" || typeof input.source !== "string" || !input.source.trim() || typeof input.content !== "string" || typeof input.contentType !== "string") {
    throw new TypeError("source, contentType, and string content are required");
  }
  const bytes = Buffer.byteLength(input.content, "utf8");
  if (bytes > MAX_BYTES) throw new RangeError(`Document exceeds the ${MAX_BYTES} byte analysis limit`);
  const type = input.contentType.split(";")[0].trim().toLowerCase();
  if (!["text/html", "application/json", "application/vnd.oai.openapi+json"].includes(type)) {
    throw new TypeError(`Unsupported content type: ${type}`);
  }
  const sha256 = digest(input.content);
  const evidenceId = `evidence_${digest(input.source + "\\0" + sha256).slice(0, 20)}`;
  const inputNormalized = { ...input, contentType:type };
  const analyzed = type === "text/html"
    ? analyzeHtml(inputNormalized, evidenceId)
    : analyzeOpenApi(inputNormalized, evidenceId);

  return Object.freeze({
    schemaVersion:"1.0.0",
    rulesVersion:RULES_VERSION,
    observationClass:"first_party",
    evidence:Object.freeze({ id:evidenceId, source:input.source, contentType:type, byteLength:bytes, sha256 }),
    summary:Object.freeze({ findingCount:analyzed.findings.length, bySeverity:Object.fromEntries(["critical","high","medium","low","info"].map(level => [level, analyzed.findings.filter(item => item.severity === level).length])) }),
    observations:Object.freeze(analyzed.observations),
    findings:Object.freeze(analyzed.findings)
  });
}
