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
  const content = '<html lang="en"><head><meta content="A complete guide to the Example API, including authentication, usage, operational details, and integration examples." name="description"><meta content="width=device-width, initial-scale=1" name="viewport"><link href="https://example.test/" rel="canonical"><script type="application/ld+json">{}</script><title>Example API documentation for developers and automated agents</title></head><body><h1>Example</h1><img src="/logo.svg" alt="Example logo"></body></html>';
  const result = analyzeDocument({source:"fixture.html",contentType:"text/html",content});
  assert.deepEqual(result.observations,{titlePresent:true,titleLength:59,descriptionPresent:true,descriptionLength:113,h1Present:true,h1Count:1,canonicalPresent:true,jsonLdPresent:true,noindex:false,languagePresent:true,viewportPresent:true,imagesMissingAlt:0});
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
