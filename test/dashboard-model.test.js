import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardModel } from "../apps/web/public/app/dashboard-model.js";

test("dashboard model summarizes real project assessments without inventing scores", () => {
  const projects = [
    { id: "p1", name: "Main site", targetUrl: "https://example.com" },
    { id: "p2", name: "Docs", targetUrl: "https://docs.example.com" }
  ];
  const assessmentsByProject = {
    p1: [
      {
        id: "a-new",
        status: "succeeded",
        completedAt: "2026-11-18T08:00:00.000Z",
        report: {
          summary: { findingCount: 3, bySeverity: { critical: 0, high: 1, medium: 1, low: 1, info: 0 } },
          assessments: {
            SEO: { status: "findings_detected", coverage: "partial" },
            AEO: { status: "findings_detected", coverage: "partial" },
            GEO: { status: "not_assessed", coverage: "none" },
            AgEO: { status: "not_assessed", coverage: "none" }
          }
        }
      },
      { id: "a-failed", status: "failed", completedAt: "2026-11-18T09:00:00.000Z", report: null }
    ],
    p2: [{
      id: "b-old",
      status: "succeeded",
      completedAt: "2026-11-17T08:00:00.000Z",
      report: {
        summary: { findingCount: 2, bySeverity: { critical: 0, high: 0, medium: 2, low: 0, info: 0 } },
        assessments: {
          SEO: { status: "assessed", coverage: "full" },
          AEO: { status: "assessed", coverage: "full" },
          GEO: { status: "not_assessed", coverage: "none" },
          AgEO: { status: "not_assessed", coverage: "none" }
        }
      }
    }]
  };
  const recommendationsByProject = {
    p1: [
      { id: "r1", status: "open", priority: 80, severity: "high", title: "Add a title" },
      { id: "r2", status: "verified", priority: 60, severity: "medium", title: "Add a description" }
    ],
    p2: [
      { id: "r3", status: "in_progress", priority: 100, severity: "critical", title: "Fix API docs" }
    ]
  };

  const model = buildDashboardModel({ projects, assessmentsByProject, recommendationsByProject });

  assert.equal(model.projectCount, 2);
  assert.equal(model.completedAssessmentCount, 2);
  assert.equal(model.latestFindingCount, 5);
  assert.equal(model.openActionCount, 2);
  assert.equal(model.verifiedActionCount, 1);
  assert.equal(model.latestSeverity.high, 1);
  assert.equal(model.latestSeverity.medium, 3);
  assert.equal(model.coverage.SEO.full, 1);
  assert.equal(model.coverage.SEO.partial, 1);
  assert.equal(model.coverage.GEO.none, 2);
  assert.equal(model.recommendations[0].id, "r3");
  assert.equal(model.recentAssessments[0].id, "a-failed");
  assert.equal("score" in model, false);
});

test("dashboard model returns an honest empty state for a new workspace", () => {
  const model = buildDashboardModel({ projects: [], assessmentsByProject: {}, recommendationsByProject: {} });
  assert.equal(model.projectCount, 0);
  assert.equal(model.completedAssessmentCount, 0);
  assert.equal(model.latestFindingCount, 0);
  assert.equal(model.openActionCount, 0);
  assert.deepEqual(model.recommendations, []);
  assert.deepEqual(model.recentAssessments, []);
  for (const dimension of ["SEO", "AEO", "GEO", "AgEO"]) {
    assert.equal(model.coverage[dimension].none, 0);
  }
});
