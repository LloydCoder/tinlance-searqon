import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDocument } from "../src/analyzer.js";

test("HTML analysis emits deterministic, evidence-linked findings", () => {
  const input = {source:"https://example.test/",contentType:"text/html",content:"<html><head></head><body><p>Hello</p></body></html>"};
  const result = analyzeDocument(input);
  const again = analyzeDocument(input);
  assert.equal(result.schemaVersion,"1.0.0");
  assert.equal(result.observationClass,"first_party");
  assert.equal(result.evidence.sha256.length,64);
  assert.equal(result.evidence.id,again.evidence.id);
  assert.ok(result.findings.some(item => item.ruleId === "html.title.missing"));
  assert.ok(result.findings.every(item => item.evidenceId === result.evidence.id));
});

test("complete HTML signals are recognized even when attributes are reordered", () => {
  const content = '<html lang="en"><head><meta content="A complete guide to the Example API, including authentication, usage, operational details, and integration examples." name="description"><meta content="width=device-width, initial-scale=1" name="viewport"><link href="https://example.test/" rel="canonical"><script type="application/ld+json">{}</script><title>Example API docs for developers and automated agents</title></head><body><h1>Example</h1><img src="/logo.svg" alt="Example logo"></body></html>';
  const result = analyzeDocument({source:"fixture.html",contentType:"text/html",content});
  assert.deepEqual(result.observations,{titlePresent:true,titleLength:52,descriptionPresent:true,descriptionLength:116,h1Present:true,h1Count:1,canonicalPresent:true,jsonLdPresent:true,noindex:false,languagePresent:true,viewportPresent:true,imagesMissingAlt:0});
  assert.equal(result.findings.length,0);
});

test("OpenAPI analysis identifies missing operational and security clarity", () => {
  const result = analyzeDocument({source:"openapi.json",contentType:"application/json",content:JSON.stringify({openapi:"3.1.0",info:{title:"Example API",version:"1.0.0"},paths:{}})});
  assert.ok(result.findings.some(item => item.ruleId === "openapi.servers.missing"));
  assert.ok(result.findings.some(item => item.ruleId === "openapi.security.missing"));
});

test("unsupported content types fail closed", () => {
  assert.throws(() => analyzeDocument({source:"secret.bin",contentType:"application/octet-stream",content:"x"}),/Unsupported content type/);
});

test("malformed and structurally invalid JSON fail closed", () => {
  assert.throws(() => analyzeDocument({source:"api.json",contentType:"application/json",content:"{"}),/Invalid JSON document/);
  assert.throws(() => analyzeDocument({source:"api.json",contentType:"application/json",content:'{"openapi":"3.1.0"}'}),/openapi and info fields are required/);
});

test("input size is bounded before parsing", () => {
  assert.throws(() => analyzeDocument({source:"large.html",contentType:"text/html",content:"x".repeat(2*1024*1024+1)}),/analysis limit/);
});

test("analysis never fetches source labels or follows links", () => {
  const result = analyzeDocument({source:"http://127.0.0.1/admin",contentType:"text/html",content:'<html><head><title>Docs</title></head><body><a href="http://127.0.0.1/">internal</a></body></html>'});
  assert.equal(result.evidence.source,"http://127.0.0.1/admin");
  assert.ok(result.findings.some(item => item.ruleId === "html.meta_description.missing"));
});


test("HTML SEO analysis reports language, viewport, image-alt, heading, and length gaps", () => {
  const content = '<html><head><title>A very long document title that is clearly far beyond the recommended sixty character upper bound for search snippets</title><meta name="description" content="' + "x".repeat(180) + '"></head><body><h1>One</h1><h1>Two</h1><img src="/hero.png"><img src="/decorative.svg" alt=""></body></html>';
  const result = analyzeDocument({source:"seo-gaps.html",contentType:"text/html",content});
  const ruleIds = result.findings.map(item => item.ruleId);
  for (const ruleId of [
    "html.lang.missing",
    "html.viewport.missing",
    "html.image.alt_missing",
    "html.h1.multiple",
    "html.title.length_out_of_range",
    "html.meta_description.length_out_of_range"
  ]) assert.ok(ruleIds.includes(ruleId), "missing rule " + ruleId);
  assert.equal(result.observations.h1Count, 2);
  assert.equal(result.observations.imagesMissingAlt, 1);
  assert.equal(result.observations.languagePresent, false);
  assert.equal(result.observations.viewportPresent, false);
});


test("OpenAPI readiness validates declared security schemes and operation identifiers", () => {
  const document = {
    openapi: "3.1.0",
    info: { title: "Example API", version: "1.0.0", description: "Example service" },
    servers: [{ url: "https://api.example.com" }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    security: [{ missingAuth: [] }],
    paths: {
      "/items": {
        get: { responses: { "200": { description: "OK" } } },
        post: {
          operationId: "createItem",
          description: "Create an item",
          responses: { "201": { description: "Created" } }
        }
      }
    }
  };
  const result = analyzeDocument({ source: "openapi.json", contentType: "application/json", content: JSON.stringify(document) });
  const ruleIds = result.findings.map(item => item.ruleId);
  assert.ok(ruleIds.includes("openapi.security_scheme.undefined"));
  assert.ok(ruleIds.includes("openapi.operation_id.missing"));
  assert.equal(result.observations.operationCount, 2);
  assert.equal(result.observations.operationsMissingOperationId, 1);
  assert.equal(result.observations.operationsMissingSummaryOrDescription, 1);
  assert.ok(result.findings.every(item => item.evidenceId === result.evidence.id));
});

test("OpenAPI security requirement without any security scheme definition is flagged", () => {
  const document = {
    openapi: "3.1.0",
    info: { title: "Example API", version: "1.0.0", description: "Example service" },
    security: [{ bearerAuth: [] }],
    paths: { "/items": { get: { responses: { "200": { description: "OK" } } } } }
  };
  const result = analyzeDocument({ source: "openapi.json", contentType: "application/json", content: JSON.stringify(document) });
  assert.ok(result.findings.some(item => item.ruleId === "openapi.security_schemes.missing"));
});


test("OpenAPI 3.2 URI-based security scheme references are not mistaken for missing components", () => {
  const document = {
    openapi: "3.2.1",
    info: { title: "Example API", version: "1.0.0", description: "Example service" },
    security: [{ "urn:example:security:bearer": [] }],
    paths: { "/items": { get: { operationId: "listItems", description: "List items", responses: { "200": { description: "OK" } } } } }
  };
  const result = analyzeDocument({ source: "openapi.json", contentType: "application/json", content: JSON.stringify(document) });
  assert.equal(result.observations.undefinedSecuritySchemeCount, 0);
  assert.equal(result.findings.some(item => item.ruleId === "openapi.security_scheme.undefined"), false);
});


test("OpenAPI operation summary satisfies the machine-readable explanation requirement", () => {
  const document = {
    openapi: "3.1.0",
    info: { title: "Example API", version: "1.0.0", description: "Example service" },
    paths: { "/items": { get: { operationId: "listItems", summary: "List items", responses: { "200": { description: "OK" } } } } }
  };
  const result = analyzeDocument({ source: "openapi.json", contentType: "application/json", content: JSON.stringify(document) });
  assert.equal(result.observations.operationsMissingSummaryOrDescription, 0);
  assert.equal(result.findings.some(item => item.ruleId === "openapi.operation_description.missing"), false);
});


test("OpenAPI analysis detects duplicate operationId values across paths and methods", () => {
  const document = {
    openapi: "3.1.0",
    info: { title: "Example API", version: "1.0.0", description: "Example service" },
    paths: {
      "/items": {
        get: { operationId: "listItems", summary: "List items", responses: { "200": { description: "OK" } } },
        post: { operationId: "createItem", summary: "Create item", responses: { "201": { description: "Created" } } }
      },
      "/products": {
        get: { operationId: "listItems", summary: "List products", responses: { "200": { description: "OK" } } }
      }
    }
  };
  const result = analyzeDocument({ source: "openapi.json", contentType: "application/json", content: JSON.stringify(document) });
  assert.equal(result.observations.duplicateOperationIdCount, 1);
  assert.ok(result.findings.some(item => item.ruleId === "openapi.operation_id.duplicate"));
  assert.ok(result.findings.every(item => item.evidenceId === result.evidence.id));
});

test("OpenAPI analysis accepts unique operationId values and reports zero duplicates", () => {
  const document = {
    openapi: "3.1.0",
    info: { title: "Example API", version: "1.0.0", description: "Example service" },
    paths: {
      "/items": { get: { operationId: "listItems", summary: "List items", responses: { "200": { description: "OK" } } } },
      "/products": { get: { operationId: "listProducts", summary: "List products", responses: { "200": { description: "OK" } } } }
    }
  };
  const result = analyzeDocument({ source: "openapi.json", contentType: "application/json", content: JSON.stringify(document) });
  assert.equal(result.observations.duplicateOperationIdCount, 0);
  assert.equal(result.findings.some(item => item.ruleId === "openapi.operation_id.duplicate"), false);
});


test("MCP snapshot analysis assesses passive tool metadata without executing tools", () => {
  const snapshot = {
    protocolVersion: "2026-07-28",
    serverInfo: { name: "Example MCP", version: "1.0.0" },
    capabilities: { tools: {} },
    tools: [
      {
        name: "search_docs",
        description: "Search documentation for relevant pages.",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      }
    ]
  };
  const result = analyzeDocument({
    source: "mcp-snapshot.json",
    contentType: "application/vnd.searqon.mcp-snapshot+json",
    content: JSON.stringify(snapshot)
  });
  assert.equal(result.observations.mcpToolCount, 1);
  assert.equal(result.observations.duplicateToolNameCount, 0);
  assert.equal(result.observations.toolsMissingDescription, 0);
  assert.ok(result.assessments.AgEO.coverage === "partial");
  assert.ok(result.findings.every(item => item.evidenceId === result.evidence.id));
});

test("MCP snapshot analysis detects duplicate names, missing descriptions, and unclassified side effects", () => {
  const snapshot = {
    protocolVersion: "2026-07-28",
    capabilities: { tools: {} },
    tools: [
      { name: "update_record", inputSchema: { type: "object" }, annotations: { destructiveHint: true, openWorldHint: true } },
      { name: "update_record", description: "Update another record.", inputSchema: { type: "object" } }
    ]
  };
  const result = analyzeDocument({
    source: "mcp-snapshot.json",
    contentType: "application/vnd.searqon.mcp-snapshot+json",
    content: JSON.stringify(snapshot)
  });
  const ruleIds = result.findings.map(item => item.ruleId);
  assert.equal(result.observations.duplicateToolNameCount, 1);
  assert.equal(result.observations.toolsMissingDescription, 1);
  assert.ok(ruleIds.includes("mcp.tool.name.duplicate"));
  assert.ok(ruleIds.includes("mcp.tool.description.missing"));
  assert.ok(ruleIds.includes("mcp.tool.side_effects.destructive"));
  assert.ok(ruleIds.includes("mcp.tool.open_world"));
});

test("MCP snapshot analysis rejects malformed snapshots and invalid input schema roots", () => {
  assert.throws(() => analyzeDocument({
    source: "mcp.json",
    contentType: "application/vnd.searqon.mcp-snapshot+json",
    content: JSON.stringify({ protocolVersion: "2026-07-28", tools: {} })
  }), /tools must be an array/);
  assert.throws(() => analyzeDocument({
    source: "mcp.json",
    contentType: "application/vnd.searqon.mcp-snapshot+json",
    content: JSON.stringify({ protocolVersion: "2026-07-28", tools: [{ name: "bad", inputSchema: { type: "string" } }] })
  }), /inputSchema.*object/);
});
