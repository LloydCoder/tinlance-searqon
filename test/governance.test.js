import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("product charter preserves the four separate assessment disciplines", async () => {
  const charter = await read("../docs/PRODUCT_CHARTER.md");
  for (const discipline of ["SEO", "AEO", "GEO", "AgEO"]) {
    assert.ok(charter.includes(discipline), `missing ${discipline} discipline`);
  }
  assert.match(charter, /must not collapse them into an unexplained universal score/i);
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
  assert.match(policy, /reject loopback, private, link-local/i);
  assert.match(policy, /untrusted data/i);
});

test("roadmap defines evidence-based acceptance states", async () => {
  const roadmap = await read("../docs/ROADMAP.md");
  for (const state of ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IMPLEMENTED", "VERIFIED", "ACCEPTED"]) {
    assert.ok(roadmap.includes(state), `missing acceptance state ${state}`);
  }
  assert.match(roadmap, /VERIFIED.*ACCEPTED/s);
});

test("phase zero governance pack records personas, boundaries, risks, and durable decisions", async () => {
  const charter = await read("../docs/PRODUCT_CHARTER.md");
  const risks = await read("../docs/PRODUCT_RISK_REGISTER.md");
  const decisions = await read("../docs/DECISION_LOG.md");
  const roadmap = await read("../docs/ROADMAP_16_PHASE.md");
  assert.match(charter, /Understand Visibility\. Engineer Discoverability\. Enable Agents\./);
  for (const persona of ["SEO, AEO and digital marketing teams","Technical SEO and digital agencies","SaaS, API-first and developer-tool companies","AI infrastructure"]) {
    assert.ok(charter.includes(persona), `missing persona segment: ${persona}`);
  }
  for (const boundary of ["Searqon owns:","Tinlyt owns:","TAS owns:","FadeReach owns:"]) {
    assert.ok(charter.includes(boundary), `missing ownership boundary: ${boundary}`);
  }
  for (const riskId of ["SR-001","SR-004","SR-005","SR-011","SR-015","SR-017"]) {
    assert.ok(risks.includes(riskId), `missing material risk: ${riskId}`);
  }
  for (const decisionId of ["SD-001","SD-002","SD-003","SD-005","SD-006","SD-008","SD-009"]) {
    assert.ok(decisions.includes(decisionId), `missing durable decision: ${decisionId}`);
  }
  assert.match(roadmap, /0 \| Product governance/);
  assert.match(roadmap, /Scope and security decisions recorded/);
  assert.match(decisions, /RECORDED is a traceability record, not proof/);
});
