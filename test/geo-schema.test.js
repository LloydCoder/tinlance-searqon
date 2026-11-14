import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeGeoObservation } from "../src/geo.js";

test("GEO observation JSON Schema describes the runtime contract", async () => {
  const schema=JSON.parse(await readFile(new URL("../schemas/geo-observation.schema.json",import.meta.url),"utf8"));
  const result=analyzeGeoObservation({
    prompt:"Who should I use?",answer:"Acme is good.",brand:"Acme",
    provider:{name:"Sample",observationClass:"model_api"},
    sampledAt:"2026-11-14T12:00:00.000Z"
  });
  assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(Object.keys(result).sort(),[...schema.required].sort());
  assert.deepEqual(Object.keys(result.provider).sort(),[...schema.properties.provider.required].sort());
  assert.deepEqual(Object.keys(result.evidence).sort(),[...schema.properties.evidence.required].sort());
});
