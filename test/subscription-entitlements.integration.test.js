import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withUserTransaction } from "../src/platform/database.js";
import { createSubscriptionEntitlementResolver } from "../src/platform/subscription-entitlements.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("subscription entitlement resolution uses RLS-protected canonical billing state", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const runtime = new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl, max: 2 });
  const userA = randomUUID();
  const userB = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const now = new Date("2026-11-17T12:00:00.000Z");
  const resolver = createSubscriptionEntitlementResolver({ now: () => now });
  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Subscription A'),($3,$4,'Subscription B')",
      [userA,userA+"@subscription.example.test",userB,userB+"@subscription.example.test"]
    );
    await owner.query(
      "INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Subscription A',$2),($3,'Subscription B',$4)",
      [orgA,"subscription-"+userA.replaceAll("-",""),orgB,"subscription-"+userB.replaceAll("-","")]
    );
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner')",
      [orgA,userA,orgB,userB]
    );
    await owner.query(
      `INSERT INTO searqon.subscriptions
        (organization_id,provider,provider_customer_id,provider_subscription_id,status,plan,billing_interval,current_period_start,current_period_end)
       VALUES ($1,'manual','customer-sub-a','subscription-sub-a','active','growth','month','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')`,
      [orgA]
    );

    const visible = await withUserTransaction(runtime, userA, client => resolver(client, orgA));
    assert.equal(visible.plan, "growth");
    assert.equal(visible.status, "active");
    assert.deepEqual(visible.billingPeriod, {
      start: "2026-11-01T00:00:00.000Z",
      end: "2026-12-01T00:00:00.000Z"
    });

    const hidden = await withUserTransaction(runtime, userB, client => resolver(client, orgA));
    assert.equal(hidden.plan, "free");
    assert.equal(hidden.status, "free");

    await assert.rejects(
      withUserTransaction(runtime, userA, client => client.query(
        "UPDATE searqon.subscriptions SET plan = 'business' WHERE organization_id = $1", [orgA]
      )),
      error => error.code === "42501"
    );
  } finally {
    await owner.query("DELETE FROM searqon.subscription_events WHERE organization_id = ANY($1::uuid[])", [[orgA,orgB]]).catch(() => {});
    await owner.query("DELETE FROM searqon.billing_webhook_inbox WHERE organization_id = ANY($1::uuid[])", [[orgA,orgB]]).catch(() => {});
    await owner.query("DELETE FROM searqon.subscriptions WHERE organization_id = ANY($1::uuid[])", [[orgA,orgB]]).catch(() => {});
    await owner.query("DELETE FROM searqon.memberships WHERE organization_id = ANY($1::uuid[])", [[orgA,orgB]]).catch(() => {});
    await owner.query("DELETE FROM searqon.organizations WHERE id = ANY($1::uuid[])", [[orgA,orgB]]).catch(() => {});
    await owner.query("DELETE FROM searqon.app_users WHERE id = ANY($1::uuid[])", [[userA,userB]]).catch(() => {});
    await runtime.end();
    await owner.end();
  }
});
