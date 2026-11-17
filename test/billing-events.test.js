import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVerifiedBillingEvent, BillingEventError } from "../src/platform/billing-events.js";

const base = {
  provider: "stripe",
  providerEventId: "evt_12345678",
  eventType: "customer.subscription.updated",
  verifiedAt: "2026-11-17T10:00:00.000Z",
  receivedAt: "2026-11-17T10:00:01.000Z",
  rawBodySha256: "a".repeat(64),
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

test("normalizes a verified provider event into a bounded canonical subscription snapshot", () => {
  const event = normalizeVerifiedBillingEvent(base);
  assert.deepEqual(event, {
    provider: "stripe",
    providerEventId: "evt_12345678",
    eventType: "customer.subscription.updated",
    eventKind: "subscription.snapshot",
    verifiedAt: "2026-11-17T10:00:00.000Z",
    receivedAt: "2026-11-17T10:00:01.000Z",
    rawBodySha256: "a".repeat(64),
    organizationId: "20000000-0000-4000-8000-000000000001",
    providerCustomerId: "cus_123",
    providerSubscriptionId: "sub_123",
    status: "active",
    plan: "growth",
    currentPeriodStart: "2026-11-01T00:00:00.000Z",
    currentPeriodEnd: "2026-12-01T00:00:00.000Z",
    trialEndsAt: null
  });
});

test("rejects unverified events before interpreting provider payloads", () => {
  assert.throws(() => normalizeVerifiedBillingEvent({ ...base, verifiedAt: null }),
    error => error instanceof BillingEventError && error.code === "signature_not_verified");
});

test("rejects invalid digest, provider identifiers, plan, status and period boundaries", () => {
  for (const patch of [
    { rawBodySha256: "not-a-digest" },
    { providerEventId: " " },
    { provider: "../provider" },
    { payload: { ...base.payload, plan: "trial" } },
    { payload: { ...base.payload, status: "unknown" } },
    { payload: { ...base.payload, currentPeriodEnd: base.payload.currentPeriodStart } }
  ]) {
    assert.throws(() => normalizeVerifiedBillingEvent({ ...base, ...patch }),
      error => error instanceof BillingEventError);
  }
});

test("maps supported event types only and never stores provider payload fields outside the allowlist", () => {
  const event = normalizeVerifiedBillingEvent({
    ...base,
    eventType: "invoice.payment_failed",
    payload: { ...base.payload, card: "must-not-leak", customerEmail: "private@example.test" }
  });
  assert.equal(event.eventKind, "invoice.payment_failed");
  assert.equal("card" in event, false);
  assert.equal("customerEmail" in event, false);
  assert.throws(() => normalizeVerifiedBillingEvent({ ...base, eventType: "customer.created" }),
    error => error.code === "unsupported_event_type");
});

test("rejects timestamps outside ISO-8601 UTC form and malformed trial expiry", () => {
  assert.throws(() => normalizeVerifiedBillingEvent({ ...base, verifiedAt: "yesterday" }),
    error => error.code === "invalid_verified_at");
  assert.throws(() => normalizeVerifiedBillingEvent({
    ...base, receivedAt: "2026-02-31T10:00:00.000Z"
  }), error => error.code === "invalid_received_at");
  assert.throws(() => normalizeVerifiedBillingEvent({
    ...base, payload: { ...base.payload, status: "trialing", plan: "trial", trialEndsAt: "soon" }
  }), error => error.code === "invalid_trial_ends_at");
});
