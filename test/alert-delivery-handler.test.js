import test from "node:test";
import assert from "node:assert/strict";
import { createAlertDeliveryHandler } from "../src/platform/alert-delivery-handler.js";

const job = Object.freeze({
  id: "cb42cb44-5a72-4f4a-9d5d-bb35b1b40ad2",
  leaseToken: ["8fbd4514", "317e", "43e1", "9e7b", "61f28c6b8c0d"].join("-"),
  attempts: 1,
  maxAttempts: 5,
  payload: { deliveryId: "a3f7a3aa-9d9a-4a12-9f35-3c2b6d0f95a1" }
});
const delivery = Object.freeze({
  id: job.payload.deliveryId,
  status: "queued",
  eventId: "9d9e9c6e-6d25-4f65-9a7b-71f0c61f8d10",
  eventPayload: { summary: "Brand citations declined", severity: "high" },
  destination: { channel: "slack", secret: "fixture-credential-not-real" }
});

function setup({ record = delivery, send = async () => ({ accepted: true }), markDelivered = async () => ({ accepted: true }), markCancelled = async () => ({ accepted: true }), markFailed = async () => ({ accepted: true }) } = {}) {
  const calls = [];
  const destinationStore = {
    getDelivery: async (...args) => { calls.push(["getDelivery", ...args]); return record; },
    markDelivered: async (...args) => { calls.push(["markDelivered", ...args]); return markDelivered(...args); },
    markCancelled: async (...args) => { calls.push(["markCancelled", ...args]); return markCancelled(...args); },
    markFailed: async (...args) => { calls.push(["markFailed", ...args]); return markFailed(...args); }
  };
  const sender = { send: async input => { calls.push(["send", input]); return send(input); } };
  return { handler: createAlertDeliveryHandler({ destinationStore, sender }), calls };
}

test("alert delivery handler retrieves under the lease, sends and records provider acceptance", async () => {
  const { handler, calls } = setup();
  const result = await handler(job, { workerId: "worker-alerts", signal: new AbortController().signal });
  assert.deepEqual(result, { status: "delivered" });
  assert.equal(calls[0][0], "getDelivery");
  assert.deepEqual(calls[0].slice(1), ["worker-alerts", job.payload.deliveryId, job.id, job.leaseToken]);
  assert.equal(calls[1][0], "send");
  assert.equal(calls[1][1].channel, "slack");
  assert.equal(calls[1][1].secret, delivery.destination.secret);
  assert.equal(calls[1][1].event.eventId, delivery.eventId);
  assert.equal(calls[2][0], "markDelivered");
  assert.deepEqual(calls[2].slice(1, 5), ["worker-alerts", job.payload.deliveryId, job.id, job.leaseToken]);
});

test("already terminal outbox deliveries are completed without another provider request", async () => {
  const { handler, calls } = setup({ record: { id: job.payload.deliveryId, status: "delivered", alreadyTerminal: true } });
  const result = await handler(job, { workerId: "worker-alerts" });
  assert.deepEqual(result, { status: "delivered", alreadyTerminal: true });
  assert.equal(calls.length, 1);
});

test("disabled destinations are cancelled without sending", async () => {
  const { handler, calls } = setup({ record: { id: job.payload.deliveryId, status: "cancelled", destinationDisabled: true } });
  const result = await handler(job, { workerId: "worker-alerts" });
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(calls[1][0], "markCancelled");
  assert.equal(calls.some(call => call[0] === "send"), false);
});

test("missing lease-bound delivery fails closed", async () => {
  const { handler, calls } = setup({ record: null });
  await assert.rejects(
    handler(job, { workerId: "worker-alerts" }),
    error => error.code === "delivery_unavailable"
  );
  assert.equal(calls.some(call => call[0] === "send"), false);
});

test("provider failures remain retryable before the final job attempt", async () => {
  const failure = Object.assign(new Error("provider unavailable"), { code: "provider_unavailable", retryable: true });
  const { handler, calls } = setup({ send: async () => { throw failure; } });
  await assert.rejects(handler(job, { workerId: "worker-alerts" }), error => error === failure);
  assert.equal(calls.some(call => call[0] === "markFailed"), false);
});

test("final provider failure marks the outbox failed while the lease is still active", async () => {
  const failure = Object.assign(new Error("provider rejected"), { code: "provider_rejected", retryable: false });
  const finalJob = { ...job, attempts: 5 };
  const { handler, calls } = setup({ send: async () => { throw failure; } });
  await assert.rejects(handler(finalJob, { workerId: "worker-alerts" }), error => error === failure);
  const failed = calls.find(call => call[0] === "markFailed");
  assert.ok(failed);
  assert.deepEqual(failed.slice(1, 4), ["worker-alerts", job.payload.deliveryId, job.id]);
  assert.deepEqual(failed[5], { errorCode: "provider_rejected" });
});

test("lost delivered-state lease is surfaced and never reported as delivered", async () => {
  const { handler } = setup({ markDelivered: async () => ({ accepted: false }) });
  await assert.rejects(
    handler(job, { workerId: "worker-alerts" }),
    error => error.code === "lease_lost"
  );
});
