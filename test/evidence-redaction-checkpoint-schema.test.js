import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EVIDENCE_REDACTION_JOURNAL_CHECKPOINT_SCHEMA_VERSION } from "../src/evidence-redaction-checkpoint.js";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("redaction journal checkpoint runtime version aligns with its registered schema", async () => {
  const schema = await readJson("../schemas/evidence-redaction-journal-checkpoint.schema.json");
  const registry = await readJson("../schemas/contract-registry.json");
  const contract = registry.contracts.find(item => item.name === "evidence-redaction-journal-checkpoint");

  assert.ok(contract);
  assert.equal(contract.file, "evidence-redaction-journal-checkpoint.schema.json");
  assert.equal(contract.schemaId, schema.$id);
  assert.equal(contract.contractVersion, EVIDENCE_REDACTION_JOURNAL_CHECKPOINT_SCHEMA_VERSION);
  assert.equal(schema.properties.schemaVersion.const, EVIDENCE_REDACTION_JOURNAL_CHECKPOINT_SCHEMA_VERSION);
  assert.equal(schema.additionalProperties, false);
});
