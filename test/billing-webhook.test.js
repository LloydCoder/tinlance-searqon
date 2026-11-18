import test from "node:test";
import assert from "node:assert/strict";
import { createBillingWebhookProcessor, BillingWebhookError } from "../src/platform/billing-webhook.js";

const rawBody = Buffer.from(JSON.stringify({ id: "evt_12345678" }));
const canonical = {
  provider: "stripe",
  providerEventId: "evt_12345678",
  eventType: "customer.subscription.updated",
  verifiedAt: "2026-11-18T10:00:00.000Z",
  providerCreatedAt: "2026-11-18T09:59:59.000Z",
  receivedAt: "2026-11-18T10:00:01.000Z",
  payload: {
    organizationId: "20000000-0000-4000-8000-000000000001",
    providerCustomerId: "cus_123",
    providerSubscriptionId: "sub_123",
    status: "active",
    plan: "growth",
    currentPeriodStart: "2026-11-01T00:00:00.000Z",
    currentPeriodEnd: "2026-12-01T00:00:00.000Z"
  }
};

test("verifies original raw bytes before normalization and persistence", async () => {
  const order = [];
  const processor = createBillingWebhookProcessor({
    adapters: {
      stripe: {
        async verifyAndParse({ rawBody: received, headers }) {
          order.push("verify");
          assert.deepEqual(received, rawBody);
          assert.equal(headers["stripe-signature"], "signature");
          return canonical;
        }
      }
    },
    persist: async event => {
      order.push("persist");
      assert.equal(event.rawBodySha256.length, 64);
      assert.equal(event.providerEventId, canonical.providerEventId);
      return { accepted: true, duplicate: false };
    },
    now: () => new Date("2026-11-18T10:00:01.000Z")
  });

  const result = await processor({ provider: "stripe", rawBody, headers: { "stripe-signature": "signature" } });
  assert.deepEqual(order, ["verify", "persist"]);
  assert.deepEqual(result, { accepted: true, duplicate: false, eventId: "evt_12345678" });
});

test("does not call persistence when provider verification fails", async () => {
  let persisted = false;
  const processor = createBillingWebhookProcessor({
    adapters: { stripe: { verifyAndParse: async () => { throw new Error("invalid signature"); } } },
    persist: async () => { persisted = true; },
    now: () => new Date("2026-11-18T10:00:01.000Z")
  });

  await assert.rejects(
    processor({ provider: "stripe", rawBody, headers: {} }),
    error => error instanceof BillingWebhookError && error.statusCode === 401 && error.code === "signature_invalid"
  );
  assert.equal(persisted, false);
});

test("rejects unknown providers and malformed or oversized raw bodies before adapter execution", async () => {
  let verified = false;
  const processor = createBillingWebhookProcessor({
    adapters: { stripe: { verifyAndParse: async () => { verified = true; return canonical; } } },
    persist: async () => ({ accepted: true, duplicate: false }),
    maxBodyBytes: 32,
    now: () => new Date("2026-11-18T10:00:01.000Z")
  });

  await assert.rejects(processor({ provider: "unknown", rawBody, headers: {} }),
    error => error instanceof BillingWebhookError && error.code === "provider_not_supported");
  await assert.rejects(processor({ provider: "stripe", rawBody: "not bytes", headers: {} }),
    error => error instanceof BillingWebhookError && error.code === "invalid_raw_body");
  await assert.rejects(processor({ provider: "stripe", rawBody: Buffer.alloc(33), headers: {} }),
    error => error instanceof BillingWebhookError && error.statusCode === 413);
  assert.equal(verified, false);
});

test("rejects stale or invalid verification timestamps and malformed normalized payloads", async () => {
  const processor = createBillingWebhookProcessor({
    adapters: {
      stripe: {
        verifyAndParse: async () => ({
          ...canonical,
          verifiedAt: "not-a-timestamp"
        })
      }
    },
    persist: async () => ({ accepted: true, duplicate: false }),
    now: () => new Date("2026-11-18T10:00:01.000Z")
  });

  await assert.rejects(processor({ provider: "stripe", rawBody, headers: {} }),
    error => error instanceof BillingWebhookError && error.code === "event_invalid");
});

test("never forwards or persists raw webhook bytes or arbitrary provider fields", async () => {
  let saved;
  const processor = createBillingWebhookProcessor({
    adapters: {
      stripe: {
        verifyAndParse: async () => ({
          ...canonical,
          payload: { ...canonical.payload, cardNumber: "4111111111111111", email: "private@example.test" }
        })
      }
    },
    persist: async event => { saved = event; return { accepted: true, duplicate: false }; },
    now: () => new Date("2026-11-18T10:00:01.000Z")
  });

  await processor({ provider: "stripe", rawBody, headers: {} });
  assert.equal("rawBody" in saved, false);
  assert.equal("cardNumber" in saved, false);
  assert.equal("email" in saved, false);
  assert.equal(JSON.stringify(saved).includes("4111111111111111"), false);
});

test("rejects verification timestamps outside the bounded freshness window", async () => {
  for (const verifiedAt of ["2026-11-18T09:54:59.999Z", "2026-11-18T10:00:31.001Z"]) {
    let persisted = false;
    const processor = createBillingWebhookProcessor({
      adapters: { stripe: { verifyAndParse: async () => ({ ...canonical, verifiedAt }) } },
      persist: async () => { persisted = true; return { accepted: true, duplicate: false }; },
      now: () => new Date("2026-11-18T10:00:00.000Z"),
      maxVerificationAgeMs: 5 * 60 * 1000,
      maxFutureSkewMs: 30 * 1000
    });
    await assert.rejects(
      processor({ provider: "stripe", rawBody, headers: {} }),
      error => error instanceof BillingWebhookError && error.code === "event_invalid"
    );
    assert.equal(persisted, false);
  }
});

test("rejects a persistence result that does not prove durable acceptance", async () => {
  for (const outcome of [null, {}, { accepted: false, duplicate: false }, { accepted: true, duplicate: "no" }]) {
    const processor = createBillingWebhookProcessor({
      adapters: { stripe: { verifyAndParse: async () => canonical } },
      persist: async () => outcome,
      now: () => new Date("2026-11-18T10:00:01.000Z")
    });
    await assert.rejects(
      processor({ provider: "stripe", rawBody, headers: {} }),
      error => error instanceof BillingWebhookError && error.statusCode === 503
    );
  }
});

test("maps persistence exceptions to a retryable generic service error", async () => {
  const processor = createBillingWebhookProcessor({
    adapters: { stripe: { verifyAndParse: async () => canonical } },
    persist: async () => { throw new Error("database URL and SQL must not leak"); },
    now: () => new Date("2026-11-18T10:00:01.000Z")
  });
  await assert.rejects(
    processor({ provider: "stripe", rawBody, headers: {} }),
    error => error instanceof BillingWebhookError
      && error.statusCode === 503
      && !error.message.includes("database URL")
  );
});


test("acknowledges verified non-billable provider events without persisting them", async () => {
  let persisted=false;
  const processor=createBillingWebhookProcessor({
    adapters:{stripe:{verifyAndParse:async()=>({ignored:true,providerEventId:"evt_12345678"})}},
    persist:async()=>{persisted=true;return {accepted:true,duplicate:false};},
    now:()=>new Date("2026-11-18T10:00:01.000Z")
  });
  const result=await processor({provider:"stripe",rawBody,headers:{}});
  assert.deepEqual(result,{accepted:true,duplicate:false,ignored:true,eventId:"evt_12345678"});
  assert.equal(persisted,false);
});
