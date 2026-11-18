import { createHash } from "node:crypto";
import { createEvidenceRecord } from "./evidence.js";

const RULES_VERSION = "2026-11-18.1";

function finding(data) {
  const { idSuffix, ...fields } = data;
  return Object.freeze({
    id: "finding_" + data.ruleId + "_" + data.evidenceId.slice(-8) + (idSuffix ? "_" + idSuffix : ""),
    ...fields
  });
}

function getAttribute(tag, name) {
  const pattern = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>]+))", "i");
  const match = tag.match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function renderedHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|textarea|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

function extractTag(html, tag) {
  const pattern = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + "\\s*>", "gi");
  for (const match of html.matchAll(pattern)) {
    const text = match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

function analyzeHtml(html, evidenceId) {
  const uncommentedHtml = html.replace(/<!--[\s\S]*?-->/g, " ");
  const jsonLd = [...uncommentedHtml.matchAll(/<script\b[^>]*>/gi)]
    .some(match => (getAttribute(match[0], "type") ?? "").toLowerCase() === "application/ld+json");
  const visibleHtml = renderedHtml(uncommentedHtml);
  const findings = [];
  const title = extractTag(visibleHtml, "title");
  const h1 = extractTag(visibleHtml, "h1");
  const metaTags = [...visibleHtml.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
  const descriptionTag = metaTags.find(tag => (getAttribute(tag, "name") ?? "").toLowerCase() === "description");
  const descriptionText = (descriptionTag ? getAttribute(descriptionTag, "content") : null)?.trim() ?? "";
  const description = descriptionText.length > 0;
  const canonical = [...visibleHtml.matchAll(/<link\b[^>]*>/gi)].some(match =>
    (getAttribute(match[0], "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical") &&
    Boolean(getAttribute(match[0], "href"))
  );
  const robotsTag = metaTags.find(tag => (getAttribute(tag, "name") ?? "").toLowerCase() === "robots");
  const robotsNoIndex = (getAttribute(robotsTag ?? "", "content") ?? "")
    .split(/[\s,]+/).some(directive => directive.toLowerCase() === "noindex");
  const htmlTag = visibleHtml.match(/<html\b[^>]*>/i)?.[0] ?? "";
  const languagePresent = Boolean((getAttribute(htmlTag, "lang") ?? "").trim());
  const viewportTag = metaTags.find(tag => (getAttribute(tag, "name") ?? "").toLowerCase() === "viewport");
  const viewportPresent = Boolean((getAttribute(viewportTag ?? "", "content") ?? "").trim());
  const titleLength = title ? [...title].length : null;
  const descriptionLength = description ? [...descriptionText].length : null;
  const h1Count = [...visibleHtml.matchAll(/<h1\b[^>]*>/gi)].length;
  const imagesMissingAlt = [...visibleHtml.matchAll(/<img\b[^>]*>/gi)]
    .filter(match => getAttribute(match[0], "alt") === null).length;

  if (!title) findings.push(finding({ruleId:"html.title.missing",dimension:"SEO",severity:"high",title:"Document title is missing",description:"The document has no detectable non-empty title element.",recommendation:"Add a concise, page-specific title that describes the page's primary subject.",evidenceId}));
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
function isSecuritySchemeUriReference(value) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  const looksLikeUri = value.startsWith("/") || value.startsWith("#") ||
    value.startsWith("./") || value.startsWith("../") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
  if (!looksLikeUri || /%(?![A-Fa-f0-9]{2})/.test(value) ||
      /[^A-Za-z0-9\-._~%!$&'()*+,;=:@/?#\[\]]/.test(value) ||
      (value.match(/#/g) ?? []).length > 1) return false;
  try {
    new URL(value, "https://searqon.invalid/");
    return true;
  } catch {
    return false;
  }
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
      // OpenAPI 3.2 permits explicit URI and relative-URI references. A bare
      // single-segment name remains a component-name lookup for compatibility.
      const versionParts = document.openapi.split(".").map(Number);
      const supportsUriSchemeReferences = versionParts[0] > 3 || (versionParts[0] === 3 && versionParts[1] >= 2);
      const isUriReference = supportsUriSchemeReferences && isSecuritySchemeUriReference(schemeName);
      if (!isUriReference) undefinedSchemes.add(schemeName);
    }
  }
  for (const schemeName of undefinedSchemes) {
    findings.push(finding({ruleId:"openapi.security_scheme.undefined",dimension:"AgEO",severity:"high",title:"Security requirement references an undefined scheme",description:"A security requirement references the scheme '" + schemeName.slice(0,128) + "', but no matching component definition exists.",recommendation:"Add the missing security scheme definition or correct the requirement name.",evidenceId,idSuffix:createHash("sha256").update(schemeName).digest("hex").slice(0,8)}));
  }
  if (!document.security && !operations.some(({ operation }) => Array.isArray(operation.security))) findings.push(finding({ruleId:"openapi.security.missing",dimension:"AgEO",severity:"medium",title:"Authentication requirements are not explicit",description:"No root-level or operation-level security requirement was detected. This does not prove an API is unauthenticated.",recommendation:"Explicitly document which operations are public and which require a declared security scheme.",evidenceId}));
  if (!document.info.description) findings.push(finding({ruleId:"openapi.description.missing",dimension:"AEO",severity:"low",title:"API description is missing",description:"The API info object has no description.",recommendation:"Describe the API's purpose, intended users, and primary capabilities.",evidenceId}));
  if (Object.keys(paths).length === 0) findings.push(finding({ruleId:"openapi.paths.empty",dimension:"AgEO",severity:"high",title:"No API paths are described",description:"The document contains no declared API paths.",recommendation:"Publish the intended operations or verify that this is the correct OpenAPI document.",evidenceId}));
  const missingOperationIds = operations.filter(({ operation }) => typeof operation.operationId !== "string" || !operation.operationId.trim());
  const operationIdCounts = new Map();
  for (const { operation } of operations) {
    if (typeof operation.operationId !== "string" || !operation.operationId.trim()) continue;
    const operationId = operation.operationId.trim();
    operationIdCounts.set(operationId, (operationIdCounts.get(operationId) ?? 0) + 1);
  }
  const duplicateOperationIdCount = [...operationIdCounts.values()].filter(count => count > 1).length;
  const missingOperationDescriptions = operations.filter(({ operation }) =>
    !(typeof operation.description === "string" && operation.description.trim()) &&
    !(typeof operation.summary === "string" && operation.summary.trim())
  );
  if (missingOperationIds.length > 0) findings.push(finding({ruleId:"openapi.operation_id.missing",dimension:"AgEO",severity:"low",title:"API operations lack stable operation identifiers",description:missingOperationIds.length + " operations have no operationId, which can reduce stable tool naming and generated-client consistency.",recommendation:"Assign a unique, stable operationId to each operation and keep it consistent across compatible API versions.",evidenceId}));
  if (duplicateOperationIdCount > 0) findings.push(finding({ruleId:"openapi.operation_id.duplicate",dimension:"AgEO",severity:"medium",title:"API operations reuse operation identifiers",description:duplicateOperationIdCount + " operationId values are assigned to more than one operation; this makes operation references ambiguous for generated clients and agent-facing tooling.",recommendation:"Assign a globally unique, stable operationId to every operation in the OpenAPI document.",evidenceId}));
  if (missingOperationDescriptions.length > 0) findings.push(finding({ruleId:"openapi.operation_description.missing",dimension:"AEO",severity:"low",title:"API operations lack concise summaries or descriptions",description:missingOperationDescriptions.length + " operations have neither a summary nor a description, limiting machine-readable explanations of their behavior.",recommendation:"Add a concise summary or description that explains each operation's purpose, inputs, side effects, and expected outcomes.",evidenceId}));
  return {findings,observations:{openapiVersion:document.openapi,apiTitle:document.info.title ?? null,apiVersion:document.info.version ?? null,pathCount:Object.keys(paths).length,serverCount:document.servers?.length ?? 0,operationCount:operations.length,operationsMissingOperationId:missingOperationIds.length,duplicateOperationIdCount,operationsMissingSummaryOrDescription:missingOperationDescriptions.length,securitySchemeCount:Object.keys(securitySchemes).length,undefinedSecuritySchemeCount:undefinedSchemes.size},assessedDimensions:["AEO","AgEO"],scopes:{AEO:"OpenAPI API purpose, description, and operation explanations",AgEO:"OpenAPI server declaration, security scheme integrity, operation identifiers, and path surface"}};
}


function analyzeMcpSnapshot(content, evidenceId) {
  let snapshot;
  try { snapshot = JSON.parse(content); }
  catch { throw new TypeError("Invalid MCP snapshot: expected valid JSON"); }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Invalid MCP snapshot: expected a JSON object");
  }
  if (!Array.isArray(snapshot.tools)) throw new TypeError("MCP snapshot tools must be an array");
  if (snapshot.tools.length > 1000) throw new RangeError("MCP snapshot may contain at most 1000 tools");
  const requestProtocolVersion = snapshot._meta?.["io.modelcontextprotocol/protocolVersion"];
  if (snapshot.protocolVersion !== undefined &&
      (typeof snapshot.protocolVersion !== "string" || !snapshot.protocolVersion.trim() || snapshot.protocolVersion.length > 64)) {
    throw new TypeError("MCP snapshot protocolVersion must be a non-empty string of at most 64 characters");
  }
  if (requestProtocolVersion !== undefined &&
      (typeof requestProtocolVersion !== "string" || !requestProtocolVersion.trim() || requestProtocolVersion.length > 64)) {
    throw new TypeError("MCP request metadata protocolVersion must be a non-empty string of at most 64 characters");
  }
  const protocolVersion = requestProtocolVersion ?? snapshot.protocolVersion ?? null;
  const uses2026Protocol = protocolVersion === "2026-07-28";
  if (snapshot.toolsListMetadata !== undefined) {
    const metadata = snapshot.toolsListMetadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        !Number.isSafeInteger(metadata.ttlMs) || metadata.ttlMs < 0 ||
        !["public", "private"].includes(metadata.cacheScope) ||
        typeof metadata.resultType !== "string" || !metadata.resultType.trim()) {
      throw new TypeError("MCP toolsListMetadata must contain a non-negative integer ttlMs, public/private cacheScope, and non-empty resultType");
    }
  }
  if (snapshot.capabilities !== undefined &&
      (!snapshot.capabilities || typeof snapshot.capabilities !== "object" || Array.isArray(snapshot.capabilities))) {
    throw new TypeError("MCP snapshot capabilities must be an object");
  }
  if (snapshot._meta !== undefined && (!snapshot._meta || typeof snapshot._meta !== "object" || Array.isArray(snapshot._meta))) {
    throw new TypeError("MCP snapshot _meta must be an object");
  }
  const modernServerInfo = snapshot._meta?.["io.modelcontextprotocol/serverInfo"];
  for (const [label, info] of [["serverInfo", snapshot.serverInfo], ["modern serverInfo", modernServerInfo]]) {
    if (info === undefined) continue;
    if (!info || typeof info !== "object" || Array.isArray(info)) throw new TypeError("MCP snapshot " + label + " must be an object");
    for (const field of ["name", "version"]) {
      if (info[field] !== undefined &&
          (typeof info[field] !== "string" || !info[field].trim() || info[field].length > 128)) {
        throw new TypeError("MCP snapshot " + label + "." + field + " must be a non-empty string of at most 128 characters");
      }
    }
  }

  const findings = [];
  const nameCounts = new Map();
  let toolsMissingDescription = 0;
  let toolsWithDestructiveHint = 0;
  let toolsWithOpenWorldHint = 0;
  let toolsWithInvalidHeaderAnnotations = 0;
  let mcpHeaderAnnotationCount = 0;
  let toolsWithSensitiveHeaderAnnotations = 0;
  let toolsWithInvalidNames = 0;
  for (const tool of snapshot.tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool) ||
        typeof tool.name !== "string" || !tool.name.trim() || [...tool.name].length > 128) {
      throw new TypeError("MCP tool name must be a non-empty string of at most 128 characters");
    }
    if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema) ||
        tool.inputSchema.type !== "object") {
      throw new TypeError("MCP tool inputSchema must be a JSON Schema object with type: object");
    }
    if (tool.description !== undefined &&
        (typeof tool.description !== "string" || [...tool.description].length > 4096)) {
      throw new TypeError("MCP tool description must be a string of at most 4096 characters");
    }
    if (tool.outputSchema !== undefined &&
        (!tool.outputSchema || typeof tool.outputSchema !== "object" || Array.isArray(tool.outputSchema))) {
      throw new TypeError("MCP tool outputSchema must be an object");
    }
    if (tool.annotations !== undefined &&
        (!tool.annotations || typeof tool.annotations !== "object" || Array.isArray(tool.annotations))) {
      throw new TypeError("MCP tool annotations must be an object");
    }
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      if (tool.annotations && Object.hasOwn(tool.annotations, hint) && typeof tool.annotations[hint] !== "boolean") {
        throw new TypeError("MCP tool annotation " + hint + " must be boolean");
      }
    }
    nameCounts.set(tool.name, (nameCounts.get(tool.name) ?? 0) + 1);
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) toolsWithInvalidNames++;
    if (typeof tool.description !== "string" || !tool.description.trim()) toolsMissingDescription++;
    if (tool.annotations?.destructiveHint === true) toolsWithDestructiveHint++;
    if (tool.annotations?.openWorldHint === true) toolsWithOpenWorldHint++;

    const headerNames = new Set();
    let invalidHeaderAnnotation = false;
    let sensitiveHeaderAnnotation = false;
    const inspectSchema = (node, reachable = true, depth = 0) => {
      if (!node || typeof node !== "object" || Array.isArray(node) || depth > 32) return;
      if (Object.hasOwn(node, "x-mcp-header")) {
        const headerName = node["x-mcp-header"];
        const tokenValid = typeof headerName === "string" && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName);
        const primitiveTypeValid = ["string", "integer", "boolean"].includes(node.type);
        const duplicate = tokenValid && headerNames.has(headerName.toLowerCase());
        if (!reachable || !tokenValid || !primitiveTypeValid || duplicate) {
          invalidHeaderAnnotation = true;
        } else {
          headerNames.add(headerName.toLowerCase());
          mcpHeaderAnnotationCount++;
          const propertyName = currentPropertyName;
          if (propertyName && /(api.?key|token|secret|password|authorization|credential)/i.test(propertyName)) {
            sensitiveHeaderAnnotation = true;
          }
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "x-mcp-header") continue;
        if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
          for (const [propertyName, propertySchema] of Object.entries(value)) {
            const previous = currentPropertyName;
            currentPropertyName = propertyName;
            inspectSchema(propertySchema, reachable, depth + 1);
            currentPropertyName = previous;
          }
        } else if (Array.isArray(value)) {
          for (const item of value) inspectSchema(item, false, depth + 1);
        } else if (value && typeof value === "object") {
          inspectSchema(value, false, depth + 1);
        }
      }
    };
    let currentPropertyName = null;
    inspectSchema(tool.inputSchema);
    if (invalidHeaderAnnotation) toolsWithInvalidHeaderAnnotations++;
    if (sensitiveHeaderAnnotation) toolsWithSensitiveHeaderAnnotations++;
  }

  const duplicateToolNameCount = [...nameCounts.values()].filter(count => count > 1).length;
  if (duplicateToolNameCount > 0) findings.push(finding({
    ruleId:"mcp.tool.name.duplicate",
    dimension:"AgEO",
    severity:"medium",
    title:"MCP tool names are not unique",
    description:duplicateToolNameCount + " tool names are assigned to more than one tool, making tool selection and references ambiguous.",
    recommendation:"Assign a unique, stable name to every tool exposed by this MCP server.",
    evidenceId
  }));
  if (toolsMissingDescription > 0) findings.push(finding({
    ruleId:"mcp.tool.description.missing",
    dimension:"AEO",
    severity:"low",
    title:"MCP tools lack descriptions",
    description:toolsMissingDescription + " tools have no non-empty description to explain their purpose and expected behavior.",
    recommendation:"Provide concise descriptions covering each tool's purpose, important inputs, side effects, and expected outcomes.",
    evidenceId
  }));
  if (toolsWithDestructiveHint > 0) findings.push(finding({
    ruleId:"mcp.tool.side_effects.destructive",
    dimension:"AgEO",
    severity:"medium",
    title:"MCP tools declare potentially destructive behavior",
    description:toolsWithDestructiveHint + " tools set the destructiveHint annotation to true.",
    recommendation:"Document the affected resources, reversibility, confirmation expectations, and authorization requirements. Treat annotations as untrusted hints, not enforcement.",
    evidenceId
  }));
  if (toolsWithOpenWorldHint > 0) findings.push(finding({
    ruleId:"mcp.tool.open_world",
    dimension:"AgEO",
    severity:"medium",
    title:"MCP tools declare open-world effects",
    description:toolsWithOpenWorldHint + " tools set the openWorldHint annotation to true.",
    recommendation:"Document external systems and side effects, constrain reachable resources, and enforce authorization independently of tool annotations.",
    evidenceId
  }));

  if (toolsWithInvalidNames > 0) findings.push(finding({
    ruleId:"mcp.tool.name.invalid",
    dimension:"AgEO",
    severity:"high",
    title:"MCP tool names contain unsupported characters",
    description:toolsWithInvalidNames + " tools use names outside the MCP-recommended ASCII letter, digit, underscore, hyphen, and dot character set.",
    recommendation:"Use unique, stable tool names containing only ASCII letters, digits, underscore, hyphen, and dot.",
    evidenceId
  }));
  if (uses2026Protocol && snapshot.toolsListMetadata === undefined) findings.push(finding({
    ruleId:"mcp.cache_metadata.missing",
    dimension:"AgEO",
    severity:"medium",
    title:"MCP tools/list cache metadata is missing",
    description:"The 2026-07-28 protocol requires resultType, ttlMs, and cacheScope on cacheable list results; the supplied snapshot has no tools/list cache metadata.",
    recommendation:"Capture the tools/list resultType, non-negative ttlMs, and public/private cacheScope fields from the same protocol response.",
    evidenceId
  }));
  if (toolsWithInvalidHeaderAnnotations > 0) findings.push(finding({
    ruleId:"mcp.tool.header_annotation.invalid",
    dimension:"AgEO",
    severity:"high",
    title:"MCP custom header annotations are invalid",
    description:toolsWithInvalidHeaderAnnotations + " tools contain x-mcp-header annotations that violate token, uniqueness, primitive-type, or static-reachability constraints.",
    recommendation:"Use unique HTTP token header names only on statically reachable string, integer, or boolean properties; never annotate array, composition, conditional, or referenced schema paths.",
    evidenceId
  }));
  if (toolsWithSensitiveHeaderAnnotations > 0) findings.push(finding({
    ruleId:"mcp.tool.header_annotation.sensitive",
    dimension:"AgEO",
    severity:"high",
    title:"MCP custom headers may expose sensitive parameters",
    description:toolsWithSensitiveHeaderAnnotations + " tools annotate parameter names that appear to contain credentials or secrets for forwarding into HTTP headers visible to intermediaries.",
    recommendation:"Do not mark passwords, API keys, tokens, credentials, authorization values, or personal data for x-mcp-header forwarding.",
    evidenceId
  }));

  const capabilities = snapshot.capabilities ?? {};
  const toolsCapabilityAdvertised = Object.hasOwn(capabilities, "tools");
  if (!toolsCapabilityAdvertised && snapshot.tools.length > 0) findings.push(finding({
    ruleId:"mcp.capabilities.tools.not_advertised",
    dimension:"AgEO",
    severity:"medium",
    title:"MCP tool catalog is not reflected in advertised capabilities",
    description:"The snapshot contains tools but does not include a tools capability declaration.",
    recommendation:"Verify that the captured server capability metadata and tool catalog belong to the same protocol snapshot.",
    evidenceId
  }));

  return {
    findings,
    observations:{
      protocolVersion,
      serverName:typeof (snapshot.serverInfo ?? snapshot._meta?.["io.modelcontextprotocol/serverInfo"])?.name === "string" ? (snapshot.serverInfo ?? snapshot._meta["io.modelcontextprotocol/serverInfo"]).name : null,
      mcpToolCount:snapshot.tools.length,
      duplicateToolNameCount,
      toolsMissingDescription,
      toolsWithDestructiveHint,
      toolsWithOpenWorldHint,
      toolsWithInvalidHeaderAnnotations,
      mcpHeaderAnnotationCount,
      toolsWithSensitiveHeaderAnnotations,
      toolsWithInvalidNames,
      toolsListTtlMs:snapshot.toolsListMetadata?.ttlMs ?? null,
      toolsListCacheScope:snapshot.toolsListMetadata?.cacheScope ?? null,
      toolsListResultType:snapshot.toolsListMetadata?.resultType ?? null,
      toolsCapabilityAdvertised
    },
    assessedDimensions:["AEO","AgEO"],
    scopes:{
      AEO:"MCP tool names and descriptions in a caller-supplied metadata snapshot",
      AgEO:"MCP tool catalog uniqueness, input-schema root shape, advertised tool capability, declared side-effect hints, protocol cache metadata, and Streamable HTTP custom-header annotation safety"
    }
  };
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
  if (!["text/html","text/markdown","application/json","application/vnd.oai.openapi+json","application/vnd.searqon.mcp-snapshot+json"].includes(type)) throw new TypeError("Unsupported content type: " + type);
  const evidence = createEvidenceRecord({...input,contentType:type,methodologyVersion:RULES_VERSION});
  const analyzed = type === "text/html" ? analyzeHtml(input.content,evidence.id) : type === "text/markdown" ? analyzeMarkdown(input.content,evidence.id) : type === "application/vnd.searqon.mcp-snapshot+json" ? analyzeMcpSnapshot(input.content,evidence.id) : analyzeOpenApi(input.content,evidence.id);
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
