import test from "node:test";
import assert from "node:assert/strict";
import { createEvidenceRecord, verifyEvidenceRecord, verifyEvidenceContent } from "../src/evidence.js";

test("evidence record preserves provenance and a verifiable content digest", () => {
  const record = createEvidenceRecord({source:"fixture.html",contentType:"text/html",content:"<title>Example</title>",acquisitionMethod:"local_file",collectedAt:"2026-11-14T00:00:00.000Z",methodologyVersion:"2026-11-14.1"});
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

test("evidence source labels are bounded and reject control characters", () => {
  assert.throws(()=>createEvidenceRecord({source:"x".repeat(2049),contentType:"text/html",content:"x"}),/source/);
  assert.throws(()=>createEvidenceRecord({source:"bad\nsource",contentType:"text/html",content:"x"}),/source/);
});

test("evidence factory enforces the same payload bound", () => {
  assert.throws(()=>createEvidenceRecord({source:"large",contentType:"text/html",content:"x".repeat(2*1024*1024+1)}),/analysis limit/);
});


test("evidence factory rejects invalid media types that violate the published schema", () => {
  for (const contentType of ["text", "text /html", "/html", "text/html extra", "a".repeat(256) + "/html", "text/html\nX-Evil: yes"]) {
    assert.throws(() => createEvidenceRecord({ source: "fixture", content: "x", contentType }), /contentType/);
  }
});

test("evidence factory accepts media type parameters but stores only a normalized media type", () => {
  const record = createEvidenceRecord({ source: "fixture", content: "x", contentType: "Text/HTML; charset=utf-8" });
  assert.equal(record.contentType, "text/html");
});

test("evidence factory enforces the published methodology-version length and normalization", () => {
  assert.throws(() => createEvidenceRecord({ source: "fixture", content: "x", contentType: "text/html", methodologyVersion: "v".repeat(129) }), /methodologyVersion/);
  const record = createEvidenceRecord({ source: "fixture", content: "x", contentType: "text/html", methodologyVersion: "  2026.11  " });
  assert.equal(record.methodologyVersion, "2026.11");
});

test("evidence source length uses Unicode code points consistently with JSON Schema", () => {
  const source = "😀".repeat(2048);
  const record = createEvidenceRecord({ source, content: "x", contentType: "text/html" });
  assert.equal([...record.source].length, 2048);
});


test("evidence URL sources are canonicalized without query strings or fragments", () => {
  const record = createEvidenceRecord({ source: "https://Example.com/docs?access_token=secret#section", content: "x", contentType: "text/html" });
  assert.equal(record.source, "https://example.com/docs");
  assert.ok(!record.source.includes("secret"));
});

test("evidence URL sources reject embedded credentials", () => {
  assert.throws(() => createEvidenceRecord({ source: "https://user:secret@example.com/docs", content: "x", contentType: "text/html" }), /credentials/);
});

test("evidence record verification detects identifier and shape tampering", async () => {
  const record = createEvidenceRecord({ source: "fixture.html", content: "payload", contentType: "text/html" });
  assert.equal(verifyEvidenceRecord(record).valid, true);
  assert.equal(verifyEvidenceRecord({ ...record, id: "evidence_" + "0".repeat(20) }).valid, false);
  assert.equal(verifyEvidenceRecord({ ...record, unexpected: true }).valid, false);
});

test("evidence content verification detects byte-length and digest mismatches", async () => {
  const record = createEvidenceRecord({ source: "fixture.html", content: "payload", contentType: "text/html" });
  assert.equal(verifyEvidenceContent(record, "payload").valid, true);
  assert.equal(verifyEvidenceContent(record, "tampered").valid, false);
  assert.equal(verifyEvidenceContent({ ...record, byteLength: 1 }, "payload").valid, false);
});
