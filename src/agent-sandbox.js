import { createHash } from "node:crypto";

const MAX_DOCUMENTS = 12;
const MAX_STEPS = 30;
const MAX_DOCUMENT_BYTES = 8192;
const MAX_TOTAL_BYTES = 12 * 1024;
const MAX_MANIFEST_BYTES = 15 * 1024;
const CONTENT_TYPES = new Set(["text/html","text/markdown","text/plain","application/json"]);
const ACTIONS = new Set(["discover","read_document","follow_link","inspect_openapi","inspect_mcp_snapshot"]);
const METHODS = new Set(["get","head","options","post","put","patch","delete","trace","connect"]);

export class AgentSandboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentSandboxError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AgentSandboxError(code,message);
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key)+":"+stableJson(value[key])).join(",") + "}";
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail("invalid_manifest","The simulation manifest must be JSON serializable.");
  return serialized;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("unknown_manifest_field",field+" contains an unsupported field.");
  }
}

function safeUrl(value, origin, field) {
  if (typeof value !== "string" || value.length > 2048) fail("invalid_document_url",field+" must be an HTTP URL within the declared origin.");
  let url;
  try { url = new URL(value,origin); }
  catch { fail("invalid_document_url",field+" is not a valid URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== origin || url.search || url.hash) {
    fail("document_origin_mismatch",field+" must be HTTPS, credential-free and within the declared origin without query or fragment data.");
  }
  return url;
}

function htmlText(content) {
  return content
    .replace(/<!--[\s\S]*?-->/g," ")
    .replace(/<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi," ")
    .replace(/<[^>]*>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/\s+/g," ")
    .trim();
}

function documentTitle(document) {
  if (document.contentType !== "text/html") return null;
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(document.content);
  return match ? htmlText(match[1]).slice(0,256) : null;
}

function inspectOpenApi(document) {
  let spec;
  try { spec = JSON.parse(document.content); }
  catch { fail("invalid_document_json","The OpenAPI document is not valid JSON."); }
  if (!plainObject(spec) || typeof spec.openapi !== "string" || !/^3\.(0|1|2)(?:\.\d+)?$/.test(spec.openapi)) {
    fail("invalid_openapi_document","The supplied JSON is not a supported OpenAPI 3.x document.");
  }
  const paths = plainObject(spec.paths) ? spec.paths : {};
  const operations = [];
  for (const [path,item] of Object.entries(paths).slice(0,200)) {
    if (!plainObject(item)) continue;
    for (const [method,operation] of Object.entries(item)) {
      if (!METHODS.has(method.toLowerCase()) || !plainObject(operation)) continue;
      operations.push({
        method:method.toUpperCase(),
        path:path.slice(0,512),
        operationId:typeof operation.operationId === "string" ? operation.operationId.slice(0,128) : null,
        hasSummary:typeof operation.summary === "string" && operation.summary.trim().length > 0,
        hasDescription:typeof operation.description === "string" && operation.description.trim().length > 0,
        securityDeclared:Array.isArray(operation.security) || Array.isArray(spec.security)
      });
      if (operations.length >= 500) break;
    }
    if (operations.length >= 500) break;
  }
  return {
    openapiVersion:spec.openapi,
    title:typeof spec.info?.title === "string" ? spec.info.title.slice(0,256) : null,
    operationCount:operations.length,
    operations,
    truncated:Object.keys(paths).length > 200
  };
}

function inspectMcpSnapshot(document) {
  let snapshot;
  try { snapshot = JSON.parse(document.content); }
  catch { fail("invalid_document_json","The MCP metadata snapshot is not valid JSON."); }
  if (!plainObject(snapshot)) fail("invalid_mcp_snapshot","The MCP metadata snapshot must be a JSON object.");
  const tools = Array.isArray(snapshot.tools) ? snapshot.tools.slice(0,200) : [];
  const names = [];
  const duplicates = [];
  const seen = new Set();
  for (const tool of tools) {
    if (!plainObject(tool) || typeof tool.name !== "string") continue;
    const name = tool.name.slice(0,128);
    if (seen.has(name)) duplicates.push(name);
    else names.push(name);
    seen.add(name);
  }
  return {
    protocolVersion:typeof snapshot.protocolVersion === "string" ? snapshot.protocolVersion.slice(0,64) : null,
    toolCount:tools.length,
    toolNames:names,
    duplicateToolNames:duplicates,
    invoked:false
  };
}

function validateManifest(manifest) {
  if (!plainObject(manifest)) fail("invalid_manifest","A plain JSON simulation manifest is required.");
  exactKeys(manifest,new Set(["version","origin","documents","journey"]),"manifest");
  if (manifest.version !== 1) fail("unsupported_manifest_version","Only simulation manifest version 1 is supported.");
  if (typeof manifest.origin !== "string") fail("invalid_origin","A declared HTTPS origin is required.");
  let originUrl;
  try { originUrl = new URL(manifest.origin); }
  catch { fail("invalid_origin","The declared origin is invalid."); }
  if (originUrl.protocol !== "https:" || originUrl.username || originUrl.password
    || originUrl.pathname !== "/" || originUrl.search || originUrl.hash || manifest.origin !== originUrl.origin) {
    fail("invalid_origin","The declared origin must be a canonical HTTPS origin.");
  }
  if (!Array.isArray(manifest.documents) || manifest.documents.length > MAX_DOCUMENTS) {
    fail("too_many_documents","A simulation may contain at most "+MAX_DOCUMENTS+" documents.");
  }
  if (!Array.isArray(manifest.journey) || manifest.journey.length < 1 || manifest.journey.length > MAX_STEPS) {
    fail("too_many_steps","A simulation must contain between one and "+MAX_STEPS+" journey steps.");
  }
  const documents = new Map();
  let totalBytes = 0;
  for (const document of manifest.documents) {
    if (!plainObject(document)) fail("invalid_document","Each document must be a plain object.");
    exactKeys(document,new Set(["id","url","contentType","content"]),"document");
    if (typeof document.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(document.id)) {
      fail("invalid_document_id","Document identifiers must be short, stable identifiers.");
    }
    if (documents.has(document.id)) fail("duplicate_document_id","Document identifiers must be unique.");
    const url = safeUrl(document.url,originUrl.origin,"document.url");
    if (!CONTENT_TYPES.has(document.contentType)) fail("unsupported_content_type","The document content type is not supported.");
    if (typeof document.content !== "string") fail("invalid_document_content","Document content must be text.");
    const bytes = Buffer.byteLength(document.content,"utf8");
    if (bytes > MAX_DOCUMENT_BYTES) fail("document_too_large","Each document is limited to 8 KiB.");
    totalBytes += bytes;
    documents.set(document.id,Object.freeze({
      id:document.id,
      url:url.href,
      pathname:url.pathname,
      contentType:document.contentType,
      content:document.content,
      bytes,
      sha256:sha256(document.content)
    }));
  }
  if (totalBytes > MAX_TOTAL_BYTES) fail("input_too_large","All supplied documents together are limited to 12 KiB.");
  const serialized = stableJson(manifest);
  if (Buffer.byteLength(serialized,"utf8") > MAX_MANIFEST_BYTES) fail("manifest_too_large","The complete simulation manifest is limited to 15 KiB.");
  const journey = manifest.journey.map(step => {
    if (!plainObject(step)) fail("invalid_step","Each journey step must be a plain object.");
    exactKeys(step,new Set(["action","documentId","fromDocumentId","href"]),"journey step");
    if (typeof step.action !== "string" || !ACTIONS.has(step.action)) {
      fail("unsupported_action","The journey contains an unsupported or mutating action.");
    }
    if (step.action === "discover") return {action:step.action};
    if (step.action === "read_document" || step.action === "inspect_openapi" || step.action === "inspect_mcp_snapshot") {
      if (typeof step.documentId !== "string" || !documents.has(step.documentId)) fail("document_not_found","A journey step references an unavailable document.");
      return {action:step.action,documentId:step.documentId};
    }
    if (typeof step.fromDocumentId !== "string" || !documents.has(step.fromDocumentId) || typeof step.href !== "string") {
      fail("invalid_link_step","A link-follow step requires a supplied source document and href.");
    }
    return {action:step.action,fromDocumentId:step.fromDocumentId,href:step.href};
  });
  return {origin:originUrl.origin,documents,journey,inputSha256:sha256(serialized)};
}

export function simulateAgentJourney(manifest, { runId = null } = {}) {
  const validated = validateManifest(manifest);
  const steps = [];
  for (let index = 0; index < validated.journey.length; index += 1) {
    const step = validated.journey[index];
    if (step.action === "discover") {
      steps.push({
        index,
        action:step.action,
        status:"completed",
        result:{documents:[...validated.documents.values()].map(document => ({
          id:document.id,
          path:document.pathname,
          contentType:document.contentType,
          bytes:document.bytes,
          sha256:document.sha256
        }))}
      });
      continue;
    }
    if (step.action === "read_document") {
      const document = validated.documents.get(step.documentId);
      const text = document.contentType === "text/html" ? htmlText(document.content) : document.content.replace(/\s+/g," ").trim();
      steps.push({
        index,
        action:step.action,
        status:"completed",
        evidence:{documentId:document.id,sourcePath:document.pathname,contentSha256:document.sha256},
        result:{documentId:document.id,title:documentTitle(document),textLength:text.length,textSha256:sha256(text)}
      });
      continue;
    }
    if (step.action === "follow_link") {
      const source = validated.documents.get(step.fromDocumentId);
      const destination = safeUrl(step.href,new URL(source.url).origin,"journey.href");
      const target = [...validated.documents.values()].find(document => document.url === destination.href);
      steps.push({
        index,
        action:step.action,
        status:target ? "completed" : "blocked",
        evidence:{documentId:source.id,sourcePath:source.pathname},
        result:target
          ? {documentId:target.id,path:target.pathname,networkRequested:false}
          : {reason:"destination_not_in_supplied_snapshot",networkRequested:false}
      });
      continue;
    }
    if (step.action === "inspect_openapi") {
      const document = validated.documents.get(step.documentId);
      if (document.contentType !== "application/json") fail("invalid_openapi_content_type","OpenAPI inspection requires application/json.");
      steps.push({
        index,
        action:step.action,
        status:"completed",
        evidence:{documentId:document.id,sourcePath:document.pathname,contentSha256:document.sha256},
        result:inspectOpenApi(document)
      });
      continue;
    }
    if (step.action === "inspect_mcp_snapshot") {
      const document = validated.documents.get(step.documentId);
      if (document.contentType !== "application/json") fail("invalid_mcp_content_type","MCP snapshot inspection requires application/json.");
      steps.push({
        index,
        action:step.action,
        status:"completed",
        evidence:{documentId:document.id,sourcePath:document.pathname,contentSha256:document.sha256},
        result:inspectMcpSnapshot(document)
      });
    }
  }
  const result = {
    version:1,
    runId,
    mode:"read_only_snapshot_simulation",
    egress:"none",
    mutations:"disabled",
    inputSha256:validated.inputSha256,
    documents:[...validated.documents.values()].map(document=>({id:document.id,path:document.pathname,contentType:document.contentType,bytes:document.bytes,sha256:document.sha256})),
    steps
  };
  const serializedResult = stableJson(result);
  if (Buffer.byteLength(serializedResult,"utf8") > 48 * 1024) fail("result_too_large","The simulated journey result exceeded its 48 KiB safety limit.");
  const resultSha256 = sha256(serializedResult);
  return Object.freeze({...result,resultSha256});
}
