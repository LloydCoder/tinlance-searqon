import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("legal hold journal and checkpoint schemas are registered with exact identities", async () => {
  const registry = JSON.parse(await readFile(new URL("../schemas/contract-registry.json", import.meta.url), "utf8"));
  const entrySchema = JSON.parse(await readFile(new URL("../schemas/evidence-legal-hold-journal-entry.schema.json", import.meta.url), "utf8"));
  const checkpointSchema = JSON.parse(await readFile(new URL("../schemas/evidence-legal-hold-journal-checkpoint.schema.json", import.meta.url), "utf8"));
  const entryContract = registry.contracts.find(item => item.name === "evidence-legal-hold-journal-entry");
  const checkpointContract = registry.contracts.find(item => item.name === "evidence-legal-hold-journal-checkpoint");

  assert.ok(entryContract);
  assert.ok(checkpointContract);
  assert.equal(entryContract.schemaId, entrySchema.$id);
  assert.equal(checkpointContract.schemaId, checkpointSchema.$id);
  assert.equal(entryContract.contractVersion, "1.0.0");
  assert.equal(checkpointContract.contractVersion, "1.0.0");
  assert.equal(entrySchema.additionalProperties, false);
  assert.equal(checkpointSchema.additionalProperties, false);
});
