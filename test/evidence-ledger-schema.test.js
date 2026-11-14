import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEvidenceRecord } from "../src/evidence.js";
import { createEvidenceLedgerEntry, EVIDENCE_LEDGER_SCHEMA_VERSION } from "../src/evidence-ledger.js";

test("published evidence ledger schema defines a versioned hash-linked entry", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/evidence-ledger-entry.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.$id, "https://searqon.tinlance.com/schemas/evidence-ledger-entry/1.0.0");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schemaVersion", "sequence", "previousHash", "createdAt", "record", "entryHash"]);
  assert.equal(schema.properties.record.$ref, "https://searqon.tinlance.com/schemas/evidence-record/1.0.0");
  const entry = createEvidenceLedgerEntry(createEvidenceRecord({ source: "fixture.html", content: "x", contentType: "text/html" }), { sequence: 1 });
  assert.equal(entry.schemaVersion, EVIDENCE_LEDGER_SCHEMA_VERSION);
  assert.match(entry.entryHash, /^[a-f0-9]{64}$/);
});
