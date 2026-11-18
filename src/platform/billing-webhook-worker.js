const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;

export class BillingWebhookWorkerError extends Error {
  constructor(code,message) {
    super(message);
    this.name = "BillingWebhookWorkerError";
    this.code = code;
  }
}

/**
 * Runs durable inbox leases. The supplied reconciliation handler MUST fetch
 * canonical subscription state from the provider API and apply it idempotently.
 * A webhook payload alone must never grant or revoke entitlements.
 */
export function createBillingWebhookWorker({
  store,
  workerId,
  reconcileProviderEvent,
  batchSize = 10,
  leaseSeconds = 300,
  retryBaseSeconds = 30,
  maxRetrySeconds = 3600
} = {}) {
  if (!store || typeof store.claim !== "function" || typeof store.complete !== "function" || typeof store.retry !== "function") {
    throw new TypeError("A durable billing webhook store is required.");
  }
  if (typeof workerId !== "string" || !WORKER_ID.test(workerId)) throw new TypeError("A valid billing worker identity is required.");
  if (typeof reconcileProviderEvent !== "function") throw new TypeError("A provider-canonical reconciliation handler is required.");
  for (const [value,name,max] of [
    [batchSize,"batch_size",100],
    [leaseSeconds,"lease_seconds",3600],
    [retryBaseSeconds,"retry_base_seconds",3600],
    [maxRetrySeconds,"max_retry_seconds",86400]
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new RangeError(name+" is outside the supported range.");
  }

  async function processEvent(event) {
    try {
      const result = await reconcileProviderEvent(event,{workerId});
      if (!result || result.reconciled !== true) {
        throw new BillingWebhookWorkerError("provider_reconciliation_incomplete","Canonical provider reconciliation did not complete.");
      }
      const completed = await store.complete(workerId,event.id,event.leaseToken);
      return completed.accepted ? "processed" : "lease_lost";
    } catch (error) {
      const errorCode = typeof error?.code === "string" && ERROR_CODE.test(error.code)
        ? error.code : "provider_reconciliation_failed";
      const exponent = Math.min(8,Math.max(0,event.attempt-1));
      const retryDelaySeconds = Math.min(maxRetrySeconds,retryBaseSeconds*(2**exponent));
      try {
        const retried = await store.retry(workerId,event.id,event.leaseToken,{errorCode,retryDelaySeconds});
        if (!retried.accepted) return "lease_lost";
        return retried.exhausted ? "failed" : "retry_scheduled";
      } catch {
        return "worker_error";
      }
    }
  }

  return Object.freeze({
    async runOnce() {
      const events = await store.claim(workerId,{limit:batchSize,leaseSeconds});
      const results = await Promise.all(events.map(processEvent));
      return Object.freeze({
        claimed:events.length,
        processed:results.filter(x=>x==="processed").length,
        retryScheduled:results.filter(x=>x==="retry_scheduled").length,
        failed:results.filter(x=>x==="failed").length,
        leaseLost:results.filter(x=>x==="lease_lost").length,
        workerErrors:results.filter(x=>x==="worker_error").length
      });
    }
  });
}
