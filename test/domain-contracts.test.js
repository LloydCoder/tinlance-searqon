import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVIDENCE_OBSERVATION_CLASSES } from "../src/evidence.js";
import { GEO_OBSERVATION_CLASSES } from "../src/geo.js";

async function readSchema(name) {
  return JSON.parse(await readFile(new URL("../schemas/" + name, import.meta.url), "utf8"));
}

test("evidence observation classes stay aligned with the published v1 schemas", async () => {
  const evidence = await readSchema("evidence-record.schema.json");
  const assessment = await readSchema("assessment-report.schema.json");

  assert.deepEqual(evidence.properties.observationClass.enum, EVIDENCE_OBSERVATION_CLASSES);
  assert.deepEqual(assessment.properties.observationClass.enum, EVIDENCE_OBSERVATION_CLASSES);
  assert.deepEqual(assessment.$defs.evidence.properties.observationClass.enum, EVIDENCE_OBSERVATION_CLASSES);
  assert.equal(EVIDENCE_OBSERVATION_CLASSES.includes("agent_simulation"), false);
});

test("GEO observation classes stay aligned with the GEO v1 schema and nested evidence contract", async () => {
  const geo = await readSchema("geo-observation.schema.json");

  assert.deepEqual(geo.properties.observationClass.enum, GEO_OBSERVATION_CLASSES);
  assert.deepEqual(geo.properties.evidence.properties.observationClass.enum, GEO_OBSERVATION_CLASSES);
  assert.ok(GEO_OBSERVATION_CLASSES.every(value => EVIDENCE_OBSERVATION_CLASSES.includes(value)));
});
