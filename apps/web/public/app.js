const navToggle = document.querySelector(".nav-toggle");
const primaryNav = document.querySelector("#primary-nav");
if (navToggle && primaryNav) {
  navToggle.addEventListener("click", () => {
    const open = navToggle.getAttribute("aria-expanded") !== "true";
    navToggle.setAttribute("aria-expanded", String(open));
    primaryNav.classList.toggle("open", open);
  });
  primaryNav.addEventListener("click", event => {
    if (event.target.closest("a")) {
      navToggle.setAttribute("aria-expanded", "false");
      primaryNav.classList.remove("open");
    }
  });
}

const form = document.querySelector("#assessment-form");
const status = document.querySelector("#form-status");
const resultPanel = document.querySelector("#assessment-result");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function renderAssessment(report) {
  resultPanel.replaceChildren();
  const heading = element("h3", "", "Assessment complete");
  const stats = element("div", "result-stats");
  const metrics = [
    ["Findings", report.summary?.findingCount ?? report.findings?.length ?? 0],
    ["Evidence record", report.evidence?.id ?? "Created"],
    ["Dimensions", Object.keys(report.assessments ?? {}).length]
  ];
  for (const [label, value] of metrics) {
    const item = element("div", "result-stat");
    item.append(element("strong", "", value), element("span", "", label));
    stats.append(item);
  }
  resultPanel.append(heading, stats);
  const assessments = report.assessments ?? {};
  const dimensionNames = Object.keys(assessments);
  if (dimensionNames.length) {
    const coverage = element("p", "result-list");
    coverage.textContent = dimensionNames.map(name => {
      const assessment = assessments[name];
      return name + ": " + (assessment.status ?? "unknown") + " (" + (assessment.coverage ?? "unknown") + " coverage)";
    }).join(" · ");
    resultPanel.append(coverage);
  }
  const findings = Array.isArray(report.findings) ? report.findings : [];
  if (findings.length) {
    resultPanel.append(element("h4", "", "Priority findings"));
    const list = element("ul", "result-list");
    for (const finding of findings.slice(0, 5)) {
      const item = element("li");
      item.append(
        element("strong", "", (finding.severity ?? "finding").toUpperCase() + " · " + (finding.title ?? "Untitled finding")),
        document.createTextNode(" — " + (finding.recommendation ?? "Review the evidence."))
      );
      list.append(item);
    }
    resultPanel.append(list);
  } else {
    resultPanel.append(element("p", "result-list", "No findings were recorded for this assessed scope. This is not proof that the property is free of issues."));
  }
  const note = element("p", "form-status", "Evidence ID: " + (report.evidence?.id ?? "not available") + ". This response is a scoped assessment, not a universal visibility score.");
  resultPanel.append(note);
  resultPanel.hidden = false;
}

if (form) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const source = form.elements.source.value.trim();
    const contentType = form.elements.contentType.value;
    const content = form.elements.content.value;
    resultPanel.hidden = true;
    resultPanel.replaceChildren();
    status.className = "form-status";
    if (!content.trim()) {
      status.textContent = "Paste a document before starting the assessment.";
      status.classList.add("error");
      return;
    }
    submit.disabled = true;
    submit.textContent = "Analyzing…";
    status.textContent = "Running the deterministic assessment. No external AI provider is called.";
    try {
      const response = await fetch("/api/v1/assessments", {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({ source: source || "user-supplied-document", contentType, content })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "The assessment could not be completed.");
      }
      renderAssessment(payload);
      status.textContent = "Assessment complete. Review the findings and their stated limitations.";
      status.classList.add("success");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "A network error prevented the assessment.";
      status.classList.add("error");
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Analyze document <span aria-hidden="true">↗</span>';
    }
  });
}
