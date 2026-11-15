import { createHash } from "node:crypto";

const DIMENSIONS = ["SEO", "AEO", "GEO", "AgEO"];
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const ASSESSMENT_STATUSES = ["findings_detected", "no_findings_detected", "not_assessed"];
const COVERAGE = ["none", "partial", "full"];
const CONFIDENCE = ["none", "heuristic", "medium", "high"];

const STYLES = `
:root {
  color-scheme: light;
  --ink: #12203A;
  --ivory: #F6F3EC;
  --amber: #E8A33D;
  --slate: #4A5670;
  --mist: #D9D5CA;
  --amber-deep: #8A5200;
  --critical: #8B1E2D;
  --high: #9B3D16;
  --medium: #8A5200;
  --low: #365C75;
  --info: #4A5670;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--ivory);
  color: var(--ink);
  font-family: "Instrument Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.55;
}
.skip-link {
  position: absolute;
  left: -9999px;
  top: 1rem;
  z-index: 10;
  padding: .7rem 1rem;
  background: var(--ivory);
  color: var(--ink);
}
.skip-link:focus { left: 1rem; }
.site-header {
  padding: clamp(2rem, 6vw, 4.5rem) max(1.25rem, calc((100vw - 72rem) / 2));
  background: var(--ink);
  color: var(--ivory);
  border-bottom: .35rem solid var(--amber);
}
.eyebrow, .metadata, code, .severity {
  font-family: "DM Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
}
.eyebrow {
  margin: 0 0 .7rem;
  color: var(--amber);
  font-size: .78rem;
  letter-spacing: .12em;
  text-transform: uppercase;
}
h1, h2, h3 { line-height: 1.2; }
h1 { max-width: 16ch; margin: 0; font-size: clamp(2rem, 5vw, 3.5rem); }
.tagline { max-width: 46rem; margin: 1rem 0 0; color: #E6E1D7; }
.header-meta { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; margin-top: 1.5rem; color: #D9D5CA; font-size: .88rem; }
main { width: min(72rem, calc(100% - 2.5rem)); margin: 2rem auto 4rem; }
section { margin: 0 0 2rem; }
h2 { margin: 0 0 1rem; font-size: clamp(1.4rem, 3vw, 2rem); }
h3 { margin: .5rem 0; font-size: 1.18rem; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .75rem; }
.summary-item, .assessment-panel, .finding, .evidence-panel {
  border: 1px solid var(--mist);
  border-radius: .75rem;
  background: #FFFEFA;
}
.summary-item { padding: 1rem; }
.summary-value { display: block; font-size: 1.8rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.summary-label { color: var(--slate); font-size: .85rem; }
.panel-note { color: var(--slate); }
.table-wrap { overflow-x: auto; border: 1px solid var(--mist); border-radius: .75rem; background: #FFFEFA; }
table { width: 100%; border-collapse: collapse; text-align: left; }
caption { padding: 1rem; text-align: left; font-weight: 700; }
th, td { padding: .8rem 1rem; border-top: 1px solid var(--mist); vertical-align: top; }
thead th { background: #ECE8DE; color: var(--ink); font-size: .85rem; }
tbody th { white-space: nowrap; }
.metadata { color: var(--slate); font-size: .78rem; overflow-wrap: anywhere; }
.status { display: inline-block; font-weight: 700; }
.findings-list { display: grid; gap: 1rem; padding: 0; list-style: none; }
.finding { padding: 1.2rem; border-left: .3rem solid var(--amber); }
.finding-meta { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem 1rem; }
.severity { font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.severity-critical { color: var(--critical); }
.severity-high { color: var(--high); }
.severity-medium { color: var(--medium); }
.severity-low { color: var(--low); }
.severity-info { color: var(--info); }
.dimension { font-weight: 700; }
.rule-id { color: var(--slate); font-size: .78rem; overflow-wrap: anywhere; }
.recommendation {
  margin-top: 1rem;
  padding: .9rem 1rem;
  background: #F1EBDD;
  border-left: .2rem solid var(--amber);
}
.evidence-panel { padding: 1rem; }
.evidence-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .9rem 1.5rem; }
.evidence-grid div { min-width: 0; }
.evidence-grid dt { color: var(--slate); font-size: .8rem; font-weight: 700; }
.evidence-grid dd { margin: .2rem 0 0; overflow-wrap: anywhere; }
code { font-size: .82em; overflow-wrap: anywhere; }
footer {
  padding: 1.5rem max(1.25rem, calc((100vw - 72rem) / 2));
  border-top: 1px solid var(--mist);
  color: var(--slate);
  font-size: .85rem;
}
@media (max-width: 38rem) {
  main { width: min(100% - 1.5rem, 72rem); margin-top: 1.25rem; }
  th, td { padding: .65rem .7rem; }
  .header-meta { display: grid; }
}
@media print {
  body { background: white; }
  .site-header { background: white; color: var(--ink); border-bottom: 2px solid var(--amber); }
  .tagline, .header-meta { color: var(--slate); }
  main { width: 100%; }
  .finding, .summary-item, .evidence-panel, .table-wrap { break-inside: avoid; }
  footer { padding-left: 0; padding-right: 0; }
}
`;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(label + " must be a non-empty string");
  }
  return value;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function label(value) {
  return value.replaceAll("_", " ");
}

function validateReport(report) {
  if (!isRecord(report) || report.schemaVersion !== "1.0.0") {
    throw new TypeError("A Searqon assessment report schemaVersion 1.0.0 is required");
  }
  requireText(report.rulesVersion, "rulesVersion");
  if (!isRecord(report.evidence)) throw new TypeError("evidence must be an object");
  const evidence = report.evidence;
  if (typeof evidence.id !== "string" || !/^evidence_[a-f0-9]{20}$/.test(evidence.id)) throw new TypeError("evidence id is invalid");
  requireText(evidence.source, "evidence.source");
  requireText(evidence.acquisitionMethod, "evidence.acquisitionMethod");
  requireText(evidence.observationClass, "evidence.observationClass");
  requireText(evidence.collectedAt, "evidence.collectedAt");
  requireText(evidence.contentType, "evidence.contentType");
  requireText(evidence.methodologyVersion, "evidence.methodologyVersion");
  if (!Number.isSafeInteger(evidence.byteLength) || evidence.byteLength < 0) throw new TypeError("evidence.byteLength is invalid");
  if (typeof evidence.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new TypeError("evidence.sha256 is invalid");
  if (evidence.integrity !== "sha256-content-digest") throw new TypeError("evidence.integrity is invalid");
  if (report.observationClass !== evidence.observationClass) throw new TypeError("report and evidence observationClass must match");

  if (!isRecord(report.summary) || !Number.isSafeInteger(report.summary.findingCount) || report.summary.findingCount < 0) {
    throw new TypeError("summary findingCount is invalid");
  }
  if (!isRecord(report.summary.bySeverity)) throw new TypeError("summary bySeverity is invalid");
  if (!Array.isArray(report.findings)) throw new TypeError("findings must be an array");
  if (report.summary.findingCount !== report.findings.length) throw new TypeError("summary findingCount does not match findings");

  const severityCounts = Object.fromEntries(SEVERITIES.map(severity => [severity, 0]));
  const dimensionCounts = Object.fromEntries(DIMENSIONS.map(dimension => [dimension, 0]));
  for (const finding of report.findings) {
    if (!isRecord(finding)) throw new TypeError("finding must be an object");
    requireText(finding.id, "finding.id");
    requireText(finding.ruleId, "finding.ruleId");
    requireText(finding.title, "finding.title");
    requireText(finding.description, "finding.description");
    requireText(finding.recommendation, "finding.recommendation");
    if (!DIMENSIONS.includes(finding.dimension)) throw new TypeError("finding dimension is invalid");
    if (!SEVERITIES.includes(finding.severity)) throw new TypeError("finding severity is invalid");
    if (finding.evidenceId !== evidence.id) throw new TypeError("finding evidenceId does not match report evidence");
    severityCounts[finding.severity]++;
    dimensionCounts[finding.dimension]++;
  }
  for (const severity of SEVERITIES) {
    if (!Number.isSafeInteger(report.summary.bySeverity[severity]) ||
        report.summary.bySeverity[severity] !== severityCounts[severity]) {
      throw new TypeError("summary severity totals do not match findings");
    }
  }

  if (!isRecord(report.assessments)) throw new TypeError("assessments must be an object");
  for (const dimension of DIMENSIONS) {
    const assessment = report.assessments[dimension];
    if (!isRecord(assessment) || !ASSESSMENT_STATUSES.includes(assessment.status) ||
        !COVERAGE.includes(assessment.coverage) || !CONFIDENCE.includes(assessment.confidence)) {
      throw new TypeError("assessment " + dimension + " is invalid");
    }
    if (!Number.isSafeInteger(assessment.findingCount) || assessment.findingCount !== dimensionCounts[dimension]) {
      throw new TypeError("assessment findingCount does not match " + dimension + " findings");
    }
    if (assessment.scope !== null && typeof assessment.scope !== "string") throw new TypeError("assessment scope is invalid");
    requireText(assessment.limitation, "assessment limitation");
  }
  return { evidence, severityCounts, dimensionCounts };
}

function summaryItem(value, text) {
  return `<div class="summary-item"><span class="summary-value">${value}</span><span class="summary-label">${text}</span></div>`;
}

export function renderHtmlReport(report) {
  const { evidence, severityCounts } = validateReport(report);
  const styleHash = createHash("sha256").update(STYLES, "utf8").digest("base64");
  const assessmentRows = DIMENSIONS.map(dimension => {
    const assessment = report.assessments[dimension];
    return `<tr>
      <th scope="row">${dimension}</th>
      <td><span class="status">${escapeHtml(label(assessment.status))}</span></td>
      <td>${escapeHtml(assessment.coverage)}</td>
      <td>${escapeHtml(assessment.confidence)}</td>
      <td>${assessment.findingCount}</td>
      <td>${escapeHtml(assessment.scope ?? "Not specified")}</td>
      <td>${escapeHtml(assessment.limitation)}</td>
    </tr>`;
  }).join("");

  const findings = report.findings.length === 0
    ? '<p class="panel-note">No findings were recorded for the assessed scope. This is not proof that the system is free of issues.</p>'
    : `<ol class="findings-list">${report.findings.map(finding => `<li class="finding">
        <div class="finding-meta">
          <span class="severity severity-${finding.severity}">${escapeHtml(finding.severity)}</span>
          <span class="dimension">${escapeHtml(finding.dimension)}</span>
          <code class="rule-id">${escapeHtml(finding.ruleId)}</code>
        </div>
        <h3>${escapeHtml(finding.title)}</h3>
        <p>${escapeHtml(finding.description)}</p>
        <div class="recommendation"><strong>Recommended action</strong><p>${escapeHtml(finding.recommendation)}</p></div>
        <p class="metadata">Evidence record: <code>${escapeHtml(finding.evidenceId)}</code></p>
      </li>`).join("")}</ol>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${styleHash}'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Searqon assessment report</title>
<style>${STYLES}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to report</a>
<header class="site-header">
  <p class="eyebrow">Searqon by Tinlance · Assessment report</p>
  <h1>Discoverability assessment</h1>
  <p class="tagline">Understand Visibility. Engineer Discoverability. Enable Agents.</p>
  <div class="header-meta">
    <span>Source: <code>${escapeHtml(evidence.source)}</code></span>
    <span>Collected: <time>${escapeHtml(evidence.collectedAt)}</time></span>
    <span>Rules: <code>${escapeHtml(report.rulesVersion)}</code></span>
  </div>
</header>
<main id="main">
  <section aria-labelledby="summary">
    <h2 id="summary">Assessment summary</h2>
    <div class="summary-grid">
      ${summaryItem(report.summary.findingCount, "Total findings")}
      ${summaryItem(severityCounts.critical, "Critical")}
      ${summaryItem(severityCounts.high, "High")}
      ${summaryItem(severityCounts.medium, "Medium")}
      ${summaryItem(severityCounts.low, "Low")}
      ${summaryItem(severityCounts.info, "Informational")}
    </div>
    <p class="panel-note">Assessments remain separated across SEO, AEO, GEO, and AgEO. Searqon does not calculate a composite visibility score.</p>
  </section>
  <section aria-labelledby="disciplines">
    <h2 id="disciplines">Discipline coverage</h2>
    <div class="table-wrap">
      <table>
        <caption>Discipline coverage and limitations</caption>
        <thead><tr><th scope="col">Discipline</th><th scope="col">Status</th><th scope="col">Coverage</th><th scope="col">Confidence</th><th scope="col">Findings</th><th scope="col">Scope</th><th scope="col">Limitations</th></tr></thead>
        <tbody>${assessmentRows}</tbody>
      </table>
    </div>
  </section>
  <section aria-labelledby="findings">
    <h2 id="findings">Findings (${report.findings.length})</h2>
    ${findings}
  </section>
  <section aria-labelledby="evidence">
    <h2 id="evidence">Evidence and provenance</h2>
    <div class="evidence-panel">
      <dl class="evidence-grid">
        <div><dt>Evidence ID</dt><dd><code>${escapeHtml(evidence.id)}</code></dd></div>
        <div><dt>Acquisition method</dt><dd>${escapeHtml(evidence.acquisitionMethod)}</dd></div>
        <div><dt>Observation class</dt><dd>${escapeHtml(evidence.observationClass)}</dd></div>
        <div><dt>Content type</dt><dd>${escapeHtml(evidence.contentType)}</dd></div>
        <div><dt>Content length</dt><dd>${evidence.byteLength} bytes</dd></div>
        <div><dt>Integrity method</dt><dd>${escapeHtml(evidence.integrity)}</dd></div>
        <div><dt>SHA-256</dt><dd><code>${escapeHtml(evidence.sha256)}</code></dd></div>
        <div><dt>Methodology version</dt><dd><code>${escapeHtml(evidence.methodologyVersion)}</code></dd></div>
      </dl>
    </div>
  </section>
</main>
<footer>
  <p>Findings are evidence-linked diagnostics based on the declared scope and methodology. They are not ranking predictions, legal advice, or a security certification. No evidence content is uploaded by this report command.</p>
  <p>Report schema ${escapeHtml(report.schemaVersion)} · Rules ${escapeHtml(report.rulesVersion)}</p>
</footer>
</body>
</html>
`;
}
