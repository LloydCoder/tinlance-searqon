import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeDocument } from "../src/analyzer.js";

test("published report schema covers all report and discipline contracts", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/assessment-report.schema.json",import.meta.url),"utf8"));
  assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
  for (const key of ["schemaVersion","rulesVersion","observationClass","evidence","summary","observations","assessments","findings"]) {
    assert.ok(schema.required.includes(key), "missing report field " + key);
  }
  for (const dimension of ["SEO","AEO","GEO","AgEO"]) assert.ok(schema.properties.assessments.required.includes(dimension));
  assert.ok(schema.$defs.finding.required.includes("evidenceId"));
});

test("runtime report output stays aligned with published required keys", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/assessment-report.schema.json",import.meta.url),"utf8"));
  const report = analyzeDocument({source:"fixture.html",contentType:"text/html",content:"<title>Example</title>"});
  assert.deepEqual(Object.keys(report).sort(),[...schema.required].sort());
  assert.deepEqual(Object.keys(report.evidence).sort(),[...schema.$defs.evidence.required].sort());
  for (const dimension of ["SEO","AEO","GEO","AgEO"]) {
    assert.deepEqual(Object.keys(report.assessments[dimension]).sort(),[...schema.$defs.assessment.required].sort());
  }
});
