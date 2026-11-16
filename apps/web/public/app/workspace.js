const status = document.querySelector("#workspace-status");
const userName = document.querySelector("#user-name");
const userEmail = document.querySelector("#user-email");
const organizationName = document.querySelector("#organization-name");
const organizationRole = document.querySelector("#organization-role");
const settingsSummary = document.querySelector("#settings-summary");
const projectsList = document.querySelector("#projects-list");
const projectCount = document.querySelector("#project-count");
const projectForm = document.querySelector("#project-form");
const projectDetail = document.querySelector("#project-detail");
const projectNameInput = document.querySelector("#project-name");
const projectTargetInput = document.querySelector("#project-target");

let profile = null;
let organizations = [];
let activeOrganization = null;
let projects = [];
let selectedProject = null;

function setStatus(message, tone = "") {
  status.textContent = message;
  status.className = "workspace-status" + (tone ? " " + tone : "");
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = String(text);
  return item;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.replace("/auth/login/");
    throw new Error("Your session has expired. Sign in again.");
  }
  if (!response.ok) throw new Error(payload?.error?.message ?? "The request could not be completed.");
  return payload;
}

function renderOrganizationOptions() {
  const selector = document.querySelector("#organization-select");
  selector.replaceChildren();
  for (const organization of organizations) {
    const option = node("option", "", organization.name);
    option.value = organization.id;
    selector.append(option);
  }
  selector.value = activeOrganization?.id ?? "";
  selector.disabled = organizations.length < 2;
}

function renderProjects() {
  projectsList.replaceChildren();
  projectCount.textContent = String(projects.length);
  if (!projects.length) {
    projectsList.append(node("p", "muted-copy", "No projects yet. Add your first public property below."));
    return;
  }
  for (const project of projects) {
    const button = node("button", "project-list-item" + (selectedProject?.id === project.id ? " selected" : ""));
    button.type = "button";
    button.setAttribute("aria-pressed", String(selectedProject?.id === project.id));
    const title = node("strong", "", project.name);
    const target = node("span", "", project.targetUrl);
    button.append(title, target);
    button.addEventListener("click", () => selectProject(project));
    projectsList.append(button);
  }
}

function renderOverview(report) {
  const assessments = report?.assessments ?? {};
  for (const card of document.querySelectorAll("[data-dimension]")) {
    const dimension = card.dataset.dimension;
    const assessment = assessments[dimension];
    const score = card.querySelector("strong");
    const foot = card.querySelector(".dimension-foot");
    if (!assessment || assessment.coverage === "none") {
      score.textContent = "Not assessed";
      foot.textContent = "Observation pending";
      continue;
    }
    score.textContent = assessment.findingCount + (assessment.findingCount === 1 ? " finding" : " findings");
    foot.textContent = "Partial · " + assessment.confidence + " confidence";
  }
  const state = document.querySelector(".workspace-state");
  state.textContent = "LATEST ASSESSMENT";
}

function renderAssessmentResult(assessment, target) {
  const report = assessment.report;
  target.replaceChildren();
  const header = node("div", "assessment-result-header");
  header.append(node("span", "eyebrow", "ASSESSMENT RESULT"), node("strong", "", assessment.status === "succeeded" ? "Completed" : "Failed"));
  target.append(header);
  if (!report) {
    target.append(node("p", "muted-copy", "The assessment did not produce a report. Review the status and retry with supported content."));
    return;
  }
  const summary = node("div", "assessment-summary");
  summary.append(
    node("div", "", report.summary?.findingCount ?? 0),
    node("span", "", "Findings"),
    node("div", "", assessment.evidenceId ?? "Unavailable"),
    node("span", "", "Evidence record"),
    node("div", "", assessment.methodologyVersion ?? "Unknown"),
    node("span", "", "Methodology")
  );
  target.append(summary);
  const dimensions = node("p", "muted-copy");
  dimensions.textContent = Object.entries(report.assessments ?? {}).map(([name, item]) =>
    name + ": " + item.status.replaceAll("_", " ") + " · " + item.coverage + " coverage"
  ).join("  /  ");
  target.append(dimensions);
  const findings = Array.isArray(report.findings) ? report.findings : [];
  if (!findings.length) {
    target.append(node("p", "muted-copy", "No findings were recorded for this assessed scope. This is not proof that the property is free of issues."));
  } else {
    const list = node("ol", "finding-list");
    for (const finding of findings) {
      const item = node("li", "finding-item");
      item.append(
        node("span", "finding-severity " + String(finding.severity ?? "info"), finding.severity ?? "finding"),
        node("strong", "", finding.title ?? "Untitled finding"),
        node("p", "", finding.description ?? ""),
        node("p", "finding-recommendation", finding.recommendation ?? "Review the source evidence.")
      );
      list.append(item);
    }
    target.append(list);
  }
  target.append(node("p", "evidence-note", "This is a deterministic, partial assessment of the document you supplied. It is not a complete site crawl, live search measurement, generative-engine observation or security certification."));
  renderOverview(report);
}

async function loadAssessmentHistory(project) {
  const history = document.querySelector("#assessment-history");
  history.replaceChildren();
  const result = await api("/api/v1/projects/" + encodeURIComponent(project.id) + "/assessments");
  if (!result.assessments.length) {
    history.append(node("p", "muted-copy", "No assessments have been recorded for this project."));
    return;
  }
  for (const assessment of result.assessments) {
    const button = node("button", "history-item");
    button.type = "button";
    const date = assessment.completedAt ? new Date(assessment.completedAt).toLocaleString() : "In progress";
    button.append(node("strong", "", date), node("span", "", assessment.status + " · " + (assessment.report?.summary?.findingCount ?? 0) + " findings"));
    button.addEventListener("click", () => {
      const resultPanel = document.querySelector("#assessment-result");
      renderAssessmentResult(assessment, resultPanel);
    });
    history.append(button);
  }
}

function renderProjectDetail(project) {
  projectDetail.replaceChildren();
  const heading = node("div", "project-detail-heading");
  heading.append(node("span", "eyebrow", "PROJECT"), node("h3", "", project.name), node("p", "project-url", project.targetUrl));
  projectDetail.append(heading);
  const form = node("form", "assessment-form");
  form.hidden = !["owner", "admin", "analyst"].includes(activeOrganization?.role);
  form.id = "assessment-form";
  form.append(node("h4", "", "Assess supplied content"));
  form.append(node("p", "muted-copy", "Paste HTML, Markdown, an OpenAPI document or a normalized MCP metadata snapshot. Searqon analyzes only the content submitted here; it does not fetch or execute the target URL."));
  const typeLabel = node("label", "", "Document format");
  typeLabel.htmlFor = "assessment-content-type";
  const type = node("select");
  type.id = "assessment-content-type";
  type.name = "contentType";
  for (const [value, label] of [
    ["text/html", "HTML document"],
    ["text/markdown", "Markdown documentation"],
    ["application/vnd.oai.openapi+json", "OpenAPI JSON"],
    ["application/vnd.searqon.mcp-snapshot+json", "MCP metadata snapshot"]
  ]) {
    const option = node("option", "", label);
    option.value = value;
    type.append(option);
  }
  const contentLabel = node("label", "", "Document content");
  contentLabel.htmlFor = "assessment-content";
  const content = node("textarea");
  content.id = "assessment-content";
  content.name = "content";
  content.rows = 10;
  content.required = true;
  content.maxLength = 2 * 1024 * 1024;
  content.placeholder = "Paste the source document to assess…";
  const submit = node("button", "button button-dark button-small", "Run assessment ↗");
  submit.type = "submit";
  form.append(typeLabel, type, contentLabel, content, submit);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = "Assessing…";
    setStatus("Running a scoped assessment and preserving its report in this project.");
    try {
      const result = await api("/api/v1/projects/" + encodeURIComponent(project.id) + "/assessments", {
        method: "POST",
        body: JSON.stringify({ contentType: type.value, content: content.value })
      });
      renderAssessmentResult(result.assessment, document.querySelector("#assessment-result"));
      content.value = "";
      await loadAssessmentHistory(project);
      setStatus("Assessment completed and saved to the selected project.", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assessment failed.", "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Run assessment ↗";
    }
  });
  projectDetail.append(form);
  const result = node("div", "assessment-result");
  result.id = "assessment-result";
  projectDetail.append(result);
  const history = node("div", "assessment-history");
  history.id = "assessment-history";
  history.append(node("h4", "", "Assessment history"));
  projectDetail.append(history);
  loadAssessmentHistory(project).catch(error => setStatus(error.message, "error"));
}

function selectProject(project) {
  selectedProject = project;
  renderProjects();
  renderProjectDetail(project);
}

async function loadProjects() {
  if (!activeOrganization) return;
  const result = await api("/api/v1/projects?organizationId=" + encodeURIComponent(activeOrganization.id));
  projects = result.projects;
  if (selectedProject) selectedProject = projects.find(item => item.id === selectedProject.id) ?? null;
  renderProjects();
  if (selectedProject) renderProjectDetail(selectedProject);
}

async function loadWorkspace() {
  try {
    const result = await api("/api/v1/auth/me");
    profile = result;
    organizations = Array.isArray(profile.organizations) ? profile.organizations : [];
    activeOrganization = organizations[0] ?? null;
    const user = profile.user;
    userName.textContent = user.display_name || "there";
    userEmail.textContent = user.email || "";
    organizationName.textContent = activeOrganization?.name || "Personal workspace";
    organizationRole.textContent = activeOrganization?.role || "Member";
    settingsSummary.textContent = (user.email || "") + " · " + (activeOrganization?.name || "Personal workspace") + " · " + (activeOrganization?.role || "member");
    renderOrganizationOptions();
    const canWrite = ["owner", "admin", "analyst"].includes(activeOrganization?.role);
    projectForm.hidden = !canWrite;
    if (!activeOrganization) {
      setStatus("Your account is not currently a member of a workspace.", "error");
      return;
    }
    await loadProjects();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Workspace unavailable.", "error");
  }
}

document.querySelector("#organization-select")?.addEventListener("change", async event => {
  activeOrganization = organizations.find(item => item.id === event.target.value) ?? null;
  selectedProject = null;
  organizationName.textContent = activeOrganization?.name ?? "Workspace";
  organizationRole.textContent = activeOrganization?.role ?? "Member";
  projectDetail.replaceChildren(node("p", "muted-copy", "Select a project to review its assessments."));
  projectForm.hidden = !["owner", "admin", "analyst"].includes(activeOrganization?.role);
  await loadProjects().catch(error => setStatus(error.message, "error"));
});

projectForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeOrganization || !projectForm.reportValidity()) return;
  const submit = projectForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Adding project…";
  try {
    const result = await api("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        organizationId: activeOrganization.id,
        name: projectNameInput.value.trim(),
        targetUrl: projectTargetInput.value.trim()
      })
    });
    projectForm.reset();
    await loadProjects();
    selectProject(result.project);
    setStatus("Project created.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Project creation failed.", "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Add project ↗";
  }
});

const signOut = document.querySelector("#sign-out");
signOut?.addEventListener("click", async () => {
  signOut.disabled = true;
  signOut.textContent = "Signing out…";
  try {
    await api("/api/v1/auth/logout", { method: "POST" });
    window.location.replace("/auth/login/");
  } catch (error) {
    signOut.disabled = false;
    signOut.textContent = "Sign out";
    setStatus(error instanceof Error ? error.message : "Sign-out could not be confirmed. Please retry.", "error");
  }
});

loadWorkspace();
