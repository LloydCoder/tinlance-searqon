import { createHash } from "node:crypto";

const SEVERITY_SCORE = Object.freeze({ critical: 100, high: 80, medium: 60, low: 30, info: 10 });
const DIMENSIONS = new Set(["SEO", "AEO", "GEO", "AgEO"]);
const STATUSES = new Set(["open", "accepted", "in_progress", "dismissed", "not_resolved", "verified"]);
const MAX_RECOMMENDATIONS = 1_000;
const MAX_STEPS = 100;
const SHA256 = /^[a-f0-9]{64}$/;

function date(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(field + " must be a YYYY-MM-DD calendar date");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new TypeError(field + " must be a real calendar date");
  }
  return value;
}

function identifier(value, field, max = 128) {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(field + " must be a normalized non-empty identifier");
  }
  return value;
}

function safePath(value) {
  const path = identifier(value, "patch.path", 240);
  if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path) ||
      /[?#%]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new TypeError("patch.path must be a safe repository-relative path");
  }
  return path;
}

function normalizeRecommendation(item, index, asOf) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("recommendations[" + index + "] must be an object");
  const id = identifier(item.id, "recommendations[" + index + "].id");
  if (!DIMENSIONS.has(item.dimension) || !Object.hasOwn(SEVERITY_SCORE, item.severity) || !STATUSES.has(item.status)) {
    throw new TypeError("recommendations[" + index + "] has an unsupported dimension, severity or status");
  }
  const occurrenceCount = item.occurrenceCount ?? 1;
  if (!Number.isSafeInteger(occurrenceCount) || occurrenceCount < 1 || occurrenceCount > 1_000_000) {
    throw new RangeError("occurrenceCount must be an integer from 1 to 1000000");
  }
  const dueDate = item.dueDate == null ? null : date(item.dueDate, "dueDate");
  const closed = ["verified", "dismissed"].includes(item.status);
  const overdue = dueDate !== null && dueDate < asOf && !closed;
  const recurrence = Math.min(20, Math.floor(Math.log2(occurrenceCount) * 5));
  const statusAdjustment = item.status === "not_resolved" ? 12 : item.status === "in_progress" ? 6 :
    item.status === "accepted" ? 3 : 0;
  const overdueAdjustment = overdue ? 15 : 0;
  const score = closed ? 0 : SEVERITY_SCORE[item.severity] + recurrence + statusAdjustment + overdueAdjustment;
  return {
    id, dimension: item.dimension, severity: item.severity, status: item.status,
    priorityScore: score, overdue, dueDate, occurrenceCount,
    factors: {
      severity: closed ? 0 : SEVERITY_SCORE[item.severity],
      recurrence: closed ? 0 : recurrence,
      workflow: closed ? 0 : statusAdjustment,
      overdue: overdueAdjustment
    }
  };
}

/** Explainable cross-discipline ranking; does not mutate persisted recommendations. */
export function rankRecommendations(recommendations, { asOf } = {}) {
  if (!Array.isArray(recommendations) || recommendations.length > MAX_RECOMMENDATIONS) {
    throw new RangeError("recommendations must be an array of at most " + MAX_RECOMMENDATIONS + " items");
  }
  const today = date(asOf, "asOf");
  const seen = new Set();
  const ranked = recommendations.map((item, index) => {
    const normalized = normalizeRecommendation(item, index, today);
    if (seen.has(normalized.id)) throw new TypeError("recommendation IDs must be unique");
    seen.add(normalized.id);
    return normalized;
  });
  ranked.sort((a, b) => b.priorityScore - a.priorityScore ||
    (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
    a.id.localeCompare(b.id));
  return Object.freeze(ranked.map((item, index) => Object.freeze({ ...item, rank: index + 1, factors: Object.freeze(item.factors) })));
}

/**
 * Build a review-only remediation plan linking recommendations, exact patch
 * bytes and test evidence. No patch is applied and no test command is executed.
 */
export function compileRemediationPlan({ planId, projectId, createdAt, steps } = {}) {
  identifier(planId, "planId");
  identifier(projectId, "projectId");
  if (typeof createdAt !== "string" || Number.isNaN(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) {
    throw new TypeError("createdAt must be a canonical ISO 8601 UTC timestamp");
  }
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) {
    throw new RangeError("steps must contain between 1 and " + MAX_STEPS + " entries");
  }
  const ids = new Set();
  const normalized = steps.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) throw new TypeError("steps[" + index + "] must be an object");
    const stepId = identifier(step.id, "step.id");
    if (ids.has(stepId)) throw new TypeError("step IDs must be unique");
    ids.add(stepId);
    const recommendationIds = step.recommendationIds;
    if (!Array.isArray(recommendationIds) || recommendationIds.length < 1 || recommendationIds.length > 50) {
      throw new TypeError("each step must reference 1 to 50 recommendation IDs");
    }
    const recommendations = [...new Set(recommendationIds.map(id => identifier(id, "recommendationId")))];
    if (recommendations.length !== recommendationIds.length) throw new TypeError("recommendation IDs within a step must be unique");
    const patch = step.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
        typeof patch.sha256 !== "string" || !SHA256.test(patch.sha256) || typeof patch.diff !== "string") {
      throw new TypeError("each step requires a SHA-256 patch proposal digest and diff");
    }
    const path = safePath(patch.path);
    if (!patch.diff.startsWith("--- a/" + path + "\n+++ b/" + path + "\n") || patch.diff.length > 200_000) {
      throw new TypeError("patch.diff must be a bounded unified diff for patch.path");
    }
    const actualPatchDigest = createHash("sha256").update(patch.diff, "utf8").digest("hex");
    if (actualPatchDigest !== patch.sha256) throw new TypeError("patch.sha256 must match the exact unified diff bytes");
    const tests = step.tests;
    if (!Array.isArray(tests) || tests.length < 1 || tests.length > 50) throw new TypeError("each step requires 1 to 50 test evidence references");
    const normalizedTests = tests.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("test evidence must be an object");
      const testId = identifier(item.testId, "test.testId");
      const assessmentId = identifier(item.assessmentId, "test.assessmentId");
      if (item.patchSha256 !== patch.sha256) throw new TypeError("test evidence must bind to the exact patch SHA-256");
      if (!["passed", "failed", "not_run"].includes(item.status)) throw new TypeError("test status must be passed, failed or not_run");
      return Object.freeze({ testId, assessmentId, patchSha256: item.patchSha256, status: item.status });
    });
    const dependsOn = step.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.length > MAX_STEPS) throw new TypeError("dependsOn must be a bounded array");
    return Object.freeze({
      id: stepId,
      title: identifier(step.title, "step.title", 200),
      recommendationIds: Object.freeze(recommendations),
      dependsOn: Object.freeze(dependsOn.map(id => identifier(id, "dependencyId"))),
      patch: Object.freeze({ path, sha256: patch.sha256, diff: patch.diff }),
      tests: Object.freeze(normalizedTests)
    });
  });
  const byId = new Map(normalized.map(step => [step.id, step]));
  for (const step of normalized) {
    if (step.dependsOn.includes(step.id) || step.dependsOn.some(id => !byId.has(id))) {
      throw new TypeError("step dependencies must reference other existing steps and cannot be self-referential");
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new TypeError("remediation plan dependencies must be acyclic");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  const allTestsPassed = normalized.every(step => step.tests.every(item => item.status === "passed"));
  return Object.freeze({
    schemaVersion: "1.0.0",
    type: "recommendation_remediation_plan",
    planId,
    projectId,
    createdAt,
    status: allTestsPassed ? "ready_for_human_review" : "blocked_by_test_evidence",
    approvalRequired: true,
    autoApply: false,
    autoPublish: false,
    steps: Object.freeze(normalized),
    summary: Object.freeze({
      stepCount: normalized.length,
      recommendationCount: new Set(normalized.flatMap(step => step.recommendationIds)).size,
      patchCount: normalized.length,
      testEvidenceCount: normalized.reduce((count, step) => count + step.tests.length, 0),
      failedOrUnrunTests: normalized.reduce((count, step) => count + step.tests.filter(item => item.status !== "passed").length, 0)
    }),
    limitations: Object.freeze([
      "Patch diffs are proposals and are never applied by this compiler.",
      "Test references record supplied evidence; no test command is executed or independently attested.",
      "Source-control writes, pull requests, merges and publishing require a separate explicit human-authorized workflow."
    ])
  });
}
