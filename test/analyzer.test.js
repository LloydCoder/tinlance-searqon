import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDocument } from "../src/analyzer.js";

test("HTML analysis emits deterministic, evidence-linked findings", () => {
  const result = analyzeDocument({
    source: "https://example.test/",
    contentType: "text/html",
    content: "<html><head></head><body><p>Hello</p></body></html>"
  });
  assert.equal(result.schemaVersion, "1.0.0");
  assert.equal(result.observationClass, "first_party");
  assert.ok(result.evidence.sha256.length === 64);
  assert.ok(result.findings.some((finding) => finding.ruleId === "html.title.missing"));
  assert.ok(result.findings.every((finding) => finding.evidenceId === result.evidence.id));
});

test("OpenAPI analysis identifies missing operational and security clarity", () => {
  const result = analyzeDocument({
    source: "openapi.json",
    contentType: "application/json",
    content: JSON.stringify({openapi:"3.1.0",info:{title:"Example API",version:"1.0.0"},paths:{}})
  });
  assert.ok(result.findings.some((finding) => finding.ruleId === "openapi.servers.missing"));
  assert.ok(result.findings.some((finding) => finding.ruleId === "openapi.security.missing"));
});

test("unsupported content types fail closed", () => {
  assert.throws(() => analyzeDocument({
    source: "secret.bin",
    contentType: "application/octet-stream",
    content: "x"
  }), /Unsupported content type/);
});

test("malformed JSON returns a safe typed error", () => {
  assert.throws(() => analyzeDocument({
    source: "api.json",
    contentType: "application/json",
    content: "{"
  }), /Invalid JSON document/);
});

test("analysis does not execute or fetch supplied references", () => {
  const input = '<html><head><title>Docs</title></head><body><a href="http://127.0.0.1/">internal</a></body></html>';
  const result = analyzeDocument({source:"local.html",contentType:"text/html",content:input});
  assert.equal(result.evidence.source, "local.html");
  assert.ok(result.findings.some((finding) => finding.ruleId === "html.meta_description.missing"));
});
