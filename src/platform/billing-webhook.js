import { createHash } from "node:crypto";
import { normalizeVerifiedBillingEvent, BillingEventError } from "./billing-events.js";

const PROVIDER = /^[a-z][a-z0-9_-]{1,31}$/;
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_MAX_VERIFICATION_AGE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 30 * 1000;

export class BillingWebhookError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "BillingWebhookError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function validateOptions({ adapters, persist, now, maxBodyBytes, maxVerificationAgeMs, maxFutureSkewMs }) {
  if (!adapters || typeof adapters !== "object" || Array.isArray(adapters)) {
    throw new TypeError("Provider webhook adapters are required.");
  }
  if (typeof persist !== "function") throw new TypeError("A verified-event persistence function is required.");
  if (typeof now !== "function") throw new TypeError("A trusted server clock is required.");
  for (const [value, name] of [
    [maxBodyBytes, "maxBodyBytes"],
    [maxVerificationAgeMs, "maxVerificationAgeMs"],
    [maxFutureSkewMs, "maxFutureSkewMs"]
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name + " must be a positive safe integer.");
  }
  for (const [provider, adapter] of Object.entries(adapters)) {
    if (!PROVIDER.test(provider) || !adapter || typeof adapter.verifyAndParse !== "function") {
      throw new TypeError("Each provider must have a valid verifyAndParse adapter.");
    }
  }
}

function serverTime(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The trusted server clock must return a valid Date.");
  }
  return value;
}

/**
 * Provider-neutral boundary for signed billing webhooks.
 *
 * Each provider adapter owns signature parsing and cryptographic verification
 * over the exact raw request bytes. This module enforces ordering, freshness,
 * canonical normalization and data minimization. It deliberately does not
 * choose a payment provider, persist raw payloads, or grant entitlements.
 */
export function createBillingWebhookProcessor({
  adapters,
  persist,
  now = () => new Date(),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  maxVerificationAgeMs = DEFAULT_MAX_VERIFICATION_AGE_MS,
  maxFutureSkewMs = DEFAULT_MAX_FUTURE_SKEW_MS
} = {}) {
  validateOptions({ adapters, persist, now, maxBodyBytes, maxVerificationAgeMs, maxFutureSkewMs });

  return async function processBillingWebhook({ provider, rawBody, headers = {} } = {}) {
    if (typeof provider !== "string" || !PROVIDER.test(provider) || !Object.hasOwn(adapters, provider)) {
      throw new BillingWebhookError(404, "provider_not_supported", "The billing provider is not supported.");
    }
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw new BillingWebhookError(400, "invalid_raw_body", "The original webhook request bytes are required.");
    }
    if (rawBody.length > maxBodyBytes) {
      throw new BillingWebhookError(413, "payload_too_large", "The webhook payload exceeds the configured limit.");
    }
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
      throw new BillingWebhookError(400, "invalid_headers", "Webhook headers are invalid.");
    }

    const receivedAt = serverTime(now).toISOString();
    let verified;
    try {
      verified = await adapters[provider].verifyAndParse({
        rawBody: Buffer.from(rawBody),
        headers: Object.freeze({ ...headers }),
        receivedAt
      });
    } catch {
      throw new BillingWebhookError(401, "signature_invalid", "The provider signature could not be verified.");
    }

    let event;
    try {
      if (!verified || typeof verified !== "object" || Array.isArray(verified)) {
        throw new BillingEventError("invalid_event", "The provider adapter returned an invalid event.");
      }
      const verifiedAt = Date.parse(verified.verifiedAt);
      const nowMs = Date.parse(receivedAt);
      if (!Number.isFinite(verifiedAt)
        || verifiedAt < nowMs - maxVerificationAgeMs
        || verifiedAt > nowMs + maxFutureSkewMs) {
        throw new BillingEventError("invalid_verified_at", "The provider verification timestamp is outside the accepted window.");
      }
      event = normalizeVerifiedBillingEvent({
        provider,
        providerEventId: verified.providerEventId,
        eventType: verified.eventType,
        verifiedAt: new Date(verifiedAt).toISOString(),
        receivedAt,
        rawBodySha256: createHash("sha256").update(rawBody).digest("hex"),
        payload: verified.payload
      });
    } catch {
      throw new BillingWebhookError(400, "event_invalid", "The verified provider event does not match the billing event contract.");
    }

    let outcome;
    try {
      outcome = await persist(event);
    } catch {
      throw new BillingWebhookError(503, "event_persistence_unavailable", "The verified billing event could not be durably accepted.");
    }
    if (!outcome || typeof outcome !== "object"
      || typeof outcome.accepted !== "boolean"
      || typeof outcome.duplicate !== "boolean"
      || outcome.accepted !== true) {
      throw new BillingWebhookError(503, "event_persistence_unavailable", "The verified billing event was not durably accepted.");
    }
    return Object.freeze({
      accepted: true,
      duplicate: outcome.duplicate,
      eventId: event.providerEventId
    });
  };
}
