import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createBillingWebhookProcessor } from "../src/platform/billing-webhook.js";
import { createBillingWebhookStore } from "../src/platform/billing-webhook-store.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("verified billing webhook is durably accepted once and processed under a fenced worker lease", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const ingestPool = new Pool({connectionString:process.env.SEARQON_BILLING_INGEST_DATABASE_URL});
  const workerPool = new Pool({connectionString:process.env.SEARQON_BILLING_WORKER_DATABASE_URL});
  const appPool = new Pool({connectionString:process.env.SEARQON_RUNTIME_DATABASE_URL});
  const organizationId = randomUUID();
  const userId = randomUUID();
  const eventId = "evt_" + randomUUID().replaceAll("-", "");
  const rawBody = Buffer.from(JSON.stringify({ id: eventId, type: "customer.subscription.updated" }));
  const store = createBillingWebhookStore({
    ingestPool,
    workerPool,
    leaseSeconds: 30
  });
  let normalizedEvent;
  const processor = createBillingWebhookProcessor({
    adapters: {
      fixture: {
        verifyAndParse: async ({ rawBody: bytes, receivedAt }) => {
          assert.deepEqual(bytes, rawBody);
          return {
            providerEventId: eventId,
            eventType: "customer.subscription.updated",
            verifiedAt: receivedAt,
            providerCreatedAt: "2026-11-18T09:59:59.000Z",
            payload: {
              organizationId,
              providerCustomerId: "cus_" + randomUUID().replaceAll("-", "").slice(0, 16),
              providerSubscriptionId: "sub_" + randomUUID().replaceAll("-", "").slice(0, 16),
              status: "active",
              plan: "growth",
              currentPeriodStart: "2026-11-01T00:00:00.000Z",
              currentPeriodEnd: "2026-12-01T00:00:00.000Z"
            }
          };
        }
      }
    },
    persist: event => {
      normalizedEvent = event;
      return store.acceptVerifiedEvent(event);
    }
  });

  try {
    await owner.query("INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Billing Inbox')",
      [userId,userId+"@billing-inbox.example.test"]);
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Billing Inbox',$2)",
      [organizationId,"billing-inbox-"+userId.replaceAll("-","")]);
    await owner.query("INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner')",
      [organizationId,userId]);

    const accepted = await processor({ provider: "fixture", rawBody, headers: {} });
    assert.deepEqual(accepted, { accepted: true, duplicate: false, eventId });
    const duplicate = await processor({ provider: "fixture", rawBody, headers: {} });
    assert.deepEqual(duplicate, { accepted: true, duplicate: true, eventId });
    await assert.rejects(
      store.acceptVerifiedEvent({ ...normalizedEvent, rawBodySha256: "b".repeat(64) }),
      error => error.code === "event_id_conflict"
    );

    const [job] = await store.claim("billing-worker-001", { limit: 1 });
    assert.ok(job);
    assert.equal(job.providerEventId, eventId);
    assert.equal(job.payload.status, "active");
    assert.equal("rawBody" in job, false);

    const completed = await store.complete("billing-worker-001", job.id, job.leaseToken);
    assert.deepEqual(completed, { accepted: true });
    const stale = await store.complete("billing-worker-001", job.id, job.leaseToken);
    assert.deepEqual(stale, { accepted: false });

    const persisted = await owner.query(
      "SELECT processing_status,attempt_count,raw_body_sha256,normalized_payload FROM searqon.billing_webhook_inbox WHERE provider='fixture' AND provider_event_id=$1",
      [eventId]
    );
    assert.equal(persisted.rows[0].processing_status, "processed");
    assert.equal(persisted.rows[0].attempt_count, 1);
    assert.equal(persisted.rows[0].raw_body_sha256.length, 64);
    assert.equal(JSON.stringify(persisted.rows[0]).includes(rawBody.toString()), false);

    await assert.rejects(
      appPool.query("SELECT * FROM searqon.billing_webhook_inbox WHERE provider_event_id=$1", [eventId]),
      error => error.code === "42501"
    );
  } finally {
    await owner.query("DELETE FROM searqon.billing_webhook_inbox WHERE organization_id=$1", [organizationId]).catch(() => {});
    await owner.query("DELETE FROM searqon.memberships WHERE organization_id=$1", [organizationId]).catch(() => {});
    await owner.query("DELETE FROM searqon.organizations WHERE id=$1", [organizationId]).catch(() => {});
    await owner.query("DELETE FROM searqon.app_users WHERE id=$1", [userId]).catch(() => {});
    await appPool.end();
    await ingestPool.end();
    await workerPool.end();
    await owner.end();
  }
});
