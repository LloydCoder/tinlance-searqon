import test from "node:test";
import assert from "node:assert/strict";
import { compileAgentArtifacts } from "../src/artifact-compiler.js";

const markdown = `# API Guide

Use bearer authentication.

## Errors

Return documented HTTP status codes.

```http
GET /v1/status
```
`;

const openapi = {
  openapi: "3.2.1",
  info: { title: "Searqon API", version: "1.0.0", description: "Read-only API for discoverability assessments." },
  servers: [{ url: "https://api.example.test" }],
  paths: {
    "/v1/status": {
      get: {
        operationId: "getStatus",
        summary: "Read service status",
        responses: { "200": { description: "Service status" } }
      }
    }
  }
};

test("compiles normalized Markdown with deterministic content digests and source provenance", () => {
  const input = { sources: [{ sourceId: "guide", path: "docs/API.md", kind: "markdown", content: "# API Guide  \r\n\r\nUse bearer authentication.  \r\n" }] };
  const first = compileAgentArtifacts(input);
  const second = compileAgentArtifacts(input);
  assert.equal(first.type, "agent_artifact_compilation");
  assert.equal(first.artifacts.length, 1);
  assert.equal(first.artifacts[0].path, "docs/API.md");
  assert.equal(first.artifacts[0].content, "# API Guide\n\nUse bearer authentication.\n");
  assert.equal(first.artifacts[0].sha256, second.artifacts[0].sha256);
  assert.equal(first.artifacts[0].provenance.sourceId, "guide");
  assert.equal(first.artifacts[0].provenance.sourcePath, "docs/API.md");
  assert.match(first.artifacts[0].provenance.sourceSha256, /^[a-f0-9]{64}$/);
});

test("normalizes OpenAPI JSON deterministically and attaches passive analyzer findings", () => {
  const report = compileAgentArtifacts({ sources: [{ sourceId: "openapi", path: "openapi.json", kind: "openapi", content: JSON.stringify(openapi, null, 4) }] });
  assert.equal(report.artifacts[0].path, "openapi.json");
  const parsed = JSON.parse(report.artifacts[0].content);
  assert.equal(parsed.openapi, "3.2.1");
  assert.equal(report.artifacts[0].provenance.evidenceId.startsWith("evidence_"), true);
  assert.ok(Array.isArray(report.artifacts[0].quality.findings));
  assert.equal(report.artifacts[0].quality.observations.operationCount, 1);
});

test("creates deterministic diff proposals without applying or writing patches", () => {
  const previous = [{ path: "docs/API.md", content: "# Old Guide\n" }];
  const report = compileAgentArtifacts({
    sources: [{ sourceId: "guide", path: "docs/API.md", kind: "markdown", content: "# New Guide\n" }],
    previousArtifacts: previous
  });
  assert.equal(report.changes.length, 1);
  assert.equal(report.changes[0].status, "modified");
  assert.match(report.changes[0].unifiedDiff, /-# Old Guide/);
  assert.match(report.changes[0].unifiedDiff, /\+# New Guide/);
  assert.equal(report.changes[0].applied, false);
});

test("adds llms.txt only when explicitly enabled and links only compiled source paths", () => {
  const sources = [{ sourceId: "guide", path: "docs/API.md", kind: "markdown", content: markdown }];
  const without = compileAgentArtifacts({ sources });
  assert.equal(without.artifacts.some(item => item.path === "llms.txt"), false);
  const withIndex = compileAgentArtifacts({
    sources,
    options: { includeLlmsTxt: true, productName: "Searqon", summary: "Evidence-first discoverability intelligence." }
  });
  const index = withIndex.artifacts.find(item => item.path === "llms.txt");
  assert.ok(index);
  assert.match(index.content, /Evidence-first discoverability intelligence/);
  assert.match(index.content, /docs\/API\.md/);
  assert.equal(index.provenance.sourceKind, "derived");
});

test("rejects path traversal, absolute paths, duplicate outputs and unsupported source kinds", () => {
  assert.throws(() => compileAgentArtifacts({ sources: [{ sourceId: "bad", path: "../secret.md", kind: "markdown", content: "x" }] }), /safe relative path/);
  assert.throws(() => compileAgentArtifacts({ sources: [{ sourceId: "bad", path: "/etc/passwd", kind: "markdown", content: "x" }] }), /safe relative path/);
  assert.throws(() => compileAgentArtifacts({ sources: [
    { sourceId: "a", path: "docs/API.md", kind: "markdown", content: "A" },
    { sourceId: "b", path: "docs/API.md", kind: "markdown", content: "B" }
  ] }), /duplicate artifact path/);
  assert.throws(() => compileAgentArtifacts({ sources: [{ sourceId: "bad", path: "docs/file.txt", kind: "pdf", content: "x" }] }), /kind must be markdown or openapi/);
});

test("rejects malformed OpenAPI, oversized inputs and malformed previous artifacts", () => {
  assert.throws(() => compileAgentArtifacts({ sources: [{ sourceId: "api", path: "openapi.json", kind: "openapi", content: "{}" }] }), /valid OpenAPI/);
  assert.throws(() => compileAgentArtifacts({ sources: [{ sourceId: "big", path: "docs/API.md", kind: "markdown", content: "x".repeat(2_097_153) }] }), /2 MiB/);
  assert.throws(() => compileAgentArtifacts({ sources: [{ sourceId: "a", path: "docs/API.md", kind: "markdown", content: "A" }], previousArtifacts: [{ path: "../escape", content: "x" }] }), /safe relative path/);
});

test("rejects unknown or unsafe llms.txt links and metadata", () => {
  assert.throws(() => compileAgentArtifacts({
    sources: [{ sourceId: "guide", path: "docs/API.md", kind: "markdown", content: markdown }],
    options: { includeLlmsTxt: true, productName: "Searqon", summary: "Summary", links: [{ label: "Private", path: "../../secrets" }] }
  }), /safe relative path/);
});

test("rejects duplicate source identities and excessively deep OpenAPI documents", () => {
  assert.throws(() => compileAgentArtifacts({ sources: [
    { sourceId: "same", path: "docs/A.md", kind: "markdown", content: "A" },
    { sourceId: "same", path: "docs/B.md", kind: "markdown", content: "B" }
  ] }), /duplicate sourceId/);
  let nested = {};
  let cursor = nested;
  for (let index = 0; index < 70; index++) { cursor.child = {}; cursor = cursor.child; }
  const document = { openapi: "3.2.1", info: { title: "API", version: "1" }, paths: {}, nested };
  assert.throws(() => compileAgentArtifacts({ sources: [{ sourceId: "deep", path: "openapi.json", kind: "openapi", content: JSON.stringify(document) }] }), /nesting exceeds/);
});

test("bounds aggregate diff generation across large artifact sets", () => {
  const sources = Array.from({ length: 22 }, (_, index) => ({
    sourceId: "doc-" + index,
    path: "docs/page-" + index + ".md",
    kind: "markdown",
    content: "# New " + index + "\n"
  }));
  const previousArtifacts = sources.map(source => ({ path: source.path, content: "# Old " + source.sourceId + "\n" }));
  const report = compileAgentArtifacts({ sources, previousArtifacts });
  assert.equal(report.changes.length, 22);
  assert.equal(report.changes.filter(change => change.unifiedDiff.includes("diff budget exceeded")).length, 2);
  assert.equal(report.summary.patchesApplied, 0);
});
