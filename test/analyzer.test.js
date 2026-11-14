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
  const content = '<html><head><meta content="A useful summary" name="description"><link href="https://example.test/" rel="canonical"><script type="application/ld+json">{}</script><title>Example</title></head><body><h1>Example</h1></body></html>';
  const result = analyzeDocument({source:"fixture.html",contentType:"text/html",content});
  assert.deepEqual(result.observations,{titlePresent:true,descriptionPresent:true,h1Present:true,canonicalPresent:true,jsonLdPresent:true,noindex:false});
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
