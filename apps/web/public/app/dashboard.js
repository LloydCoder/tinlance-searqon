import { buildDashboardModel } from "./dashboard-model.js";

const root = document.querySelector("#command-center");
if (root) {
  const metricsTarget = root.querySelector("#command-center-metrics");
  const actionsTarget = root.querySelector("#command-center-actions");
  const recentTarget = root.querySelector("#command-center-recent");
  const coverageTarget = root.querySelector("#command-center-coverage");
  const statusTarget = root.querySelector("#command-center-status");
  const refreshTarget = root.querySelector("#command-center-refresh");
  const actionsCountTarget = root.querySelector("#command-actions-count");
  const organizationSelector = document.querySelector("#organization-select");
  let requestSequence = 0;

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = String(text);
    return item;
  }

  function setStatus(message, tone = "") {
    statusTarget.textContent = message;
    statusTarget.className = "command-status" + (tone ? " " + tone : "");
  }

  function formatDate(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return "Date unavailable";
    return new Date(value).toLocaleString();
  }

  async function getJson(path) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace("/auth/login/");
      throw new Error("Your session has expired. Sign in again.");
    }
    if (!response.ok) throw new Error(payload?.error?.message ?? "Dashboard data could not be loaded.");
    return payload;
  }

  function openProject(project) {
    const projectSection = document.querySelector("#projects");
    const item = [...document.querySelectorAll(".project-list-item")].find(button =>
      button.querySelector("span")?.textContent === project.targetUrl
    );
    if (item) item.click();
    projectSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderMetrics(model) {
    metricsTarget.replaceChildren();
    const metrics = [
      ["Projects", model.projectCount, "In this workspace"],
      ["Successful assessments", model.completedAssessmentCount, "Latest 100 returned per project"],
      ["Latest findings", model.latestFindingCount, "Across each project's latest successful assessment"],
      ["Open actions", model.openActionCount, "Accepted, active or unresolved"],
      ["Verified actions", model.verifiedActionCount, "Evidence-gated verification records"]
    ];
    for (const [label, value, detail] of metrics) {
      const card = element("article", "command-metric");
      card.append(element("span", "", label), element("strong", "", value), element("small", "", detail));
      metricsTarget.append(card);
    }
  }

  function renderActions(model) {
    actionsTarget.replaceChildren();
    actionsCountTarget.textContent = model.openActionCount + " active / " + model.recommendationCount + " tracked";
    const recommendations = model.recommendations;
    if (!recommendations.length) {
      actionsTarget.append(element("p", "command-empty",
        model.recommendationCount
          ? "No open actions remain. Tracked recommendations are currently verified or dismissed."
          : model.projectCount
            ? "No tracked recommendations yet. Open a project, run a successful assessment, then generate its evidence-linked worklist."
            : "Create a project to establish your first evidence-backed baseline."));
      return;
    }
    for (const recommendation of recommendations) {
      const card = element("article", "command-action");
      const top = element("div", "command-action-top");
      const badges = element("div", "command-action-badges");
      badges.append(
        element("span", "command-tag " + String(recommendation.severity ?? "info"), recommendation.severity ?? "info"),
        element("span", "command-tag", recommendation.dimension ?? "Unknown"),
        element("span", "command-tag " + String(recommendation.status ?? ""), String(recommendation.status ?? "unknown").replaceAll("_", " "))
      );
      top.append(element("strong", "command-action-title", recommendation.title ?? "Untitled recommendation"), badges);
      const bottom = element("div", "command-action-bottom");
      bottom.append(
        element("span", "command-action-meta",
          recommendation.projectName + " · Priority " + (Number(recommendation.priority) || 0)
          + " · Seen " + (Number(recommendation.occurrenceCount) || 0) + " time(s)")
      );
      const open = element("button", "command-open-project", "Open project");
      open.type = "button";
      open.addEventListener("click", () => openProject(recommendation));
      bottom.append(open);
      card.append(top, bottom);
      actionsTarget.append(card);
    }
  }

  function renderRecent(model) {
    recentTarget.replaceChildren();
    if (!model.recentAssessments.length) {
      recentTarget.append(element("p", "command-empty", "No assessment activity yet. Your first successful assessment will establish a baseline."));
      return;
    }
    for (const assessment of model.recentAssessments) {
      const item = element("article", "command-recent-item");
      const details = document.createElement("div");
      const findingCount = assessment.report?.summary?.findingCount;
      details.append(
        element("strong", "", assessment.projectName + " · " + (assessment.status === "succeeded" ? "Completed" : "Failed")),
        element("span", "", (Number.isSafeInteger(findingCount) ? findingCount + " findings" : "No report")
          + " · " + (assessment.methodologyVersion ?? "Methodology unavailable"))
      );
      const date = element("span", "", formatDate(assessment.completedAt ?? assessment.createdAt));
      item.append(details, date);
      recentTarget.append(item);
    }
  }

  function renderCoverage(model) {
    coverageTarget.replaceChildren();
    for (const dimension of ["SEO", "AEO", "GEO", "AgEO"]) {
      const counts = model.coverage[dimension];
      const card = element("article", "command-coverage-card");
      card.append(element("strong", "", dimension));
      const stats = element("div", "command-coverage-stats");
      for (const [key, label] of [["full", "Full"], ["partial", "Partial"], ["none", "Not assessed"]]) {
        const line = element("span");
        line.append(document.createTextNode(label), element("b", "", counts[key]));
        stats.append(line);
      }
      card.append(stats);
      coverageTarget.append(card);
    }
  }

  function render(model) {
    renderMetrics(model);
    renderActions(model);
    renderRecent(model);
    renderCoverage(model);
    const state = document.querySelector(".workspace-state");
    if (state) {
      state.textContent = !model.projectCount
        ? "AWAITING FIRST PROJECT"
        : model.projectsWithLatestAssessment
          ? "LATEST PROJECT BASELINES"
          : "AWAITING FIRST ASSESSMENT";
    }
    refreshTarget.textContent = "Refreshed " + new Date().toLocaleTimeString();
  }

  async function loadDashboard() {
    const sequence = ++requestSequence;
    setStatus("Loading workspace intelligence…");
    metricsTarget.replaceChildren(element("div", "command-center-skeleton"));
    actionsTarget.replaceChildren(element("p", "command-empty", "Loading prioritized work…"));
    recentTarget.replaceChildren(element("p", "command-empty", "Loading recent activity…"));
    coverageTarget.replaceChildren();

    try {
      const profile = await getJson("/api/v1/auth/me");
      const organizations = Array.isArray(profile.organizations) ? profile.organizations : [];
      const selectedOrganizationId = organizationSelector?.value || organizations[0]?.id;
      if (!selectedOrganizationId) {
        if (sequence !== requestSequence) return;
        setStatus("No workspace membership is available for this account.", "error");
        metricsTarget.replaceChildren();
        actionsTarget.replaceChildren(element("p", "command-empty", "A workspace membership is required to view project intelligence."));
        recentTarget.replaceChildren();
        coverageTarget.replaceChildren();
        return;
      }

      const projectResult = await getJson("/api/v1/projects?organizationId=" + encodeURIComponent(selectedOrganizationId));
      const projects = Array.isArray(projectResult.projects) ? projectResult.projects : [];
      let failedProjectReads = 0;
      const assessmentsByProject = {};
      const recommendationsByProject = {};
      let cursor = 0;
      const workers = Array.from({ length: Math.min(4, projects.length) }, async () => {
        while (cursor < projects.length) {
          const project = projects[cursor++];
          const [assessmentResult, recommendationResult] = await Promise.allSettled([
            getJson("/api/v1/projects/" + encodeURIComponent(project.id) + "/assessments"),
            getJson("/api/v1/projects/" + encodeURIComponent(project.id) + "/recommendations")
          ]);
          if (assessmentResult.status === "fulfilled") {
            assessmentsByProject[project.id] = Array.isArray(assessmentResult.value.assessments)
              ? assessmentResult.value.assessments : [];
          } else {
            assessmentsByProject[project.id] = [];
            failedProjectReads += 1;
          }
          if (recommendationResult.status === "fulfilled") {
            recommendationsByProject[project.id] = Array.isArray(recommendationResult.value.recommendations)
              ? recommendationResult.value.recommendations : [];
          } else {
            recommendationsByProject[project.id] = [];
            failedProjectReads += 1;
          }
        }
      });
      await Promise.all(workers);
      if (sequence !== requestSequence) return;

      const model = buildDashboardModel({ projects, assessmentsByProject, recommendationsByProject });
      render(model);
      if (failedProjectReads) {
        setStatus("Partial workspace data: " + failedProjectReads + " project data request(s) could not be loaded. Some counts may be incomplete.", "error");
      } else {
        setStatus("Summary uses persisted project assessments and recommendation records. Missing discipline coverage is shown as not assessed, never as zero visibility.");
      }
    } catch (error) {
      if (sequence !== requestSequence) return;
      setStatus(error instanceof Error ? error.message : "Workspace intelligence could not be loaded.", "error");
      metricsTarget.replaceChildren();
      actionsTarget.replaceChildren(element("p", "command-empty", "Dashboard data is temporarily unavailable. Your existing project and assessment records have not been changed."));
      recentTarget.replaceChildren();
      coverageTarget.replaceChildren();
    }
  }

  organizationSelector?.addEventListener("change", loadDashboard);
  window.addEventListener("searqon:workspace-data-changed", loadDashboard);
  loadDashboard();
}
