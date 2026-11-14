import { createEvidenceRecord } from "./evidence.js";

const RULES_VERSION = "2026-11-14.2";

function finding(data) {
  return Object.freeze({
    id: "finding_" + data.ruleId + "_" + data.evidenceId.slice(-8),
    ...data
  });
}

function extractTag(html, tag) {
  const pattern = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + "\\s*>", "i");
  const match = html.match(pattern);
  return match?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

function analyzeHtml(html, evidenceId) {
  const findings = [];
  const title = extractTag(html, "title");
  const h1 = extractTag(html, "h1");
  const descriptionMatch = html.match(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/i);
  const descriptionText = descriptionMatch?.[1]?.trim() ?? "";
  const description = descriptionText.length > 0;
  const canonical = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["'][^"']+["'][^>]*>/i.test(html);
  const jsonLd = /<script\b(?=[^>]*\btype=["']application\/ld\+json["'])/i.test(html);
  const robotsNoIndex = /<meta\b(?=[^>]*\bname=["']robots["'])[^>]*\bcontent=["'][^"']*noindex/i.test(html);
  const languagePresent = /<html\b(?=[^>]*\blang=["'][^"']+["'])/i.test(html);
  const viewportPresent = /<meta\b(?=[^>]*\bname=["']viewport["'])[^>]*\bcontent=["'][^"']+["'][^>]*>/i.test(html);
  const titleLength = title ? [...title].length : null;
  const descriptionLength = description ? [...descriptionText].length : null;
  const h1Count = [...html.matchAll(/<h1\b[^>]*>/gi)].length;
  const imagesMissingAlt = [...html.matchAll(/<img\b[^>]*>/gi)].filter(match => !/\balt\s*=/i.test(match[0])).length;

  if (!title) findings.push(finding({ruleId:"html.title.missing",dimension:"SEO",severity:"high",title:"Document title is missing",description:"The document has no detectable title element.",recommendation:"Add a concise, page-specific title that describes the page's primary subject.",evidenceId}));
  else if (titleLength < 30 || titleLength > 60) findings.push(finding({ruleId:"html.title.length_out_of_range",dimension:"SEO",severity:"low",title:"Document title length is outside the suggested range",description:"The detected title contains " + titleLength + " characters; this heuristic flags titles shorter than 30 or longer than 60 characters.",recommendation:"Review the title for clarity and specificity; treat the character range as a guideline, not a ranking guarantee.",evidenceId}));
  if (!description) findings.push(finding({ruleId:"html.meta_description.missing",dimension:"SEO",severity:"medium",title:"Meta description is missing",description:"No non-empty meta description was detected.",recommendation:"Add a unique summary of the page's purpose and content.",evidenceId}));
  else if (descriptionLength < 70 || descriptionLength > 160) findings.push(finding({ruleId:"html.meta_description.length_out_of_range",dimension:"SEO",severity:"low",title:"Meta description length is outside the suggested range",description:"The detected description contains " + descriptionLength + " characters; this heuristic flags descriptions shorter than 70 or longer than 160 characters.",recommendation:"Review the description for clarity and usefulness; search engines may generate different snippets.",evidenceId}));
  if (!h1) findings.push(finding({ruleId:"html.h1.missing",dimension:"AEO",severity:"medium",title:"Primary heading is missing",description:"No H1 heading was detected.",recommendation:"Provide a clear primary heading that states the page's subject.",evidenceId}));
  if (h1Count > 1) findings.push(finding({ruleId:"html.h1.multiple",dimension:"AEO",severity:"low",title:"Multiple primary headings detected",description:"The document contains " + h1Count + " H1 elements; this may make the page's primary topic less explicit.",recommendation:"Review heading hierarchy and use one clear page-level H1 where it improves document structure.",evidenceId}));
  if (!languagePresent) findings.push(finding({ruleId:"html.lang.missing",dimension:"SEO",severity:"medium",title:"Document language is not declared",description:"The HTML element has no detectable lang attribute.",recommendation:"Declare the primary document language on the HTML element using a valid BCP 47 language tag.",evidenceId}));
  if (!viewportPresent) findings.push(finding({ruleId:"html.viewport.missing",dimension:"SEO",severity:"low",title:"Viewport metadata is missing",description:"No non-empty viewport meta declaration was detected.",recommendation:"Add an appropriate viewport declaration so the page can adapt to device widths.",evidenceId}));
  if (imagesMissingAlt > 0) findings.push(finding({ruleId:"html.image.alt_missing",dimension:"SEO",severity:"medium",title:"Images are missing alternative text attributes",description:imagesMissingAlt + " image elements have no alt attribute. Empty alt text is valid for decorative images.",recommendation:"Provide concise alternative text for informative images and an empty alt attribute for decorative images.",evidenceId}));
  if (!canonical) findings.push(finding({ruleId:"html.canonical.missing",dimension:"SEO",severity:"low",title:"Canonical URL is not declared",description:"No canonical link element was detected.",recommendation:"Declare a canonical URL when duplicate or parameterized URLs are possible.",evidenceId}));
  if (!jsonLd) findings.push(finding({ruleId:"html.structured_data.absent",dimension:"AEO",severity:"low",title:"JSON-LD structured data not detected",description:"No JSON-LD script block was detected; structured data is optional and context-dependent.",recommendation:"Assess whether a supported schema.org type would clarify the page's entities; do not add irrelevant markup.",evidenceId}));
  if (robotsNoIndex) findings.push(finding({ruleId:"html.robots.noindex",dimension:"SEO",severity:"high",title:"Page declares noindex",description:"A robots meta directive appears to request that crawlers not index this page.",recommendation:"Confirm this is intentional for the page's publishing and discovery goals.",evidenceId}));

  return {
    findings,
    observations:{
      titlePresent:Boolean(title),
      titleLength,
      descriptionPresent:description,
      descriptionLength,
      h1Present:Boolean(h1),
      h1Count,
      canonicalPresent:canonical,
      jsonLdPresent:jsonLd,
      noindex:robotsNoIndex,
      languagePresent,
      viewportPresent,
      imagesMissingAlt
    },
    assessedDimensions:["SEO","AEO"],
    scopes:{
      SEO:"HTML title and description quality, canonical and indexing directives, language, viewport, and image alternative text",
      AEO:"HTML primary heading hierarchy and JSON-LD presence"
    }
  };
}

function analyzeOpenApi(content, evidenceId) {
  let document;
  try { document = JSON.parse(content); }
  catch { throw new TypeError("Invalid JSON document: expected a valid OpenAPI JSON document"); }
  if (!document || typeof document !== "object" || Array.isArray(document) || typeof document.openapi !== "string" || !document.info || typeof document.info !== "object") {
    throw new TypeError("Invalid OpenAPI document: openapi and info fields are required");
  }
  const findings = [];
  const paths = document.paths && typeof document.paths === "object" && !Array.isArray(document.paths) ? document.paths : {};
  const operations = [];
  const httpMethods = new Set(["get","put","post","delete","options","head","patch","trace"]);
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (httpMethods.has(method.toLowerCase()) && operation && typeof operation === "object" && !Array.isArray(operation)) {
        operations.push({ path, method: method.toLowerCase(), operation });
      }
    }
  }
  if (!Array.isArray(document.servers) || document.servers.length === 0) findings.push(finding({ruleId:"openapi.servers.missing",dimension:"AgEO",severity:"medium",title:"API server endpoints are not declared",description:"The OpenAPI document does not declare a non-empty servers array.",recommendation:"Document intended server URLs and environments without exposing private infrastructure.",evidenceId}));
  const securityRequirements = [];
  if (Array.isArray(document.security)) securityRequirements.push(...document.security);
  for (const { operation } of operations) {
    if (Array.isArray(operation.security)) securityRequirements.push(...operation.security);
  }
  const securitySchemes = document.components?.securitySchemes && typeof document.components.securitySchemes === "object" && !Array.isArray(document.components.securitySchemes)
    ? document.components.securitySchemes
    : {};
  if (securityRequirements.length > 0 && Object.keys(securitySchemes).length === 0) {
    findings.push(finding({ruleId:"openapi.security_schemes.missing",dimension:"AgEO",severity:"high",title:"Security requirements have no scheme definitions",description:"One or more security requirements are declared, but components.securitySchemes contains no definitions.",recommendation:"Define each referenced authentication scheme under components.securitySchemes, or remove requirements that are not applicable.",evidenceId}));
  }
  const undefinedSchemes = new Set();
  for (const requirement of securityRequirements) {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) continue;
    for (const schemeName of Object.keys(requirement)) {
      if (Object.hasOwn(securitySchemes, schemeName)) continue;
      // OpenAPI 3.2 permits Security Scheme Object URI references as well as component names.
      const versionParts = document.openapi.split(".").map(Number);
      const supportsUriSchemeReferences = versionParts[0] > 3 || (versionParts[0] === 3 && versionParts[1] >= 2);
      let isUriReference = false;
      if (supportsUriSchemeReferences && schemeName.length > 0 && !/\\s/.test(schemeName)) {
        try { new URL(schemeName, "https://searqon.invalid/"); isUriReference = true; }
        catch { isUriReference = false; }
      }
      if (!isUriReference) undefinedSchemes.add(schemeName);
    }
  }
  for (const schemeName of undefinedSchemes) {
    findings.push(finding({ruleId:"openapi.security_scheme.undefined",dimension:"AgEO",severity:"high",title:"Security requirement references an undefined scheme",description:"A security requirement references the scheme '" + schemeName.slice(0,128) + "', but no matching component definition exists.",recommendation:"Add the missing security scheme definition or correct the requirement name.",evidenceId}));
  }
  if (!document.security && !operations.some(({ operation }) => Array.isArray(operation.security))) findings.push(finding({ruleId:"openapi.security.missing",dimension:"AgEO",severity:"medium",title:"Authentication requirements are not explicit",description:"No root-level or operation-level security requirement was detected. This does not prove an API is unauthenticated.",recommendation:"Explicitly document which operations are public and which require a declared security scheme.",evidenceId}));
  if (!document.info.description) findings.push(finding({ruleId:"openapi.description.missing",dimension:"AEO",severity:"low",title:"API description is missing",description:"The API info object has no description.",recommendation:"Describe the API's purpose, intended users, and primary capabilities.",evidenceId}));
  if (Object.keys(paths).length === 0) findings.push(finding({ruleId:"openapi.paths.empty",dimension:"AgEO",severity:"high",title:"No API paths are described",description:"The document contains no declared API paths.",recommendation:"Publish the intended operations or verify that this is the correct OpenAPI document.",evidenceId}));
  const missingOperationIds = operations.filter(({ operation }) => typeof operation.operationId !== "string" || !operation.operationId.trim());
  const missingOperationDescriptions = operations.filter(({ operation }) => typeof operation.description !== "string" || !operation.description.trim());
  if (missingOperationIds.length > 0) findings.push(finding({ruleId:"openapi.operation_id.missing",dimension:"AgEO",severity:"low",title:"API operations lack stable operation identifiers",description:missingOperationIds.length + " operations have no operationId, which can reduce stable tool naming and generated-client consistency.",recommendation:"Assign a unique, stable operationId to each operation and keep it consistent across compatible API versions.",evidenceId}));
  if (missingOperationDescriptions.length > 0) findings.push(finding({ruleId:"openapi.operation_description.missing",dimension:"AEO",severity:"low",title:"API operations lack descriptive summaries",description:missingOperationDescriptions.length + " operations have no description field, limiting machine-readable explanations of their behavior.",recommendation:"Add concise operation descriptions that explain purpose, inputs, side effects, and expected outcomes.",evidenceId}));
  return {findings,observations:{openapiVersion:document.openapi,apiTitle:document.info.title ?? null,apiVersion:document.info.version ?? null,pathCount:Object.keys(paths).length,serverCount:document.servers?.length ?? 0,operationCount:operations.length,operationsMissingOperationId:missingOperationIds.length,operationsMissingDescription:missingOperationDescriptions.length,securitySchemeCount:Object.keys(securitySchemes).length,undefinedSecuritySchemeCount:undefinedSchemes.size},assessedDimensions:["AEO","AgEO"],scopes:{AEO:"OpenAPI API purpose, description, and operation explanations",AgEO:"OpenAPI server declaration, security scheme integrity, operation identifiers, and path surface"}};
}

function buildAssessments(findings, assessedDimensions, scopes) {
  const dimensions = ["SEO","AEO","GEO","AgEO"];
  return Object.freeze(Object.fromEntries(dimensions.map(dimension => {
    const covered = assessedDimensions.includes(dimension);
    const count = findings.filter(item => item.dimension === dimension).length;
    return [dimension,Object.freeze({
      status:covered ? (count ? "findings_detected" : "no_findings_detected") : "not_assessed",
      coverage:covered ? "partial" : "none",
      confidence:covered ? "heuristic" : "none",
      findingCount:count,
      scope:scopes[dimension] ?? null,
      limitation:covered ? "This release checks a limited set of deterministic document signals; it is not a complete discipline audit." : "No supported observation method is implemented for this discipline in this scan."
    })];
  })));
}


function analyzeMarkdown(markdown, evidenceId) {
  const findings = [];
  const headingPresent = /^#{1,6}\s+\S/m.test(markdown);
  const authenticationGuidancePresent = /\b(authentication|authorization|api[- ]key|bearer|oauth|mtls)\b/i.test(markdown);
  const errorHandlingGuidancePresent = /\b(error handling|error codes?|http [45]\d\d|status codes?|problem details)\b/i.test(markdown);
  const rateLimitGuidancePresent = /\b(rate limit|throttl|requests? per (second|minute|hour)|quota)\b/i.test(markdown);
  const versioningGuidancePresent = /\b(api )?version(ing|ed)?\b/i.test(markdown);
  const codeExamplesPresent = /(^|\n)\x60\x60\x60[\s\S]+?\x60\x60\x60/m.test(markdown);
  if (!headingPresent) findings.push(finding({ruleId:"docs.heading.missing",dimension:"AEO",severity:"medium",title:"Documentation heading is missing",description:"No Markdown heading was detected.",recommendation:"Add a descriptive heading that identifies the API or product documented.",evidenceId}));
  if (!authenticationGuidancePresent) findings.push(finding({ruleId:"docs.authentication.missing",dimension:"AgEO",severity:"high",title:"Authentication guidance is not detectable",description:"No common authentication or authorization terminology was found.",recommendation:"Document authentication methods, credential handling, scopes, and authorization expectations without publishing secrets.",evidenceId}));
  if (!errorHandlingGuidancePresent) findings.push(finding({ruleId:"docs.error_handling.missing",dimension:"AgEO",severity:"medium",title:"Error handling guidance is not detectable",description:"No common error-handling or HTTP status terminology was found.",recommendation:"Document error response formats, common status codes, retryability, and remediation guidance.",evidenceId}));
  if (!rateLimitGuidancePresent) findings.push(finding({ruleId:"docs.rate_limits.missing",dimension:"AgEO",severity:"low",title:"Rate-limit guidance is not detectable",description:"No rate-limit, throttling, or quota guidance was found.",recommendation:"Document applicable quotas, rate limits, response headers, and retry behavior.",evidenceId}));
  if (!versioningGuidancePresent) findings.push(finding({ruleId:"docs.versioning.missing",dimension:"AgEO",severity:"low",title:"API versioning guidance is not detectable",description:"No API versioning guidance was found.",recommendation:"Explain the API versioning strategy and compatibility or deprecation policy.",evidenceId}));
  if (!codeExamplesPresent) findings.push(finding({ruleId:"docs.code_examples.missing",dimension:"AEO",severity:"low",title:"Code examples are not detectable",description:"No fenced code example was found.",recommendation:"Provide a minimal, safe, copyable request or integration example.",evidenceId}));
  return {
    findings,
    observations:{headingPresent,authenticationGuidancePresent,errorHandlingGuidancePresent,rateLimitGuidancePresent,versioningGuidancePresent,codeExamplesPresent},
    assessedDimensions:["AEO","AgEO"],
    scopes:{AEO:"Markdown heading and code-example presence",AgEO:"Markdown authentication, error, rate-limit, and versioning guidance"}
  };
}

/** Analyze caller-supplied local content only; never fetch or execute it. */
export function analyzeDocument(input) {
  if (!input || typeof input !== "object" || typeof input.source !== "string" || !input.source.trim() || typeof input.content !== "string" || typeof input.contentType !== "string") {
    throw new TypeError("source, contentType, and string content are required");
  }
  const type = input.contentType.split(";")[0].trim().toLowerCase();
  if (!["text/html","text/markdown","application/json","application/vnd.oai.openapi+json"].includes(type)) throw new TypeError("Unsupported content type: " + type);
  const evidence = createEvidenceRecord({...input,contentType:type,methodologyVersion:RULES_VERSION});
  const analyzed = type === "text/html" ? analyzeHtml(input.content,evidence.id) : type === "text/markdown" ? analyzeMarkdown(input.content,evidence.id) : analyzeOpenApi(input.content,evidence.id);
  return Object.freeze({
    schemaVersion:"1.0.0",
    rulesVersion:RULES_VERSION,
    observationClass:evidence.observationClass,
    evidence,
    summary:Object.freeze({findingCount:analyzed.findings.length,bySeverity:Object.fromEntries(["critical","high","medium","low","info"].map(level => [level,analyzed.findings.filter(item => item.severity === level).length]))}),
    observations:Object.freeze(analyzed.observations),
    assessments:buildAssessments(analyzed.findings,analyzed.assessedDimensions,analyzed.scopes),
    findings:Object.freeze(analyzed.findings)
  });
}
