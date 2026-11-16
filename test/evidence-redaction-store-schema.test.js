import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVIDENCE_REDACTION_JOURNAL_SCHEMA_VERSION } from "../src/evidence-redaction-store.js";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("redaction journal runtime version aligns with its registered JSON Schema", async () => {
  const schema = await readJson("../schemas/evidence-redaction-journal-entry.schema.json");
  const registry = await readJson("../schemas/contract-registry.json");
  const contract = registry.contracts.find(item => item.name === "evidence-redaction-journal-entry");

  assert.ok(contract);
  assert.equal(contract.file, "evidence-redaction-journal-entry.schema.json");
  assert.equal(contract.schemaId, schema.$id);
  assert.equal(contract.contractVersion, EVIDENCE_REDACTION_JOURNAL_SCHEMA_VERSION);
  assert.equal(schema.properties.schemaVersion.const, EVIDENCE_REDACTION_JOURNAL_SCHEMA_VERSION);
  assert.equal(schema.properties.manifest.$ref, "https://searqon.tinlance.com/schemas/evidence-redaction-manifest/1.0.0");
  assert.equal(schema.additionalProperties, false);
});
