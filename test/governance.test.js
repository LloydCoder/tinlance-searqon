import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("product charter preserves the four separate assessment disciplines", async () => {
  const charter = await read("../docs/PRODUCT_CHARTER.md");
  for (const discipline of ["SEO", "AEO", "GEO", "AgEO"]) {
    assert.ok(charter.includes(discipline), `missing ${discipline} discipline`);
  }
  assert.match(charter, /no opaque universal score/i);
});

test("architecture preserves the Tinlyt and TAS authority boundaries", async () => {
  const architecture = await read("../docs/ARCHITECTURE.md");
  assert.match(architecture, /Tinlyt owns/i);
  assert.match(architecture, /TAS owns/i);
  assert.match(architecture, /Searqon must not grant execution authority/i);
});

test("security policy requires SSRF controls and treats fetched content as untrusted", async () => {
  const policy = await read("../SECURITY.md");
  assert.match(policy, /DNS rebinding/i);
  assert.match(policy, /private.*address/i);
  assert.match(policy, /untrusted data/i);
});

test("roadmap defines evidence-based acceptance states", async () => {
  const roadmap = await read("../docs/ROADMAP.md");
  for (const state of ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IMPLEMENTED", "VERIFIED", "ACCEPTED"]) {
    assert.ok(roadmap.includes(state), `missing acceptance state ${state}`);
  }
  assert.match(roadmap, /VERIFIED.*ACCEPTED/s);
});
