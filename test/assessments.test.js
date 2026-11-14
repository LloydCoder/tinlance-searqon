import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDocument } from "../src/analyzer.js";

test("assessments report discipline coverage without collapsing into a universal score", () => {
  const html = analyzeDocument({source:"page.html",contentType:"text/html",content:"<title>Example</title><h1>Example</h1>"});
  assert.equal(html.assessments.SEO.status,"findings_detected");
  assert.equal(html.assessments.SEO.coverage,"partial");
  assert.equal(html.assessments.AEO.status,"findings_detected");
  assert.equal(html.assessments.GEO.status,"not_assessed");
  assert.equal(html.assessments.AgEO.status,"not_assessed");
  assert.equal("score" in html,false);
});

test("OpenAPI assessment labels agent readiness as partial and exposes unassessed GEO", () => {
  const api = analyzeDocument({source:"openapi.json",contentType:"application/json",content:JSON.stringify({openapi:"3.1.0",info:{title:"API",version:"1"},paths:{"/health":{get:{responses:{"200":{description:"ok"}}}}}})});
  assert.equal(api.assessments.AgEO.status,"findings_detected");
  assert.equal(api.assessments.AgEO.coverage,"partial");
  assert.match(api.assessments.AgEO.scope,/OpenAPI/);
  assert.equal(api.assessments.GEO.status,"not_assessed");
});
