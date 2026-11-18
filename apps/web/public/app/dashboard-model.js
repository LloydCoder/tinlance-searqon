const DIMENSIONS = Object.freeze(["SEO", "AEO", "GEO", "AgEO"]);
const SEVERITIES = Object.freeze(["critical", "high", "medium", "low", "info"]);
const ACTIVE_STATUSES = new Set(["open", "accepted", "in_progress", "not_resolved"]);

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestSuccessfulAssessment(assessments) {
  return assessments
    .filter(item => item?.status === "succeeded" && item.report && typeof item.report === "object")
    .slice()
    .sort((a, b) => timestamp(b.completedAt) - timestamp(a.completedAt))[0] ?? null;
}

function emptySeverity() {
  return Object.fromEntries(SEVERITIES.map(severity => [severity, 0]));
}

function emptyCoverage() {
  return Object.fromEntries(DIMENSIONS.map(dimension => [dimension, { full: 0, partial: 0, none: 0 }]));
}

export function buildDashboardModel({
  projects = [],
  assessmentsByProject = {},
  recommendationsByProject = {}
} = {}) {
  const model = {
    projectCount: projects.length,
    completedAssessmentCount: 0,
    latestFindingCount: 0,
    latestSeverity: emptySeverity(),
    openActionCount: 0,
    verifiedActionCount: 0,
    recommendationCount: 0,
    coverage: emptyCoverage(),
    recommendations: [],
    recentAssessments: [],
    projectsWithLatestAssessment: 0
  };

  for (const project of projects) {
    const assessments = Array.isArray(assessmentsByProject[project.id])
      ? assessmentsByProject[project.id]
      : [];
    model.completedAssessmentCount += assessments.filter(item => item?.status === "succeeded").length;

    const latest = latestSuccessfulAssessment(assessments);
    if (latest) {
      model.projectsWithLatestAssessment += 1;
      const report = latest.report;
      model.latestFindingCount += Number.isSafeInteger(report.summary?.findingCount)
        ? report.summary.findingCount
        : Array.isArray(report.findings) ? report.findings.length : 0;

      for (const severity of SEVERITIES) {
        const count = report.summary?.bySeverity?.[severity];
        if (Number.isSafeInteger(count) && count >= 0) model.latestSeverity[severity] += count;
      }

      for (const dimension of DIMENSIONS) {
        const coverage = report.assessments?.[dimension]?.coverage;
        if (coverage === "full" || coverage === "partial") model.coverage[dimension][coverage] += 1;
        else model.coverage[dimension].none += 1;
      }
    } else {
      for (const dimension of DIMENSIONS) model.coverage[dimension].none += 1;
    }

    for (const assessment of assessments) {
      if (!assessment || typeof assessment !== "object") continue;
      model.recentAssessments.push({
        ...assessment,
        projectId: project.id,
        projectName: project.name,
        targetUrl: project.targetUrl
      });
    }

    const recommendations = Array.isArray(recommendationsByProject[project.id])
      ? recommendationsByProject[project.id]
      : [];
    for (const recommendation of recommendations) {
      if (!recommendation || typeof recommendation !== "object") continue;
      const enriched = {
        ...recommendation,
        projectId: project.id,
        projectName: project.name,
        targetUrl: project.targetUrl
      };
      model.recommendations.push(enriched);
      if (ACTIVE_STATUSES.has(recommendation.status)) model.openActionCount += 1;
      if (recommendation.status === "verified") model.verifiedActionCount += 1;
    }
  }

  model.recommendationCount = model.recommendations.length;
  model.recommendations.sort((a, b) =>
    (Number(b.priority) || 0) - (Number(a.priority) || 0)
    || timestamp(b.updatedAt) - timestamp(a.updatedAt)
    || String(a.id).localeCompare(String(b.id))
  );
  model.recentAssessments.sort((a, b) =>
    timestamp(b.completedAt ?? b.createdAt) - timestamp(a.completedAt ?? a.createdAt)
    || String(a.id).localeCompare(String(b.id))
  );

  model.recommendations = model.recommendations.slice(0, 8);
  model.recentAssessments = model.recentAssessments.slice(0, 8);
  return model;
}
