const PROVIDER = /^[a-z][a-z0-9_-]{1,31}$/;
const PROVIDER_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const EVENT_KINDS = new Map([
  ["customer.subscription.created", "subscription.snapshot"],
  ["customer.subscription.updated", "subscription.snapshot"],
  ["customer.subscription.deleted", "subscription.snapshot"],
  ["invoice.payment_succeeded", "invoice.payment_succeeded"],
  ["invoice.payment_failed", "invoice.payment_failed"]
]);
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

export class BillingInboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BillingInboxError";
    this.code = code;
  }
}

function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)
    || !PROVIDER.test(event.provider ?? "")
    || !PROVIDER_EVENT_ID.test(event.providerEventId ?? "")
    || !UUID.test(event.organizationId ?? "")
    || !EVENT_KINDS.has(event.eventType)
    || EVENT_KINDS.get(event.eventType) !== event.eventKind
    || !DIGEST.test(event.rawBodySha256 ?? "")
    || !Number.isFinite(Date.parse(event.verifiedAt))
    || !Number.isFinite(Date.parse(event.providerCreatedAt))
    || !Number.isFinite(Date.parse(event.receivedAt))) {
    throw new BillingInboxError("invalid_verified_event", "A canonical verified billing event is required.");
  }
  const payload = {
    organizationId: event.organizationId,
    providerCustomerId: event.providerCustomerId,
    providerSubscriptionId: event.providerSubscriptionId,
    status: event.status,
    plan: event.plan,
    currentPeriodStart: event.currentPeriodStart,
    currentPeriodEnd: event.currentPeriodEnd,
    ...(event.trialEndsAt ? { trialEndsAt: event.trialEndsAt } : {})
  };
  return Object.freeze({
    provider: event.provider,
    providerEventId: event.providerEventId,
    organizationId: event.organizationId,
    eventType: event.eventType,
    eventKind: event.eventKind,
    rawBodySha256: event.rawBodySha256,
    verifiedAt: new Date(event.verifiedAt).toISOString(),
    providerCreatedAt: new Date(event.providerCreatedAt).toISOString(),
    receivedAt: new Date(event.receivedAt).toISOString(),
    normalizedPayload: payload
  });
}

function workerId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/.test(value)) {
    throw new BillingInboxError("invalid_worker_id", "A valid billing worker identity is required.");
  }
  return value;
}

function positiveInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new BillingInboxError("invalid_" + name, name + " is outside the supported range.");
  }
  return value;
}

async function withWorkerTransaction(pool, work) {
  const client = await pool.connect();
  let started = false;
  let discard;
  try {
    await client.query("BEGIN");
    started = true;
    await client.query("SET LOCAL ROLE searqon_billing_worker");
    const result = await work(client);
    await client.query("COMMIT");
    started = false;
    return result;
  } catch (error) {
    if (started) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) { discard = rollbackError; }
    } else {
      discard = error;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

/**
 * Durable, redacted billing inbox.
 *
 * ingestPool MUST authenticate as a dedicated login granted only
 * searqon_billing_ingest. workerPool MUST authenticate as a dedicated login
 * granted only searqon_billing_worker. Never pass the request-serving pool.
 */
export function createBillingWebhookStore({
  ingestPool,
  workerPool,
  now = () => new Date(),
  leaseSeconds = 60,
  maxBatchSize = 20,
  maxRetrySeconds = 3600
} = {}) {
  if (!ingestPool || typeof ingestPool.query !== "function") {
    throw new TypeError("A dedicated billing-ingest PostgreSQL pool is required.");
  }
  if (!workerPool || typeof workerPool.connect !== "function") {
    throw new TypeError("A dedicated billing-worker PostgreSQL pool is required.");
  }
  if (typeof now !== "function") throw new TypeError("A trusted server clock is required.");
  positiveInteger(leaseSeconds, "lease_seconds", 3600);
  positiveInteger(maxBatchSize, "batch_size", 100);
  positiveInteger(maxRetrySeconds, "max_retry_seconds", 86400);

  return Object.freeze({
    async acceptVerifiedEvent(input) {
      const event = validateEvent(input);
      const result = await ingestPool.query(
        `INSERT INTO searqon.billing_webhook_inbox
          (provider,provider_event_id,organization_id,event_type,event_kind,raw_body_sha256,verified_at,provider_created_at,received_at,normalized_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (provider,provider_event_id) DO NOTHING
         RETURNING id`,
        [event.provider,event.providerEventId,event.organizationId,event.eventType,event.eventKind,
          event.rawBodySha256,event.verifiedAt,event.providerCreatedAt,event.receivedAt,JSON.stringify(event.normalizedPayload)]
      );
      const duplicate = result.rows?.length !== 1;
      if (duplicate) {
        const existing = await ingestPool.query(
          `SELECT organization_id,raw_body_sha256
           FROM searqon.billing_webhook_inbox
           WHERE provider=$1 AND provider_event_id=$2`,
          [event.provider,event.providerEventId]
        );
        const row = existing.rows?.[0];
        if (!row || row.organization_id !== event.organizationId || row.raw_body_sha256 !== event.rawBodySha256) {
          throw new BillingInboxError("event_id_conflict", "The provider event identifier was reused with different verified content.");
        }
      }
      return Object.freeze({
        accepted: true,
        duplicate,
        eventId: event.providerEventId
      });
    },

    async claim(worker, { limit = 10, leaseSeconds: requestedLeaseSeconds = leaseSeconds } = {}) {
      const owner = workerId(worker);
      const batch = positiveInteger(limit, "batch_size", maxBatchSize);
      const lease = positiveInteger(requestedLeaseSeconds, "lease_seconds", 3600);
      return withWorkerTransaction(workerPool, async client => {
        await client.query(
          `UPDATE searqon.billing_webhook_inbox
           SET processing_status='failed',locked_until=NULL,lease_owner=NULL,lease_token=NULL,
               last_error_code='attempts_exhausted',updated_at=now()
           WHERE processing_status='processing' AND locked_until <= now() AND attempt_count >= max_attempts`
        );
        const result = await client.query(
          `WITH candidates AS (
             SELECT id
             FROM searqon.billing_webhook_inbox
             WHERE attempt_count < max_attempts
               AND (
                 (processing_status IN ('pending','failed') AND next_attempt_at <= now())
                 OR (processing_status='processing' AND locked_until <= now())
               )
             ORDER BY next_attempt_at,created_at,id
             FOR UPDATE SKIP LOCKED
             LIMIT $1
           )
           UPDATE searqon.billing_webhook_inbox AS inbox
           SET processing_status='processing',
               attempt_count=inbox.attempt_count+1,
               locked_until=now()+make_interval(secs=>$2),
               lease_owner=$3,
               lease_token=gen_random_uuid(),
               updated_at=now()
           FROM candidates
           WHERE inbox.id=candidates.id
           RETURNING inbox.id,inbox.provider,inbox.provider_event_id,inbox.organization_id,
             inbox.event_type,inbox.event_kind,inbox.raw_body_sha256,inbox.verified_at,
             inbox.provider_created_at,inbox.received_at,inbox.normalized_payload,inbox.attempt_count,inbox.lease_token,inbox.locked_until`,
          [batch,lease,owner]
        );
        return result.rows.map(row => Object.freeze({
          id: row.id,
          provider: row.provider,
          providerEventId: row.provider_event_id,
          organizationId: row.organization_id,
          eventType: row.event_type,
          eventKind: row.event_kind,
          rawBodySha256: row.raw_body_sha256,
          verifiedAt: row.verified_at,
          providerCreatedAt: row.provider_created_at,
          receivedAt: row.received_at,
          payload: row.normalized_payload,
          attempt: row.attempt_count,
          leaseToken: row.lease_token,
          leaseExpiresAt: row.locked_until
        }));
      });
    },

    async complete(worker, id, token) {
      const owner = workerId(worker);
      if (!UUID.test(id ?? "") || !UUID.test(token ?? "")) {
        throw new BillingInboxError("invalid_lease", "A valid inbox ID and lease token are required.");
      }
      return withWorkerTransaction(workerPool, async client => {
        const result = await client.query(
          `UPDATE searqon.billing_webhook_inbox
           SET processing_status='processed',processed_at=now(),locked_until=NULL,
               lease_owner=NULL,lease_token=NULL,last_error_code=NULL,updated_at=now()
           WHERE id=$1 AND processing_status='processing' AND lease_owner=$2
             AND lease_token=$3 AND locked_until > now()
           RETURNING id`,
          [id,owner,token]
        );
        return Object.freeze({ accepted: result.rowCount === 1 });
      });
    },

    async retry(worker, id, token, { errorCode = "handler_failed", retryDelaySeconds = 30 } = {}) {
      const owner = workerId(worker);
      if (!UUID.test(id ?? "") || !UUID.test(token ?? "")) {
        throw new BillingInboxError("invalid_lease", "A valid inbox ID and lease token are required.");
      }
      if (typeof errorCode !== "string" || !ERROR_CODE.test(errorCode)) {
        throw new BillingInboxError("invalid_error_code", "A safe error code is required.");
      }
      const delay = positiveInteger(retryDelaySeconds, "retry_delay_seconds", maxRetrySeconds);
      return withWorkerTransaction(workerPool, async client => {
        const result = await client.query(
          `UPDATE searqon.billing_webhook_inbox
           SET processing_status='failed',locked_until=NULL,lease_owner=NULL,lease_token=NULL,
               next_attempt_at=now()+make_interval(secs=>$4),last_error_code=$5,updated_at=now()
           WHERE id=$1 AND processing_status='processing' AND lease_owner=$2
             AND lease_token=$3 AND locked_until > now()
           RETURNING id,attempt_count,max_attempts`,
          [id,owner,token,delay,errorCode]
        );
        if (result.rowCount !== 1) return Object.freeze({ accepted: false, exhausted: false });
        return Object.freeze({
          accepted: true,
          exhausted: result.rows[0].attempt_count >= result.rows[0].max_attempts
        });
      });
    }
  });
}
