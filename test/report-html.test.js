import test from "node:test";
import assert from "node:assert/strict";
import { renderHtmlReport } from "../src/report-html.js";

function report(overrides = {}) {
  const evidence = {
    id: "evidence_0123456789abcdefabcd",
    source: "fixture.html",
    acquisitionMethod: "local_file",
    observationClass: "first_party",
    collectedAt: "2026-11-15T00:00:00.000Z",
    contentType: "text/html",
    byteLength: 120,
    sha256: "a".repeat(64),
    methodologyVersion: "2026-11-15.1",
    integrity: "sha256-content-digest"
  };
  const assessments = Object.fromEntries(["SEO", "AEO", "GEO", "AgEO"].map(dimension => [dimension, {
    status: dimension === "SEO" ? "findings_detected" : "not_assessed",
    coverage: dimension === "SEO" ? "partial" : "none",
    confidence: dimension === "SEO" ? "heuristic" : "none",
    findingCount: dimension === "SEO" ? 1 : 0,
    scope: dimension === "SEO" ? "HTML metadata" : null,
    limitation: dimension === "SEO" ? "Heuristic checks only." : "Not assessed in this input."
  }]));
  return {
    schemaVersion: "1.0.0",
    rulesVersion: "2026-11-15.1",
    observationClass: "first_party",
    evidence,
    summary: { findingCount: 1, bySeverity: { critical: 0, high: 0, medium: 1, low: 0, info: 0 } },
    observations: {},
    assessments,
    findings: [{
      id: "finding_1",
      ruleId: "seo.title.missing",
      dimension: "SEO",
      severity: "medium",
      title: "Missing title",
      description: "The document does not contain a title element.",
      recommendation: "Add a concise, descriptive title.",
      evidenceId: evidence.id
    }],
    ...overrides
  };
}

test("HTML report renders semantic, accessible discipline and finding sections", () => {
  const html = renderHtmlReport(report());
  assert.match(html, /<main id="main">/);
  assert.match(html, /<caption>Discipline coverage and limitations<\/caption>/);
  assert.match(html, /<h2 id="findings">Findings/);
  assert.match(html, /Missing title/);
  assert.match(html, /SEO/);
  assert.match(html, /AEO/);
  assert.match(html, /GEO/);
  assert.match(html, /AgEO/);
  assert.match(html, /sha256-content-digest/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /Understand Visibility\. Engineer Discoverability\. Enable Agents\./);
});

test("HTML report escapes untrusted evidence and finding content and loads no remote assets", () => {
  const input = report();
  input.evidence.source = '<img src=x onerror="alert(1)">';
  input.findings[0].title = '<script>alert("xss")</script>';
  input.findings[0].description = '"><svg onload=alert(1)>';
  input.findings[0].recommendation = '<iframe src="https://attacker.example"></iframe>';
  const html = renderHtmlReport(input);
  assert.ok(html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("&lt;iframe"));
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("<iframe"), false);
  assert.equal(html.includes("https://attacker.example"), false);
  assert.match(html, /default-src &#39;none&#39;/);
});

test("HTML report rejects inconsistent summaries and broken evidence references", () => {
  const wrongCount = report();
  wrongCount.summary.findingCount = 2;
  assert.throws(() => renderHtmlReport(wrongCount), /summary findingCount/);
  const brokenReference = report();
  brokenReference.findings[0].evidenceId = "evidence_deadbeefdeadbeefdead";
  assert.throws(() => renderHtmlReport(brokenReference), /evidenceId/);
});

test("HTML report validates discipline assessment counts and severity totals", () => {
  const wrongSeverity = report();
  wrongSeverity.summary.bySeverity.medium = 0;
  assert.throws(() => renderHtmlReport(wrongSeverity), /severity totals/);
  const wrongAssessment = report();
  wrongAssessment.assessments.SEO.findingCount = 0;
  assert.throws(() => renderHtmlReport(wrongAssessment), /assessment findingCount/);
});
