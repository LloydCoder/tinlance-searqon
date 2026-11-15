import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("report CLI converts a JSON assessment into a standalone HTML file without overwriting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "searqon-report-"));
  const input = join(directory, "assessment.json");
  const output = join(directory, "assessment.html");
  const cli = resolve("src/cli.js");
  try {
    const scan = spawnSync(process.execPath, [cli, "scan", "examples/openapi.json", "--out", input], { encoding: "utf8" });
    assert.equal(scan.status, 0, scan.stderr);
    const rendered = spawnSync(process.execPath, [cli, "report", input, "--out", output], { encoding: "utf8" });
    assert.equal(rendered.status, 0, rendered.stderr);
    const html = await readFile(output, "utf8");
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /Discipline coverage and limitations/);
    const second = spawnSync(process.execPath, [cli, "report", input, "--out", output], { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /EEXIST/);
    assert.equal(await readFile(output, "utf8"), html);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
