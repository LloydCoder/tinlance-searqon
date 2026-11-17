import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("billing lifecycle schema stores canonical subscriptions and a redacted idempotent webhook inbox", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const runtime = new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl });
  const userId = randomUUID();
  const organizationId = randomUUID();
  try {
    await owner.query("INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Billing Schema')", [userId,userId+"@billing.example.test"]);
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Billing Schema',$2)", [organizationId,"billing-"+userId.replaceAll("-","")]);
    await owner.query("INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner')", [organizationId,userId]);

    const subscription = await owner.query(
      `INSERT INTO searqon.subscriptions
        (organization_id,provider,provider_customer_id,provider_subscription_id,status,plan,billing_interval,current_period_start,current_period_end)
       VALUES ($1,'manual','customer-123','subscription-123','active','growth','month','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')
       RETURNING id`,
      [organizationId]
    );
    assert.ok(subscription.rows[0].id);

    await owner.query(
      `INSERT INTO searqon.billing_webhook_inbox
        (provider,provider_event_id,organization_id,event_type,event_kind,raw_body_sha256,verified_at,received_at,normalized_payload)
       VALUES ('stripe','evt_12345678',$1,'customer.subscription.updated','subscription.snapshot',$2,now(),now(),$3::jsonb)`,
      [organizationId,"a".repeat(64),JSON.stringify({status:"active",plan:"growth"})]
    );
    await assert.rejects(
      owner.query(
        `INSERT INTO searqon.billing_webhook_inbox
          (provider,provider_event_id,organization_id,event_type,event_kind,raw_body_sha256,verified_at,received_at,normalized_payload)
         VALUES ('stripe','evt_12345678',$1,'customer.subscription.updated','subscription.snapshot',$2,now(),now(),'{}'::jsonb)`,
        [organizationId,"b".repeat(64)]
      ),
      error => error.code === "23505"
    );
    const inbox = await owner.query("SELECT raw_body_sha256, normalized_payload, processing_status FROM searqon.billing_webhook_inbox WHERE provider_event_id = 'evt_12345678'");
    assert.equal(inbox.rows[0].raw_body_sha256, "a".repeat(64));
    assert.deepEqual(inbox.rows[0].normalized_payload, {status:"active",plan:"growth"});
    assert.equal(inbox.rows[0].processing_status, "pending");
    assert.equal(JSON.stringify(inbox.rows[0]).includes("customerEmail"), false);

    const policies = await owner.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='searqon' AND c.relname IN ('subscriptions','billing_webhook_inbox') ORDER BY c.relname`
    );
    assert.deepEqual(policies.rows.map(row => [row.relname,row.relrowsecurity,row.relforcerowsecurity]), [
      ["billing_webhook_inbox",true,true],["subscriptions",true,true]
    ]);
    await assert.rejects(runtime.query("SELECT * FROM searqon.billing_webhook_inbox"), error => error.code === "42501");
  } finally {
    await owner.query("DELETE FROM searqon.billing_webhook_inbox WHERE organization_id = $1", [organizationId]).catch(() => {});
    await owner.query("DELETE FROM searqon.subscriptions WHERE organization_id = $1", [organizationId]).catch(() => {});
    await owner.query("DELETE FROM searqon.memberships WHERE organization_id = $1", [organizationId]).catch(() => {});
    await owner.query("DELETE FROM searqon.organizations WHERE id = $1", [organizationId]).catch(() => {});
    await owner.query("DELETE FROM searqon.app_users WHERE id = $1", [userId]).catch(() => {});
    await runtime.end();
    await owner.end();
  }
});
