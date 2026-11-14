import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cli = new URL("../src/cli.js", import.meta.url);

test("CLI scans a caller-selected local HTML file and emits parseable JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(),"searqon-"));
  try {
    const input = join(dir,"page.html");
    await writeFile(input,"<html><head><title>Test</title></head><body><h1>Test</h1></body></html>");
    const result = spawnSync(process.execPath,[cli.pathname,"scan",input,"--source","fixture"],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).evidence.source,"fixture");
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("CLI accepts local Markdown documentation files", async () => {\n  const dir = await mkdtemp(join(tmpdir(),"searqon-"));\n  try {\n    const input = join(dir,"docs.md");\n    await writeFile(input,"# API\\n\\nAuthentication uses bearer tokens.");\n    const result = spawnSync(process.execPath,[cli.pathname,"scan",input],{encoding:"utf8"});\n    assert.equal(result.status,0,result.stderr);\n    assert.equal(JSON.parse(result.stdout).assessments.AgEO.status,"findings_detected");\n  } finally { await rm(dir,{recursive:true,force:true}); }\n});\n\ntest("CLI writes reports without overwriting existing files", async () => {
  const dir = await mkdtemp(join(tmpdir(),"searqon-"));
  try {
    const input = join(dir,"page.html");
    const output = join(dir,"report.json");
    await writeFile(input,"<title>Test</title>");
    const first = spawnSync(process.execPath,[cli.pathname,"scan",input,"--out",output],{encoding:"utf8"});
    assert.equal(first.status,0,first.stderr);
    assert.equal(JSON.parse(await readFile(output,"utf8")).schemaVersion,"1.0.0");
    const second = spawnSync(process.execPath,[cli.pathname,"scan",input,"--out",output],{encoding:"utf8"});
    assert.equal(second.status,1);
    assert.match(second.stderr,/already exists/i);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("CLI rejects unsupported extensions and invalid invocations", () => {
  const invalid = spawnSync(process.execPath,[cli.pathname],{encoding:"utf8"});
  assert.equal(invalid.status,2);
  assert.match(invalid.stderr,/Usage:/);
  const unsupported = spawnSync(process.execPath,[cli.pathname,"scan","/tmp/file.txt"],{encoding:"utf8"});
  assert.equal(unsupported.status,1);
  assert.match(unsupported.stderr,/Only local/);
});
