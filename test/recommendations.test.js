import test from "node:test";
import assert from "node:assert/strict";
import { recommendationFindingKey, recommendationPriority, normalizeRecommendationDueDate } from "../src/platform/recommendations.js";

const finding = {
  ruleId: "html.meta_description.missing",
  dimension: "SEO",
  severity: "medium",
  evidenceId: "evidence-first",
  title: "Meta description is missing",
  description: "No non-empty meta description was detected.",
  recommendation: "Add a unique summary of the page's purpose and content."
};

test("recommendation identity is stable across evidence snapshots", () => {
  const first = recommendationFindingKey(finding);
  const second = recommendationFindingKey({ ...finding, evidenceId: "evidence-second" });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test("recommendation identity separates rule dimensions and explicit locations", () => {
  assert.notEqual(recommendationFindingKey(finding), recommendationFindingKey({ ...finding, dimension: "AEO" }));
  assert.notEqual(recommendationFindingKey(finding), recommendationFindingKey({ ...finding, path: "/v1/users" }));
  assert.equal(
    recommendationFindingKey({ ...finding, path: "/v1/users", evidenceId: "a" }),
    recommendationFindingKey({ ...finding, path: "/v1/users", evidenceId: "b" })
  );
});

test("recommendation priorities are deterministic and severity ordered", () => {
  assert.equal(recommendationPriority("critical"),100);
  assert.equal(recommendationPriority("high"),80);
  assert.equal(recommendationPriority("medium"),60);
  assert.equal(recommendationPriority("low"),30);
  assert.equal(recommendationPriority("info"),10);
  assert.throws(() => recommendationPriority("unknown"),/severity/i);
});

test("recommendation due dates accept real calendar dates and clear with null", () => {
  assert.equal(normalizeRecommendationDueDate("2026-12-01"),"2026-12-01");
  assert.equal(normalizeRecommendationDueDate(null),null);
});

test("recommendation due dates reject invalid, ambiguous and impossible dates", () => {
  for (const value of ["2026-2-01","2026-02-30","2026-13-01","01-12-2026","2026-12-01T00:00:00Z",42,{}]) {
    assert.throws(() => normalizeRecommendationDueDate(value),error=>error.code==="invalid_due_date");
  }
});
