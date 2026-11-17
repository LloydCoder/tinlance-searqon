import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionEntitlementResolver } from "../src/platform/subscription-entitlements.js";

const organizationId = "20000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-17T12:00:00.000Z");

function clientWith(row) {
  const queries = [];
  return {
    queries,
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: row ? [row] : [] };
    }
  };
}

test("defaults to the free plan with UTC calendar billing boundaries when no subscription exists", async () => {
  const client = clientWith(null);
  const resolve = createSubscriptionEntitlementResolver({ now: () => NOW });
  const result = await resolve(client, organizationId);
  assert.equal(result.plan, "free");
  assert.deepEqual(result.billingPeriod, {
    start: "2026-11-01T00:00:00.000Z",
    end: "2026-12-01T00:00:00.000Z"
  });
  assert.deepEqual(result.overage, { enabled: false, spendCapMicroUsd: 0 });
  assert.match(client.queries[0].sql, /FROM searqon\.subscriptions/);
  assert.deepEqual(client.queries[0].values, [organizationId]);
});

test("uses the persisted active subscription and canonical provider billing period", async () => {
  const client = clientWith({
    id: "30000000-0000-4000-8000-000000000001",
    status: "active", plan: "growth",
    current_period_start: new Date("2026-11-01T00:00:00.000Z"),
    current_period_end: new Date("2026-12-01T00:00:00.000Z"),
    trial_ends_at: null
  });
  const result = await createSubscriptionEntitlementResolver({ now: () => NOW })(client, organizationId);
  assert.equal(result.plan, "growth");
  assert.equal(result.status, "active");
  assert.equal(result.limits.projects, 5);
  assert.deepEqual(result.billingPeriod, {
    start: "2026-11-01T00:00:00.000Z",
    end: "2026-12-01T00:00:00.000Z"
  });
});

test("fails closed to free when an active provider period has not started or has expired", async () => {
  const resolver = createSubscriptionEntitlementResolver({ now: () => NOW });
  for (const [start, end] of [
    ["2026-12-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"],
    ["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]
  ]) {
    const result = await resolver(clientWith({
      status: "active", plan: "business",
      current_period_start: new Date(start), current_period_end: new Date(end), trial_ends_at: null
    }), organizationId);
    assert.equal(result.plan, "free");
    assert.equal(result.status, "expired");
  }
});

test("uses trial start and trial expiry as lifetime usage boundaries", async () => {
  const result = await createSubscriptionEntitlementResolver({ now: () => NOW })(clientWith({
    status: "trialing", plan: "trial",
    current_period_start: new Date("2026-11-10T00:00:00.000Z"),
    current_period_end: new Date("2026-11-24T00:00:00.000Z"),
    trial_ends_at: new Date("2026-11-24T00:00:00.000Z")
  }), organizationId);
  assert.equal(result.plan, "trial");
  assert.deepEqual(result.billingPeriod, {
    start: "2026-11-10T00:00:00.000Z",
    end: "2026-11-24T00:00:00.000Z"
  });
});

test("rejects invalid resolver configuration, organization IDs and database clients", async () => {
  assert.throws(() => createSubscriptionEntitlementResolver({ now: "not-a-function" }), /clock/);
  const resolve = createSubscriptionEntitlementResolver({ now: () => NOW });
  await assert.rejects(resolve({}, organizationId), /database client/);
  await assert.rejects(resolve(clientWith(null), "not-a-uuid"), /organization UUID/);
  assert.throws(() => createSubscriptionEntitlementResolver({ now: () => "not-a-date" }), /clock/);
});
