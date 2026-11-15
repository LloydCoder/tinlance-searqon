import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("MCP snapshot schema and example expose the 2026-07-28 import contract", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/mcp-snapshot.schema.json", import.meta.url), "utf8"));
  const example = JSON.parse(await readFile(new URL("../examples/mcp-snapshot.json", import.meta.url), "utf8"));
  assert.match(schema.$id, /1\.1\.0\.json$/);
  assert.deepEqual(schema.properties.toolsListMetadata.required, ["resultType", "ttlMs", "cacheScope"]);
  assert.equal(schema.properties.toolsListMetadata.properties.cacheScope.enum.includes("private"), true);
  assert.equal(schema.properties._meta.properties["io.modelcontextprotocol/protocolVersion"].type, "string");
  assert.equal(schema.properties.tools.items.properties.name.pattern, "^[A-Za-z0-9_.-]+$");
  assert.equal(example._meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
  assert.deepEqual(example.toolsListMetadata, { resultType: "complete", ttlMs: 60000, cacheScope: "public" });
});
