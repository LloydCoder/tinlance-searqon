import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rankRecommendations, compileRemediationPlan } from "../src/platform/recommendation-plans.js";

const recommendations = [
  { id: "rec-medium", dimension: "SEO", severity: "medium", status: "open", occurrenceCount: 1 },
  { id: "rec-critical", dimension: "AgEO", severity: "critical", status: "in_progress", occurrenceCount: 4, dueDate: "2026-11-17" },
  { id: "rec-high", dimension: "GEO", severity: "high", status: "accepted", occurrenceCount: 2, dueDate: "2026-11-19" },
  { id: "rec-verified", dimension: "AEO", severity: "critical", status: "verified", occurrenceCount: 20 }
];

test("cross-discipline prioritization is deterministic, explainable and recurrence-aware", () => {
  const first = rankRecommendations(recommendations, { asOf: "2026-11-18" });
  const second = rankRecommendations([...recommendations].reverse(), { asOf: "2026-11-18" });
  assert.deepEqual(first, second);
  assert.equal(first[0].id, "rec-critical");
  assert.equal(first[0].overdue, true);
  assert.equal(first[0].factors.overdue, 15);
  assert.equal(first.at(-1).id, "rec-verified");
  assert.deepEqual(first.map(item => item.rank), [1, 2, 3, 4]);
  assert.equal(first.at(-1).priorityScore, 0);
});

test("ranking rejects invalid dates, duplicate IDs, unknown dimensions and excessive occurrence counts", () => {
  assert.throws(() => rankRecommendations(recommendations, { asOf: "2026-02-30" }), /real calendar date/);
  assert.throws(() => rankRecommendations([recommendations[0], recommendations[0]], { asOf: "2026-11-18" }), /unique/);
  assert.throws(() => rankRecommendations([{ ...recommendations[0], dimension: "SOC" }], { asOf: "2026-11-18" }), /unsupported/);
  assert.throws(() => rankRecommendations([{ ...recommendations[0], occurrenceCount: 1_000_001 }], { asOf: "2026-11-18" }), /occurrenceCount/);
});

const diff = "--- a/docs/remediation/example.md\n+++ b/docs/remediation/example.md\n@@\n-old\n+new\n";
const digest = createHash("sha256").update(diff, "utf8").digest("hex");
const patch = { path: "docs/remediation/example.md", sha256: digest, diff };
const base = {
  planId: "plan-001",
  projectId: "project-001",
  createdAt: "2026-11-18T12:00:00.000Z",
  steps: [
    { id: "step-1", title: "Fix documentation metadata", recommendationIds: ["rec-1"], patch,
      tests: [{ testId: "test-seo-meta", assessmentId: "assessment-1", patchSha256: digest, status: "passed" }] },
    { id: "step-2", title: "Re-run regression assessment", recommendationIds: ["rec-1"], dependsOn: ["step-1"], patch,
      tests: [{ testId: "test-seo-regression", assessmentId: "assessment-2", patchSha256: digest, status: "passed" }] }
  ]
};

test("remediation plan links recommendation, exact patch digest, dependency order and test evidence without applying changes", () => {
  const plan = compileRemediationPlan(base);
  assert.equal(plan.status, "ready_for_human_review");
  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.autoApply, false);
  assert.equal(plan.autoPublish, false);
  assert.equal(plan.summary.stepCount, 2);
  assert.equal(plan.summary.recommendationCount, 1);
  assert.equal(plan.summary.testEvidenceCount, 2);
  assert.equal(plan.steps[1].dependsOn[0], "step-1");
  assert.equal(plan.steps[0].tests[0].patchSha256, plan.steps[0].patch.sha256);
});

test("remediation plans remain blocked when any test is failed or unrun", () => {
  const plan = compileRemediationPlan({
    ...base,
    steps: [{ ...base.steps[0], tests: [{ ...base.steps[0].tests[0], status: "not_run" }] }]
  });
  assert.equal(plan.status, "blocked_by_test_evidence");
  assert.equal(plan.summary.failedOrUnrunTests, 1);
});

test("remediation plan rejects unsafe paths, invalid patch digests, missing tests and dependency cycles", () => {
  assert.throws(() => compileRemediationPlan({ ...base, steps: [{ ...base.steps[0], patch: { ...patch, path: "../secrets" } }] }), /safe repository-relative/);
  assert.throws(() => compileRemediationPlan({ ...base, steps: [{ ...base.steps[0], patch: { ...patch, sha256: "bad" } }] }), /SHA-256/);
  assert.throws(() => compileRemediationPlan({ ...base, steps: [{ ...base.steps[0], tests: [] }] }), /test evidence/);
  assert.throws(() => compileRemediationPlan({ ...base, planId: "../unsafe" }), /stable ASCII identifier/);
  assert.throws(() => compileRemediationPlan({ ...base, steps: [{ ...base.steps[0], tests: [{ ...base.steps[0].tests[0], patchSha256: "b".repeat(64) }] }] }), /exact patch SHA-256/);
  assert.throws(() => compileRemediationPlan({ ...base, steps: [
    { ...base.steps[0], dependsOn: ["step-2"] },
    { ...base.steps[1], dependsOn: ["step-1"] }
  ] }), /acyclic/);
});
