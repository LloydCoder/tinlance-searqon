const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const PROVIDER = /^[a-z][a-z0-9_-]{1,31}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const PLANS = new Set(["free", "starter", "growth", "agency", "business", "enterprise", "trial"]);
const STATUSES = new Set(["active", "trialing", "past_due", "canceled", "expired", "free"]);
const EVENT_KINDS = Object.freeze({
  "customer.subscription.created": "subscription.snapshot",
  "customer.subscription.updated": "subscription.snapshot",
  "customer.subscription.deleted": "subscription.snapshot",
  "invoice.payment_succeeded": "invoice.payment_succeeded",
  "invoice.payment_failed": "invoice.payment_failed"
});

export class BillingEventError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BillingEventError";
    this.code = code;
  }
}

function requireString(value, field, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new BillingEventError("invalid_" + field, field + " is invalid.");
  }
  return value;
}

function requireUtcTimestamp(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new BillingEventError("invalid_" + field, field + " must be an ISO-8601 UTC timestamp.");
  }
  return new Date(value).toISOString();
}

/**
 * Convert a provider-specific event into the minimal Searqon event contract.
 * The caller MUST verify the provider signature over the original raw bytes first.
 * This function deliberately receives only the digest and an explicit verification
 * timestamp; raw bodies and arbitrary provider fields are never returned.
 */
export function normalizeVerifiedBillingEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BillingEventError("invalid_event", "A verified billing event is required.");
  }
  if (!input.verifiedAt) {
    throw new BillingEventError("signature_not_verified", "The provider signature must be verified before normalization.");
  }

  const provider = requireString(input.provider, "provider", PROVIDER);
  const providerEventId = requireString(input.providerEventId, "provider_event_id", PROVIDER_ID);
  if (typeof input.eventType !== "string" || !Object.hasOwn(EVENT_KINDS, input.eventType)) {
    throw new BillingEventError("unsupported_event_type", "The provider event type is not supported.");
  }
  const verifiedAt = requireUtcTimestamp(input.verifiedAt, "verified_at");
  const receivedAt = requireUtcTimestamp(input.receivedAt, "received_at");
  const rawBodySha256 = requireString(input.rawBodySha256, "raw_body_sha256", DIGEST);
  const payload = input.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BillingEventError("invalid_payload", "A normalized subscription payload is required.");
  }

  const organizationId = requireString(payload.organizationId, "organization_id", UUID);
  const providerCustomerId = requireString(payload.providerCustomerId, "provider_customer_id", PROVIDER_ID);
  const providerSubscriptionId = requireString(payload.providerSubscriptionId, "provider_subscription_id", PROVIDER_ID);
  if (!STATUSES.has(payload.status)) throw new BillingEventError("invalid_status", "Subscription status is not supported.");
  if (!PLANS.has(payload.plan)) throw new BillingEventError("invalid_plan", "Subscription plan is not supported.");
  if ((payload.status === "trialing") !== (payload.plan === "trial")) {
    throw new BillingEventError("invalid_plan_status", "Trial subscriptions must use trialing status and the trial plan.");
  }

  const currentPeriodStart = requireUtcTimestamp(payload.currentPeriodStart, "period_start");
  const currentPeriodEnd = requireUtcTimestamp(payload.currentPeriodEnd, "period_end");
  if (Date.parse(currentPeriodEnd) <= Date.parse(currentPeriodStart)) {
    throw new BillingEventError("invalid_period", "The subscription period end must be after its start.");
  }

  let trialEndsAt = null;
  if (payload.status === "trialing") {
    trialEndsAt = requireUtcTimestamp(payload.trialEndsAt, "trial_ends_at");
    if (Date.parse(trialEndsAt) <= Date.parse(currentPeriodStart)) {
      throw new BillingEventError("invalid_trial_ends_at", "Trial expiry must be after the trial period start.");
    }
  }

  return Object.freeze({
    provider,
    providerEventId,
    eventType: input.eventType,
    eventKind: EVENT_KINDS[input.eventType],
    verifiedAt,
    receivedAt,
    rawBodySha256,
    organizationId,
    providerCustomerId,
    providerSubscriptionId,
    status: payload.status,
    plan: payload.plan,
    currentPeriodStart,
    currentPeriodEnd,
    trialEndsAt
  });
}
