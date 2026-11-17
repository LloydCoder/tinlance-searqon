import { resolveEntitlements } from "./entitlements.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isoTimestamp(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Persisted subscription " + field + " is invalid.");
  return date.toISOString();
}

function utcCalendarMonth(now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Resolve entitlements only from a tenant-scoped database transaction.
 * The request never supplies a plan or billing-period boundary. Overage remains
 * disabled until a separate explicit-consent and spend-cap workflow exists.
 */
export function createSubscriptionEntitlementResolver({ now = () => new Date() } = {}) {
  if (typeof now !== "function") throw new TypeError("A trusted server clock is required.");
  const initialClockValue = now();
  if (!(initialClockValue instanceof Date) || !Number.isFinite(initialClockValue.getTime())) {
    throw new TypeError("The server clock must return a valid Date.");
  }

  return async function getEntitlements(client, organizationId) {
    if (!client || typeof client.query !== "function") {
      throw new TypeError("A tenant-scoped PostgreSQL database client is required.");
    }
    if (typeof organizationId !== "string" || !UUID.test(organizationId)) {
      throw new TypeError("A valid organization UUID is required.");
    }

    const clockValue = now();
    if (!(clockValue instanceof Date) || !Number.isFinite(clockValue.getTime())) {
      throw new TypeError("The server clock must return a valid Date.");
    }
    const currentTime = clockValue.getTime();
    const result = await client.query(
      `SELECT id, status, plan, current_period_start, current_period_end, trial_ends_at
       FROM searqon.subscriptions
       WHERE organization_id = $1`,
      [organizationId]
    );
    if (!Array.isArray(result.rows) || result.rows.length > 1) {
      throw new Error("Subscription lookup returned an invalid result.");
    }

    const row = result.rows[0];
    if (!row) {
      return {
        ...resolveEntitlements({ subscription: null, now: currentTime }),
        billingPeriod: utcCalendarMonth(clockValue),
        overage: { enabled: false, spendCapMicroUsd: 0 }
      };
    }

    const periodStart = isoTimestamp(row.current_period_start, "period start");
    const periodEnd = isoTimestamp(row.current_period_end, "period end");
    if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
      throw new Error("Persisted subscription billing period is invalid.");
    }

    let subscription = { status: row.status, plan: row.plan };
    let billingPeriod = utcCalendarMonth(clockValue);

    if (row.status === "active") {
      if (currentTime < Date.parse(periodStart) || currentTime >= Date.parse(periodEnd)) {
        subscription = { status: "expired" };
      } else {
        billingPeriod = { start: periodStart, end: periodEnd };
      }
    } else if (row.status === "trialing") {
      const trialEndsAt = isoTimestamp(row.trial_ends_at, "trial expiry");
      subscription = { status: "trialing", plan: "trial", trialEndsAt };
      if (currentTime < Date.parse(trialEndsAt)) {
        billingPeriod = { start: periodStart, end: trialEndsAt };
      }
    }

    return {
      ...resolveEntitlements({ subscription, now: currentTime }),
      billingPeriod,
      overage: { enabled: false, spendCapMicroUsd: 0 }
    };
  };
}
