import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scanPublicUrl } from "../src/remote-scan.js";

test("remote scan result schema publishes all stable scanner outcomes", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/remote-scan-result.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.properties.status.enum, [
    "scanned",
    "robots_unreachable",
    "blocked_by_robots",
    "fetch_failed",
    "unsupported_content_type",
    "analysis_failed"
  ]);
  for (const key of ["schemaVersion", "status", "target"]) assert.ok(schema.required.includes(key));
  assert.equal(schema.properties.assessment.$ref, "assessment-report.schema.json");
  assert.equal(schema.additionalProperties, false);
});

test("runtime remote scan results expose the documented base fields", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/remote-scan-result.schema.json", import.meta.url), "utf8"));
  const result = await scanPublicUrl("https://example.com/docs", {
    robotsLoader: async () => ({ outcome: "available", policy: { groups: [], sitemaps: [] } }),
    fetcher: async url => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<title>Docs</title>"),
      finalUrl: url,
      redirects: 0
    })
  });
  for (const key of schema.required) assert.ok(Object.hasOwn(result, key), "missing remote result field " + key);
  assert.equal(result.status, "scanned");
  assert.equal(result.assessment.schemaVersion, "1.0.0");
});
