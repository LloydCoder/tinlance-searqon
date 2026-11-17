import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withUserTransaction } from "../src/platform/database.js";
import { createGeoAlertStore } from "../src/platform/geo-alert-store.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

function comparison({suffix,baselineId,currentId,baselineAt,currentAt,evaluatedAt,alertId}) {
  return {
    report:{
      schemaVersion:"1.0.0",type:"geo_alert_report",
      baselineId,currentId,baselineAt,currentAt,evaluatedAt,
      policy:{cooldownSeconds:3600},
      alerts:[{
        alertId,dedupeKey:"a".repeat(64),type:"mention_change",metric:"mention",
        direction:"decline",severity:"high",baselineId,currentId,baselineAt,currentAt,evaluatedAt,
        delta:-0.2,absoluteChange:0.2
      }]
    },
    baseline:[{cohort:"provider-a/en-US",sampleSize:30,mentionCount:12,suffix:"baseline"}],
    current:[{cohort:"provider-a/en-US",sampleSize:30,mentionCount:5,suffix}]
  };
}

test("GEO alert snapshots, events and cooldowns persist idempotently under tenant RLS", { skip: !disposable }, async () => {
  const owner = new Pool({connectionString:databaseUrl});
  const runtime = new Pool({connectionString:process.env.SEARQON_RUNTIME_DATABASE_URL,max:4});
  const userA = randomUUID();
  const userB = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const email = id => id+"@geo-alert-store.example.test";
  const firstClock = new Date("2026-11-17T12:01:00.000Z");
  const store = createGeoAlertStore({database:{pool:runtime},now:()=>firstClock});
  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Alert A'),($3,$4,'Alert B')",
      [userA,email(userA),userB,email(userB)]
    );
    await owner.query(
      "INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Alert A',$2),($3,'Alert B',$4)",
      [orgA,"geo-alert-"+userA.replaceAll("-",""),orgB,"geo-alert-"+userB.replaceAll("-","")]
    );
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner')",
      [orgA,userA,orgB,userB]
    );

    const firstInput = comparison({
      suffix:"one",baselineId:"baseline-1",currentId:"current-1",
      baselineAt:"2026-11-01T00:00:00.000Z",currentAt:"2026-11-17T00:00:00.000Z",
      evaluatedAt:"2026-11-17T12:00:00.000Z",alertId:"geoalert_first"
    });
    const first = await store.recordComparison(userA,orgA,firstInput);
    assert.equal(first.summary.emitted,1);
    assert.equal(first.summary.suppressed,0);
    assert.equal(first.events[0].state,"emitted");
    assert.equal(first.baselineSnapshot.idempotentReplay,false);

    const replay = await store.recordComparison(userA,orgA,firstInput);
    assert.equal(replay.summary.idempotentReplays,1);
    assert.equal(replay.events[0].eventId,first.events[0].eventId);
    await assert.rejects(
      store.recordComparison(userA,orgA,{...firstInput,baseline:[{cohort:"tampered",sampleSize:30,mentionCount:12}]}),
      error => error.code === "snapshot_id_conflict"
    );
    await assert.rejects(
      store.recordComparison(userA,orgA,{
        ...firstInput,
        report:{...firstInput.report,alerts:[{...firstInput.report.alerts[0],delta:-0.3}]}
      }),
      error => error.code === "alert_id_conflict"
    );

    const duringCooldown = comparison({
      suffix:"two",baselineId:"baseline-1",currentId:"current-2",
      baselineAt:"2026-11-01T00:00:00.000Z",currentAt:"2026-11-17T12:01:30.000Z",
      evaluatedAt:"2026-11-17T12:02:00.000Z",alertId:"geoalert_cooldown"
    });
    const suppressed = await store.recordComparison(userA,orgA,duringCooldown);
    assert.equal(suppressed.summary.suppressed,1);
    assert.equal(suppressed.events[0].suppressionReason,"cooldown_active");

    const afterCooldownStore = createGeoAlertStore({
      database:{pool:runtime},now:()=>new Date("2026-11-17T14:00:00.000Z")
    });
    const outOfOrder = comparison({
      suffix:"old",baselineId:"baseline-old",currentId:"current-old",
      baselineAt:"2026-11-17T09:00:00.000Z",currentAt:"2026-11-17T10:00:00.000Z",
      evaluatedAt:"2026-11-17T11:00:00.000Z",alertId:"geoalert_out_of_order"
    });
    const stale = await afterCooldownStore.recordComparison(userA,orgA,outOfOrder);
    assert.equal(stale.summary.suppressed,1);
    assert.equal(stale.events[0].suppressionReason,"out_of_order_evaluation");

    const later = comparison({
      suffix:"later",baselineId:"baseline-later",currentId:"current-later",
      baselineAt:"2026-11-17T14:00:00.000Z",currentAt:"2026-11-17T14:05:00.000Z",
      evaluatedAt:"2026-11-17T14:06:00.000Z",alertId:"geoalert_later"
    });
    const laterStore = createGeoAlertStore({
      database:{pool:runtime},now:()=>new Date("2026-11-17T14:10:00.000Z")
    });
    const emittedAgain = await laterStore.recordComparison(userA,orgA,later);
    assert.equal(emittedAgain.summary.emitted,1);

    const concurrent = comparison({
      suffix:"concurrent",baselineId:"baseline-concurrent",currentId:"current-concurrent",
      baselineAt:"2026-11-17T15:11:00.000Z",currentAt:"2026-11-17T15:12:00.000Z",
      evaluatedAt:"2026-11-17T15:13:00.000Z",alertId:"geoalert_concurrent"
    });
    const concurrentStore = createGeoAlertStore({
      database:{pool:runtime},now:()=>new Date("2026-11-17T15:14:00.000Z")
    });
    const concurrentResults = await Promise.all([
      concurrentStore.recordComparison(userA,orgA,concurrent),
      concurrentStore.recordComparison(userA,orgA,concurrent)
    ]);
    assert.equal(concurrentResults.reduce((sum,result)=>sum+result.summary.emitted,0),1);
    assert.equal(concurrentResults.reduce((sum,result)=>sum+result.summary.idempotentReplays,0),1);

    const hidden = await withUserTransaction(runtime,userB,client => client.query(
      "SELECT id FROM searqon.geo_alert_events WHERE organization_id=$1",[orgA]
    ));
    assert.equal(hidden.rows.length,0);
    await assert.rejects(
      withUserTransaction(runtime,userA,client => client.query(
        "UPDATE searqon.geo_alert_events SET state='suppressed' WHERE id=$1",[first.events[0].id]
      )),
      error => error.code === "42501"
    );
    await assert.rejects(
      owner.query("UPDATE searqon.geo_alert_events SET state='suppressed' WHERE id=$1",[first.events[0].id]),
      error => error.code === "55000"
    );
    await assert.rejects(
      owner.query("DELETE FROM searqon.geo_alert_snapshots WHERE organization_id=$1 AND snapshot_id='baseline-1'",[orgA]),
      error => error.code === "55000"
    );
    const cooldown = await owner.query(
      "SELECT last_evaluated_at,cooldown_until FROM searqon.geo_alert_cooldowns WHERE organization_id=$1 AND dedupe_key=$2",
      [orgA,"a".repeat(64)]
    );
    assert.equal(new Date(cooldown.rows[0].last_evaluated_at).toISOString(),"2026-11-17T15:13:00.000Z");
    assert.equal(new Date(cooldown.rows[0].cooldown_until).toISOString(),"2026-11-17T16:14:00.000Z");
    const eventCounts = await owner.query(
      "SELECT state,count(*)::int AS count FROM searqon.geo_alert_events WHERE organization_id=$1 GROUP BY state ORDER BY state",
      [orgA]
    );
    assert.deepEqual(eventCounts.rows.map(row=>[row.state,row.count]),[["emitted",3],["suppressed",2]]);
  } finally {
    await runtime.end();
    await owner.end();
  }
});
