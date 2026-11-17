import test from "node:test";
import assert from "node:assert/strict";
import { recommendationFindingKey, recommendationPriority } from "../src/platform/recommendations.js";

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
