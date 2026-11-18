import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createBillingSubscriptionReconciler } from "../src/platform/billing-subscription-reconciler.js";

const databaseUrl=process.env.DATABASE_URL;
let disposable=false;
if(databaseUrl && process.env.SEARQON_TEST_DATABASE==="1") {
  try {
    const name=decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable=/(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("billing reconciliation applies provider-canonical snapshots and ignores stale event ordering", {skip:!disposable}, async()=>{
  const owner=new Pool({connectionString:databaseUrl});
  const workerPool=new Pool({connectionString:databaseUrl,max:2});
  const organizationId=randomUUID();
  const userId=randomUUID();
  const customerId="cus_"+randomUUID().replaceAll("-","").slice(0,16);
  const subscriptionId="sub_"+randomUUID().replaceAll("-","").slice(0,16);
  const currentSnapshot={
    organizationId,providerCustomerId:customerId,providerSubscriptionId:subscriptionId,
    status:"active",plan:"growth",billingInterval:"month",
    currentPeriodStart:"2026-11-01T00:00:00.000Z",currentPeriodEnd:"2026-12-01T00:00:00.000Z",
    trialEndsAt:null,cancelAtPeriodEnd:false,canceledAt:null
  };
  const adapter={
    async fetchCanonicalSubscription(event) {
      return event.providerEventId.endsWith("02")
        ? {...currentSnapshot,status:"past_due"}
        : event.providerEventId.endsWith("03")
          ? currentSnapshot
          : currentSnapshot;
    }
  };
  const reconciler=createBillingSubscriptionReconciler({workerPool,adapters:{fixture:adapter}});
  const makeEvent=(suffix,createdAt)=>({
    provider:"fixture",providerEventId:"evt_reconcile_"+suffix,eventType:"customer.subscription.updated",
    providerCreatedAt:createdAt,organizationId,payload:{providerCustomerId:customerId,providerSubscriptionId:subscriptionId}
  });

  try {
    await owner.query("INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Billing Reconcile')",
      [userId,userId+"@billing-reconcile.example.test"]);
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Billing Reconcile',$2)",
      [organizationId,"billing-reconcile-"+userId.replaceAll("-","")]);
    await owner.query("INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner')",
      [organizationId,userId]);

    const first=await reconciler.reconcile(makeEvent("01","2026-11-18T10:00:00.000Z"));
    assert.equal(first.reconciled,true);
    assert.equal(first.subscription.status,"active");

    const newer=await reconciler.reconcile(makeEvent("02","2026-11-18T11:00:00.000Z"));
    assert.equal(newer.subscription.status,"past_due");

    const stale=await reconciler.reconcile(makeEvent("03","2026-11-18T10:30:00.000Z"));
    assert.equal(stale.stale,true);
    assert.equal(stale.subscription.status,"past_due");

    const saved=await owner.query("SELECT status,provider_event_created_at,version FROM searqon.subscriptions WHERE organization_id=$1",
      [organizationId]);
    assert.equal(saved.rows[0].status,"past_due");
    assert.equal(new Date(saved.rows[0].provider_event_created_at).toISOString(),"2026-11-18T11:00:00.000Z");
    assert.equal(Number(saved.rows[0].version),2);

    const events=await owner.query("SELECT provider_event_id FROM searqon.subscription_events WHERE organization_id=$1 ORDER BY occurred_at,provider_event_id",
      [organizationId]);
    assert.equal(events.rows.length,3);
  } finally {
    // Append-only subscription events intentionally remain in this disposable CI database.
    await workerPool.end();
    await owner.end();
  }
});
