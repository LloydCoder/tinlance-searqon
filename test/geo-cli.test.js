import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cli = new URL("../src/cli.js", import.meta.url);
const observation = {
  prompt:"Recommend a payments API.",
  answer:"Acme provides a payments API.",
  brand:"Acme",
  targetDomain:"acme.example",
  citations:["https://docs.acme.example/"],
  provider:{name:"Example Search UI",observationClass:"consumer_observation",region:"US",locale:"en-US"},
  sampledAt:"2026-11-14T12:00:00.000Z"
};

test("CLI analyzes a local GEO observation JSON file", async () => {
  const dir=await mkdtemp(join(tmpdir(),"searqon-"));
  try {
    const file=join(dir,"observation.json");
    await writeFile(file,JSON.stringify(observation));
    const result=spawnSync(process.execPath,[cli.pathname,"geo","analyze",file],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.type,"geo_observation");
    assert.equal(report.mentioned,true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("CLI aggregates local GEO observation JSON arrays", async () => {
  const dir=await mkdtemp(join(tmpdir(),"searqon-"));
  try {
    const file=join(dir,"observations.json");
    await writeFile(file,JSON.stringify([observation,{...observation,answer:"No reference."}]));
    const result=spawnSync(process.execPath,[cli.pathname,"geo","aggregate",file],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
    const groups=JSON.parse(result.stdout);
    assert.equal(groups[0].sampleSize,2);
    assert.equal(groups[0].mentionRate,0.5);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("CLI rejects malformed GEO JSON and unknown GEO commands", async () => {
  const dir=await mkdtemp(join(tmpdir(),"searqon-"));
  try {
    const file=join(dir,"bad.json");
    await writeFile(file,"{");
    const malformed=spawnSync(process.execPath,[cli.pathname,"geo","analyze",file],{encoding:"utf8"});
    assert.equal(malformed.status,1);
    assert.match(malformed.stderr,/valid JSON/i);
    const unknown=spawnSync(process.execPath,[cli.pathname,"geo","unknown",file],{encoding:"utf8"});
    assert.equal(unknown.status,2);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
