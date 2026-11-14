import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aggregateGeoObservations } from "../src/geo.js";

test("bundled GEO aggregate fixture is valid and keeps observation channels separate", async () => {
  const samples=JSON.parse(await readFile(new URL("../examples/geo-observations.json",import.meta.url),"utf8"));
  const groups=aggregateGeoObservations(samples);
  assert.equal(groups.length,2);
  assert.equal(groups.find(group=>group.observationClass==="consumer_observation").sampleSize,2);
  assert.equal(groups.find(group=>group.observationClass==="model_api").sampleSize,1);
});
