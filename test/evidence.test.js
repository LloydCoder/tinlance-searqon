import test from "node:test";
import assert from "node:assert/strict";
import { createEvidenceRecord } from "../src/evidence.js";

test("evidence record preserves provenance and a verifiable content digest", () => {
  const record = createEvidenceRecord({
    source:"fixture.html",
    contentType:"text/html",
    content:"<title>Example</title>",
    acquisitionMethod:"local_file",
    collectedAt:"2026-11-14T00:00:00.000Z",
    methodologyVersion:"2026-11-14.1"
  });
  assert.match(record.id,/^evidence_[a-f0-9]{20}$/);
  assert.equal(record.observationClass,"first_party");
  assert.equal(record.acquisitionMethod,"local_file");
  assert.equal(record.collectedAt,"2026-11-14T00:00:00.000Z");
  assert.equal(record.methodologyVersion,"2026-11-14.1");
  assert.equal(record.sha256.length,64);
  assert.equal(record.byteLength,22);
  assert.ok(!("content" in record));
});

test("evidence IDs are stable for the same source, content, and method", () => {
  const input={source:"site.html",contentType:"text/html",content:"same",acquisitionMethod:"local_file",collectedAt:"2026-11-14T00:00:00.000Z"};
  assert.equal(createEvidenceRecord(input).id,createEvidenceRecord({...input,collectedAt:"2026-11-15T00:00:00.000Z"}).id);
});

test("evidence factory rejects missing provenance and malformed timestamps", () => {
  assert.throws(()=>createEvidenceRecord({content:"x",contentType:"text/html"}),/source/);
  assert.throws(()=>createEvidenceRecord({source:"x",content:"x",contentType:"text/html",collectedAt:"y"}),/ISO 8601/);
});

test("evidence factory enforces the same payload bound", () => {
  assert.throws(()=>createEvidenceRecord({source:"large",contentType:"text/html",content:"x".repeat(2*1024*1024+1)}),/analysis limit/);
});
