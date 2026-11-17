import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createWorkspaceService } from "../src/platform/workspaces.js";
import { createGeoObservationService } from "../src/platform/geo-observations.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("caller-supplied GEO observations are immutable, tenant-scoped, integrity-checked and quota metered", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const database = { pool: new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl, max: 2 }) };
  const workspace = createWorkspaceService({ database });
  const service = createGeoObservationService({ database });
  const userA = randomUUID();
  const userB = randomUUID();
  const viewer = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const slug = () => "geo-observation-" + randomUUID().replaceAll("-","").slice(0,18);
  const email = id => id + "@geo-observation.example.test";
  const input = key => ({
    idempotencyKey:key,
    prompt:"Which tools help teams improve answer-engine visibility?",
    answer:"Searqon helps teams analyze answer-engine visibility and verify citations.",
    brand:"Searqon",
    targetDomain:"example.com",
    provider:{
      name:"ChatGPT",
      observationClass:"consumer_observation",
      model:"reported-by-submitter",
      region:"global",
      locale:"en"
    },
    citations:["https://example.com/docs","https://example.org/research"],
    sampledAt:new Date().toISOString()
  });

  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'GEO Owner A'),($3,$4,'GEO Owner B'),($5,$6,'GEO Viewer')",
      [userA,email(userA),userB,email(userB),viewer,email(viewer)]
    );
    await owner.query(
      "INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'GEO Org A',$2),($3,'GEO Org B',$4)",
      [orgA,slug(),orgB,slug()]
    );
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'viewer')",
      [orgA,userA,orgB,userB,viewer]
    );
    await owner.query(
      `INSERT INTO searqon.subscriptions
        (organization_id,provider,provider_customer_id,provider_subscription_id,status,plan,billing_interval,current_period_start,current_period_end)
       VALUES
        ($1,'manual','geo-customer-a','geo-subscription-a','active','growth','month','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z'),
        ($2,'manual','geo-customer-b','geo-subscription-b','active','free','month','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')`,
      [orgA,orgB]
    );
    const projectA = await workspace.createProject(userA,{organizationId:orgA,name:"GEO Project A",targetUrl:"https://example.com"});
    const projectB = await workspace.createProject(userB,{organizationId:orgB,name:"GEO Project B",targetUrl:"https://example.net"});

    const originalInput = input(["geo","observation","0001"].join("-"));
    const submitted = await service.submit(userA,projectA.id,originalInput);
    assert.equal(submitted.idempotentReplay,false);
    assert.equal(submitted.observation.observationClass,"consumer_observation");
    assert.equal(submitted.observation.mentioned,true);
    assert.equal(submitted.observation.brandCited,true);
    assert.match(submitted.observation.evidence.sha256,/^[a-f0-9]{64}$/);

    const replay = await service.submit(userA,projectA.id,originalInput);
    assert.equal(replay.idempotentReplay,true);
    assert.equal(replay.observation.id,submitted.observation.id);
    const duplicateEvidence = await service.submit(userA,projectA.id,{...originalInput,idempotencyKey:["geo","observation","0002"].join("-")});
    assert.equal(duplicateEvidence.deduplicated,true);
    assert.equal(duplicateEvidence.usage,null);
    await assert.rejects(
      service.submit(userA,projectA.id,{...originalInput,answer:"Different answer for the same idempotency key."}),
      error => error.code === "idempotency_key_conflict"
    );

    const listed = await service.list(viewer,projectA.id);
    assert.equal(listed.length,1);
    assert.equal(listed[0].id,submitted.observation.id);
    const aggregate = await service.aggregate(viewer,projectA.id);
    assert.equal(aggregate.length,1);
    assert.equal(aggregate[0].observationClass,"consumer_observation");
    assert.equal(aggregate[0].provider.name,"ChatGPT");

    const evidence = await service.getEvidence(viewer,submitted.observation.id);
    assert.equal(evidence.integrity.valid,true);
    assert.equal(evidence.rawPayload.answer,input(["geo","observation","0001"].join("-")).answer);
    await assert.rejects(service.submit(viewer,projectA.id,input("geo-viewer-0001")),error=>error.code==="insufficient_role");
    await assert.rejects(service.list(userB,projectA.id),error=>error.code==="project_not_found");
    await assert.rejects(service.getEvidence(userB,submitted.observation.id),error=>error.code==="observation_not_found");

    const usage = await owner.query(
      "SELECT consumed_units FROM searqon.usage_period_counters WHERE organization_id=$1 AND meter='supplied_geo_observations'",
      [orgA]
    );
    assert.equal(Number(usage.rows[0].consumed_units),1);

    for (let index=1;index<=10;index++) {
      const freeObservation = input(["geo","free","observation",String(index).padStart(4,"0")].join("-"));
      freeObservation.sampledAt = new Date(Date.now() + index * 1000).toISOString();
      await service.submit(userB,projectB.id,freeObservation);
    }
    await assert.rejects(
      service.submit(userB,projectB.id,input("geo-free-observation-0011")),
      error => error.code === "included_allowance_exhausted"
    );

    await assert.rejects(
      owner.query("UPDATE searqon.geo_observations SET mentioned=false WHERE id=$1",[submitted.observation.id]),
      /immutable evidence records/
    );
  } finally {
    await database.pool.end();
    await owner.end();
  }
});
