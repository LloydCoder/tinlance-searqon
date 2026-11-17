import test from "node:test";
import assert from "node:assert/strict";
import { createGeoAlertStore, GeoAlertStoreError } from "../src/platform/geo-alert-store.js";

function fixture() {
  let connects = 0;
  const pool = { async connect() { connects += 1; throw new Error("database should not be reached"); } };
  return { store:createGeoAlertStore({database:{pool}}), connects:()=>connects };
}

const userId = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000001";
const baseline = [{cohort:"provider-a/en-US",sampleSize:30,mentionCount:12}];
const current = [{cohort:"provider-a/en-US",sampleSize:30,mentionCount:5}];
const report = {
  schemaVersion:"1.0.0", type:"geo_alert_report",
  baselineId:"baseline-2026-11-01", currentId:"current-2026-11-17",
  baselineAt:"2026-11-01T00:00:00.000Z", currentAt:"2026-11-17T00:00:00.000Z",
  evaluatedAt:"2026-11-17T12:00:00.000Z",
  policy:{cooldownSeconds:3600},
  alerts:[{
    alertId:"geoalert_abc123",dedupeKey:"a".repeat(64),type:"mention_change",
    metric:"mention",direction:"decline",severity:"high",
    baselineId:"baseline-2026-11-01",currentId:"current-2026-11-17",
    baselineAt:"2026-11-01T00:00:00.000Z",currentAt:"2026-11-17T00:00:00.000Z",
    evaluatedAt:"2026-11-17T12:00:00.000Z",delta:-0.2
  }]
};

test("geo alert store requires a PostgreSQL database pool", () => {
  assert.throws(() => createGeoAlertStore(), /PostgreSQL database pool/);
  assert.throws(() => createGeoAlertStore({database:{pool:{}}}), /PostgreSQL database pool/);
});

test("comparison validation rejects invalid tenant, snapshots, policy and alert identity before database access", async () => {
  const {store,connects} = fixture();
  await assert.rejects(store.recordComparison("bad-user",organizationId,{report,baseline,current}),
    error => error instanceof GeoAlertStoreError && error.code === "invalid_user_id");
  await assert.rejects(store.recordComparison(userId,organizationId,{report:{...report,baselineId:""},baseline,current}),
    error => error instanceof GeoAlertStoreError && error.code === "invalid_snapshot_id");
  await assert.rejects(store.recordComparison(userId,organizationId,{report:{...report,policy:{cooldownSeconds:-1}},baseline,current}),
    error => error instanceof GeoAlertStoreError && error.code === "invalid_cooldown");
  await assert.rejects(store.recordComparison(userId,organizationId,{report:{...report,alerts:[{...report.alerts[0],dedupeKey:"bad"}]},baseline,current}),
    error => error instanceof GeoAlertStoreError && error.code === "invalid_dedupe_key");
  await assert.rejects(store.recordComparison(userId,organizationId,{report,baseline:[...baseline,...Array(2000).fill(baseline[0])],current}),
    error => error instanceof GeoAlertStoreError && error.code === "too_many_cohorts");
  assert.equal(connects(),0);
});

test("comparison validation binds every alert to the report snapshots and bounds JSON payloads", async () => {
  const {store,connects} = fixture();
  await assert.rejects(store.recordComparison(userId,organizationId,{
    report:{...report,alerts:[{...report.alerts[0],currentId:"different-snapshot"}]},baseline,current
  }), error => error.code === "snapshot_reference_mismatch");
  await assert.rejects(store.recordComparison(userId,organizationId,{
    report,baseline:[{cohort:"x",data:"x".repeat(5*1024*1024)}],current
  }), error => error.code === "snapshot_too_large");
  assert.equal(connects(),0);
});
