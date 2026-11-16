import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EVIDENCE_LEGAL_HOLD_EVENT_SCHEMA_VERSION,
  EVIDENCE_LEGAL_HOLD_REASON_CODES
} from "../src/evidence-legal-holds.js";

test("legal-hold runtime contract matches its registered JSON Schema", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/evidence-legal-hold-event.schema.json", import.meta.url), "utf8"));
  const registry = JSON.parse(await readFile(new URL("../schemas/contract-registry.json", import.meta.url), "utf8"));
  const contract = registry.contracts.find(item => item.name === "evidence-legal-hold-event");

  assert.ok(contract);
  assert.equal(contract.file, "evidence-legal-hold-event.schema.json");
  assert.equal(contract.contractVersion, EVIDENCE_LEGAL_HOLD_EVENT_SCHEMA_VERSION);
  assert.equal(schema.$id, contract.schemaId);
  assert.deepEqual(schema.properties.reasonCode.enum, EVIDENCE_LEGAL_HOLD_REASON_CODES);
  assert.deepEqual(schema.properties.action.enum, ["place", "release"]);
  assert.equal(schema.additionalProperties, false);
});
