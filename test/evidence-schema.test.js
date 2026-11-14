import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEvidenceRecord } from "../src/evidence.js";

test("published evidence schema defines the complete versioned provenance contract", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/evidence-record.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, "https://searqon.tinlance.com/schemas/evidence-record/1.0.0");
  assert.equal(schema.additionalProperties, false);
  for (const field of ["id", "source", "acquisitionMethod", "observationClass", "collectedAt", "contentType", "byteLength", "sha256", "methodologyVersion", "integrity"]) {
    assert.ok(schema.required.includes(field), "missing evidence field " + field);
    assert.ok(schema.properties[field], "missing schema definition for " + field);
  }
  assert.deepEqual(schema.properties.observationClass.enum, ["crawl", "first_party", "consumer_observation", "model_api", "derived", "estimate"]);
  assert.equal(schema.properties.integrity.const, "sha256-content-digest");
  assert.equal(schema.properties.byteLength.maximum, 2 * 1024 * 1024);
  assert.equal(schema.properties.sha256.pattern, "^[a-f0-9]{64}$");
  assert.equal(schema.properties.id.pattern, "^evidence_[a-f0-9]{20}$");
  assert.equal(schema.properties.source.maxLength, 2048);
  assert.equal(Object.hasOwn(schema.properties, "content"), false);
});

test("runtime evidence records match the published schema's required fields and constraints", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/evidence-record.schema.json", import.meta.url), "utf8"));
  const record = createEvidenceRecord({
    source: "https://example.com/docs",
    contentType: "text/html; charset=utf-8",
    content: "<title>Docs</title>",
    acquisitionMethod: "http_get",
    observationClass: "crawl",
    collectedAt: "2026-11-14T00:00:00.000Z"
  });
  assert.deepEqual(Object.keys(record).sort(), [...schema.required].sort());
  assert.match(record.id, new RegExp(schema.properties.id.pattern));
  assert.match(record.sha256, new RegExp(schema.properties.sha256.pattern));
  assert.ok(schema.properties.observationClass.enum.includes(record.observationClass));
  assert.equal(record.integrity, schema.properties.integrity.const);
  assert.equal(record.byteLength, Buffer.byteLength("<title>Docs</title>"));
});
