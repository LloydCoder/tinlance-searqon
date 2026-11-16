import { createHash } from "node:crypto";
import { analyzeDocument } from "./analyzer.js";

const COMPILER_VERSION = "agent-artifact-compiler-2026-11-16.1";
const MAX_SOURCES = 100;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_ID = 96;
const MAX_DIFF_LINES = 500;
const MAX_DIFF_FILES = 20;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function text(value, field, max = 512) {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(field + " must be a non-empty string of at most " + max + " characters");
  }
  return value.trim().normalize("NFKC");
}

function safeRelativePath(value, field = "path") {
  const path = text(value, field, 240);
  if (path.startsWith("/") || path.startsWith("\\") || path.includes("\\") || /^[A-Za-z]:/.test(path) ||
      /[?#%]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new TypeError(field + " must be a safe relative path without traversal or hidden path segments");
  }
  return path;
}

function normalizeMarkdown(content) {
  return content.replace(/\r\n?/g, "\n").split("\n").map(line => line.replace(/[ \t]+$/g, "")).join("\n").replace(/^\n+|\n+$/g, "") + "\n";
}

function canonicalize(value, depth = 0) {
  if (depth > 64) throw new RangeError("OpenAPI JSON nesting exceeds the compiler limit");
  if (Array.isArray(value)) return value.map(item => canonicalize(item, depth + 1));
  if (value && typeof value === "object") {
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key], depth + 1);
    return output;
  }
  return value;
}

function normalizeOpenApi(content) {
  let document;
  try { document = JSON.parse(content); }
  catch { throw new TypeError("OpenAPI source must contain valid JSON"); }
  if (!document || typeof document !== "object" || Array.isArray(document) ||
      typeof document.openapi !== "string" || !/^3\.(1|2)\.\d+$/.test(document.openapi) ||
      !document.info || typeof document.info !== "object" || Array.isArray(document.info) ||
      typeof document.info.title !== "string" || !document.info.title.trim() ||
      typeof document.info.version !== "string" || !document.info.version.trim() ||
      !document.paths || typeof document.paths !== "object" || Array.isArray(document.paths)) {
    throw new TypeError("Source must be a valid OpenAPI 3.1 or 3.2 document with info and paths");
  }
  return JSON.stringify(canonicalize(document), null, 2) + "\n";
}

function diffLines(path, before, after) {
  const a = before.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const b = after.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return "--- a/" + path + "\n+++ b/" + path + "\n@@ diff omitted: line limit exceeded @@\n";
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const operations = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      operations.push(" " + a[i]); i++; j++;
    } else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) {
      operations.push("+" + b[j]); j++;
    } else {
      operations.push("-" + a[i]); i++;
    }
  }
  return "--- a/" + path + "\n+++ b/" + path + "\n@@\n" + operations.join("\n") + "\n";
}

function normalizeSource(source, index) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError("sources[" + index + "] must be an object");
  const sourceId = text(source.sourceId, "sources[" + index + "].sourceId", MAX_SOURCE_ID);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sourceId)) throw new TypeError("sourceId must be a stable identifier");
  const path = safeRelativePath(source.path, "sources[" + index + "].path");
  if (!["markdown", "openapi"].includes(source.kind)) throw new TypeError("kind must be markdown or openapi");
  if (typeof source.content !== "string") throw new TypeError("sources[" + index + "].content must be a string");
  return { sourceId, path, kind: source.kind, originalContent: source.content };
}

function compileSource(source) {
  const content = source.kind === "markdown" ? normalizeMarkdown(source.originalContent) : normalizeOpenApi(source.originalContent);
  const contentType = source.kind === "markdown" ? "text/markdown" : "application/json";
  const quality = analyzeDocument({
    source: source.path,
    contentType,
    content,
    acquisitionMethod: "local_file",
    observationClass: "first_party"
  });
  return Object.freeze({
    path: source.path,
    kind: source.kind,
    mediaType: contentType,
    content,
    sha256: sha256(content),
    provenance: Object.freeze({
      sourceId: source.sourceId,
      sourcePath: source.path,
      sourceKind: source.kind,
      sourceSha256: sha256(source.originalContent),
      evidenceId: quality.evidence.id,
      methodologyVersion: quality.rulesVersion
    }),
    quality: Object.freeze({
      summary: quality.summary,
      observations: quality.observations,
      assessments: quality.assessments,
      findings: quality.findings
    })
  });
}

function buildLlmsArtifact(options, sources) {
  const productName = text(options.productName, "options.productName", 120);
  const summary = text(options.summary, "options.summary", 1_000);
  const available = new Map(sources.map(source => [source.path, source]));
  const links = options.links === undefined
    ? sources.map(source => ({ label: source.path, path: source.path }))
    : options.links;
  if (!Array.isArray(links) || links.length > MAX_SOURCES) throw new TypeError("options.links must be a bounded array");
  const lines = ["# " + productName, "", "> " + summary, "", "## Documentation"];
  const seen = new Set();
  for (const [index, link] of links.entries()) {
    if (!link || typeof link !== "object" || Array.isArray(link)) throw new TypeError("options.links[" + index + "] must be an object");
    const path = safeRelativePath(link.path, "options.links[" + index + "].path");
    if (!available.has(path)) throw new TypeError("llms.txt links must reference compiled source paths");
    if (seen.has(path)) throw new TypeError("llms.txt links must be unique");
    seen.add(path);
    const label = text(link.label, "options.links[" + index + "].label", 160).replace(/[\[\]]/g, "");
    lines.push("- [" + label + "](" + path + ")");
  }
  return lines.join("\n") + "\n";
}

function buildChanges(artifacts, previousArtifacts) {
  let diffBudget = MAX_DIFF_FILES;
  const previous = new Map();
  if (!Array.isArray(previousArtifacts) || previousArtifacts.length > MAX_SOURCES) {
    throw new TypeError("previousArtifacts must be an array of at most " + MAX_SOURCES + " items");
  }
  for (const [index, item] of previousArtifacts.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.content !== "string") {
      throw new TypeError("previousArtifacts[" + index + "] must contain path and string content");
    }
    const path = safeRelativePath(item.path, "previousArtifacts[" + index + "].path");
    if (previous.has(path)) throw new TypeError("previous artifact paths must be unique");
    previous.set(path, item.content);
  }
  const changes = [];
  const currentPaths = new Set();
  for (const artifact of artifacts) {
    currentPaths.add(artifact.path);
    if (!previous.has(artifact.path)) {
      changes.push(Object.freeze({ path: artifact.path, status: "added", beforeSha256: null, afterSha256: artifact.sha256, unifiedDiff: diffBudget-- > 0 ? diffLines(artifact.path, "", artifact.content) : "--- a/" + artifact.path + "\\n+++ b/" + artifact.path + "\\n@@ diff omitted: compilation diff budget exceeded @@\\n", applied: false }));
      continue;
    }
    const before = previous.get(artifact.path);
    const beforeSha256 = sha256(before);
    if (beforeSha256 === artifact.sha256) {
      changes.push(Object.freeze({ path: artifact.path, status: "unchanged", beforeSha256, afterSha256: artifact.sha256, unifiedDiff: "", applied: false }));
    } else {
      changes.push(Object.freeze({ path: artifact.path, status: "modified", beforeSha256, afterSha256: artifact.sha256, unifiedDiff: diffBudget-- > 0 ? diffLines(artifact.path, before, artifact.content) : "--- a/" + artifact.path + "\\n+++ b/" + artifact.path + "\\n@@ diff omitted: compilation diff budget exceeded @@\\n", applied: false }));
    }
  }
  for (const [path, before] of previous) {
    if (!currentPaths.has(path)) {
      changes.push(Object.freeze({ path, status: "removed", beforeSha256: sha256(before), afterSha256: null, unifiedDiff: diffBudget-- > 0 ? diffLines(path, before, "") : "--- a/" + path + "\\n+++ b/" + path + "\\n@@ diff omitted: compilation diff budget exceeded @@\\n", applied: false }));
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Compile supplied Markdown/OpenAPI sources into deterministic, provenance-linked
 * artifacts. It never reads the filesystem, writes files, changes repositories,
 * creates branches, opens PRs, merges, or publishes generated content.
 */
export function compileAgentArtifacts(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("artifact compiler input is required");
  if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.length > MAX_SOURCES) {
    throw new TypeError("sources must contain between 1 and " + MAX_SOURCES + " entries");
  }
  const sources = input.sources.map(normalizeSource);
  const sourceBytes = sources.reduce((sum, source) => sum + Buffer.byteLength(source.originalContent, "utf8"), 0);
  if (sourceBytes > MAX_TOTAL_BYTES) throw new RangeError("Combined source content exceeds the 2 MiB compiler limit");
  const paths = new Set();
  const sourceIds = new Set();
  for (const source of sources) {
    if (paths.has(source.path)) throw new TypeError("duplicate artifact path: " + source.path);
    if (sourceIds.has(source.sourceId)) throw new TypeError("duplicate sourceId: " + source.sourceId);
    paths.add(source.path);
    sourceIds.add(source.sourceId);
  }
  const artifacts = sources.map(compileSource);
  const options = input.options ?? {};
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("options must be an object");
  if (options.includeLlmsTxt !== undefined && typeof options.includeLlmsTxt !== "boolean") throw new TypeError("includeLlmsTxt must be boolean");
  if (options.includeLlmsTxt === true) {
    if (paths.has("llms.txt")) throw new TypeError("llms.txt output path conflicts with a supplied source");
    const content = buildLlmsArtifact(options, sources);
    const evidenceSource = sources.map(source => source.path).sort().join("\n");
    artifacts.push(Object.freeze({
      path: "llms.txt",
      kind: "derived",
      mediaType: "text/plain",
      content,
      sha256: sha256(content),
      provenance: Object.freeze({
        sourceId: "derived-llms-index",
        sourcePath: null,
        sourceKind: "derived",
        sourceSha256: sha256(evidenceSource),
        evidenceId: null,
        methodologyVersion: COMPILER_VERSION
      }),
      quality: Object.freeze({ findings: [], limitations: Object.freeze(["llms.txt is an optional discovery aid; it does not force indexing, citations or model behavior."]) })
    }));
  }
  const changes = buildChanges(artifacts, input.previousArtifacts ?? []);
  return Object.freeze({
    schemaVersion: "1.0.0",
    type: "agent_artifact_compilation",
    compilerVersion: COMPILER_VERSION,
    artifacts: Object.freeze(artifacts.sort((a, b) => a.path.localeCompare(b.path))),
    changes: Object.freeze(changes),
    summary: Object.freeze({
      artifactCount: artifacts.length,
      added: changes.filter(change => change.status === "added").length,
      modified: changes.filter(change => change.status === "modified").length,
      unchanged: changes.filter(change => change.status === "unchanged").length,
      removed: changes.filter(change => change.status === "removed").length,
      patchesApplied: 0
    }),
    limitations: Object.freeze([
      "Only caller-supplied Markdown and OpenAPI JSON are compiled; no repository or network acquisition occurs.",
      "Generated artifacts and diffs are proposals. No files are written and no GitHub branch or pull request is created.",
      "OpenAPI findings reuse the passive analyzer and do not invoke API operations or agent tools.",
      "llms.txt is optional and does not guarantee indexing, citations, ranking or model behavior."
    ])
  });
}
