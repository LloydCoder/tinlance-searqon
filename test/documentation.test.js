import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDocument } from "../src/analyzer.js";

test("Markdown API documentation analysis reports agent-relevant omissions", () => {
  const result = analyzeDocument({
    source:"docs.md",
    contentType:"text/markdown",
    content:"# Payments API\n\nCreate a payment.\n\n## Authentication\nUse a bearer token.\n\n## Errors\nReturns HTTP 400 for invalid input.\n\n## Rate limits\n100 requests per minute.\n\n## Versioning\nVersion 1."
  });
  assert.equal(result.assessments.AgEO.status,"no_findings_detected");
  assert.equal(result.assessments.AgEO.coverage,"partial");
  assert.equal(result.observations.authenticationGuidancePresent,true);
  assert.equal(result.observations.rateLimitGuidancePresent,true);
});

test("Markdown docs without operational guidance produce explicit findings", () => {
  const result = analyzeDocument({source:"readme.md",contentType:"text/markdown",content:"# API\n\nUse this API."});
  assert.ok(result.findings.some(item => item.ruleId === "docs.authentication.missing"));
  assert.ok(result.findings.some(item => item.ruleId === "docs.error_handling.missing"));
  assert.ok(result.findings.some(item => item.ruleId === "docs.rate_limits.missing"));
  assert.equal(result.assessments.AgEO.status,"findings_detected");
});
