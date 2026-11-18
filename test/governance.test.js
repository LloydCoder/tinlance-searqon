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


test("phase one validation pack defines real customer evidence and market research limits", async () => {
  const validation = await read("../docs/validation/PHASE_1_CUSTOMER_VALIDATION.md");
  assert.match(validation, /15 buyer interviews/);
  assert.match(validation, /5 qualified design partners/);
  assert.match(validation, /3 paid-pilot commitments/);
  assert.match(validation, /Current evidence count at this research cut-off:\*\* 0 qualifying interviews; 0 design partners; 0 paid-pilot commitments/);
  assert.match(validation, /self-reported/);
  assert.match(validation, /No interviews have been conducted/);
  for (const competitor of ["Semrush AI Visibility Toolkit","Ahrefs Brand Radar","Otterly.AI","Peec AI","Scrunch","Elmo","OpenSEO"]) {
    assert.ok(validation.includes(competitor), `missing competitor evidence: ${competitor}`);
  }
  assert.match(validation, /Google Search Central/);
  assert.match(validation, /Do not ask leading questions/);
  assert.match(validation, /A non-binding LOI, verbal "yes", free trial/);
});


test("phase one trackers contain only empty slots for real customer evidence", async () => {
  const interviews = await read("../docs/validation/INTERVIEW_TRACKER.csv");
  const partners = await read("../docs/validation/DESIGN_PARTNER_TRACKER.csv");
  const pilots = await read("../docs/validation/PAID_PILOT_TRACKER.csv");
  assert.equal(interviews.trim().split("\n").length, 16);
  assert.equal(partners.trim().split("\n").length, 6);
  assert.equal(pilots.trim().split("\n").length, 4);\n  for (const csv of [interviews, partners, pilots]) {\n    const widths = new Set(csv.trim().split("\n").map((line) => line.split(",").length));\n    assert.equal(widths.size, 1, "CSV rows must match the header width");\n  }
  assert.match(interviews, /P1-INT-015,api_first_agent_platform/);
  assert.match(partners, /P1-DP-005/);
  assert.match(pilots, /P1-PP-003/);
  assert.ok(!/P1-INT-001,[^,]+,[^,]+,[^,]+/.test(interviews), "interview slots must not invent customer identities");
});
