import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EVIDENCE_REDACTION_MANIFEST_SCHEMA_VERSION,
  EVIDENCE_REDACTION_REASON_CODES
} from "../src/evidence-redaction.js";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("redaction manifest runtime constants align with the registered v1 JSON Schema", async () => {
  const schema = await readJson("../schemas/evidence-redaction-manifest.schema.json");
  const registry = await readJson("../schemas/contract-registry.json");
  const contract = registry.contracts.find(item => item.name === "evidence-redaction-manifest");

  assert.ok(contract);
  assert.equal(contract.file, "evidence-redaction-manifest.schema.json");
  assert.equal(contract.schemaId, schema.$id);
  assert.equal(contract.contractVersion, EVIDENCE_REDACTION_MANIFEST_SCHEMA_VERSION);
  assert.equal(schema.properties.schemaVersion.const, EVIDENCE_REDACTION_MANIFEST_SCHEMA_VERSION);
  assert.deepEqual(schema.properties.reasonCode.enum, EVIDENCE_REDACTION_REASON_CODES);
  assert.equal(schema.properties.action.const, "suppress_from_exports");
  assert.equal(schema.properties.algorithm.const, "Ed25519");
  assert.equal(schema.properties.evidenceIds.uniqueItems, true);
  assert.equal(schema.additionalProperties, false);
});
