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

test("CLI accepts local Markdown documentation files and avoids leaking local paths", async () => {
  const dir = await mkdtemp(join(tmpdir(),"searqon-"));
  try {
    const input = join(dir,"docs.md");
    await writeFile(input,"# API\n\nAuthentication uses bearer tokens.");
    const result = spawnSync(process.execPath,[cli.pathname,"scan",input],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.assessments.AgEO.status,"findings_detected");
    assert.equal(report.evidence.source,"docs.md");
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("CLI writes reports without overwriting existing files", async () => {
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


test("CLI requires an explicit authorized-target attestation before remote scanning", () => {
  const result = spawnSync(process.execPath,[cli.pathname,"scan-url","https://example.com"],{encoding:"utf8"});
  assert.equal(result.status,1);
  assert.match(result.stderr,/--confirm-authorized-target/);
});

test("CLI remote scan validates the target before any network acquisition", () => {
  const result = spawnSync(process.execPath,[cli.pathname,"scan-url","http://127.0.0.1/admin","--confirm-authorized-target"],{encoding:"utf8"});
  assert.equal(result.status,1);
  assert.match(result.stderr,/non-public/);
});


test("CLI rejects non-public redirect authorization origins before network access", () => {
  const result = spawnSync(process.execPath,[cli.pathname,"scan-url","https://example.com/docs","--confirm-authorized-target","--allow-redirect-origin","http://127.0.0.1"],{encoding:"utf8"});
  assert.equal(result.status,1);
  assert.match(result.stderr,/non-public/);
});

test("CLI requires a value for every redirect-origin authorization option", () => {
  const result = spawnSync(process.execPath,[cli.pathname,"scan-url","https://example.com/docs","--confirm-authorized-target","--allow-redirect-origin"],{encoding:"utf8"});
  assert.equal(result.status,1);
  assert.match(result.stderr,/--allow-redirect-origin requires an origin/);
});


test("CLI creates a Brand Truth Registry, prompt cohort and bounded GEO sampling plan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "searqon-geo-"));
  try {
    const registryInput = join(dir, "registry-input.json");
    const registryFile = join(dir, "registry.json");
    const cohortInput = join(dir, "cohort-input.json");
    const cohortFile = join(dir, "cohort.json");
    const planInput = join(dir, "plan-input.json");
    const planFile = join(dir, "plan.json");
    await writeFile(registryInput, JSON.stringify({
      brandName: "Searqon", primaryDomain: "searqon.com", assertedBy: "founder",
      createdAt: "2026-11-16T12:00:00.000Z",
      facts: [{ attribute: "product.category", value: "AI-search intelligence", statement: "Searqon is an AI-search intelligence platform.", status: "owner_asserted" }]
    }));
    let result = spawnSync(process.execPath, [cli.pathname, "geo", "registry", registryInput, "--out", registryFile], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const registry = JSON.parse(await readFile(registryFile, "utf8"));
    assert.equal(registry.type, "brand_truth_registry");

    await writeFile(cohortInput, JSON.stringify({
      registry, locale: "en-CA", market: "CA", createdAt: "2026-11-16T12:00:00.000Z",
      prompts: [{ prompt: "Best AI search tools?", intent: "commercial", journeyStage: "consideration" }]
    }));
    result = spawnSync(process.execPath, [cli.pathname, "geo", "cohort", cohortInput, "--out", cohortFile], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const cohort = JSON.parse(await readFile(cohortFile, "utf8"));
    assert.equal(cohort.type, "geo_prompt_cohort");

    await writeFile(planInput, JSON.stringify({
      cohort, sampleCount: 1, costCapUsd: 0.25, createdAt: "2026-11-16T12:00:00.000Z",
      providers: [{ name: "Consumer manual capture", observationClass: "consumer_observation", collectionMode: "manual_capture", policyReview: { status: "approved", reviewedAt: "2026-11-16T11:00:00.000Z", reviewerId: "reviewer", sourceUrl: "https://provider.example.com/terms" }, estimatedCostPerSampleUsd: 0.1, maxSamples: 1 }]
    }));
    result = spawnSync(process.execPath, [cli.pathname, "geo", "plan", planInput, "--out", planFile], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(await readFile(planFile, "utf8"));
    assert.equal(plan.type, "geo_sampling_plan");
    assert.equal(plan.tasks.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
