import { AlertDispatchError } from "./alert-sender.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const TERMINAL = new Set(["delivered", "failed", "cancelled"]);

export class AlertDeliveryHandlerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AlertDeliveryHandlerError";
    this.code = code;
  }
}

function requireJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)
    || typeof job.id !== "string" || !UUID.test(job.id)
    || typeof job.leaseToken !== "string" || !UUID.test(job.leaseToken)
    || !job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)
    || typeof job.payload.deliveryId !== "string" || !UUID.test(job.payload.deliveryId)
    || !Number.isSafeInteger(job.attempts) || job.attempts < 1
    || !Number.isSafeInteger(job.maxAttempts) || job.maxAttempts < 1 || job.attempts > job.maxAttempts) {
    throw new AlertDeliveryHandlerError("invalid_job", "A valid lease-bound alert delivery job is required.");
  }
  return job;
}

export function createAlertDeliveryHandler({ destinationStore, sender } = {}) {
  if (!destinationStore
    || typeof destinationStore.getDelivery !== "function"
    || typeof destinationStore.markDelivered !== "function"
    || typeof destinationStore.markCancelled !== "function"
    || typeof destinationStore.markFailed !== "function") {
    throw new TypeError("A lease-fenced alert destination store is required.");
  }
  if (!sender || typeof sender.send !== "function") {
    throw new TypeError("A secure provider alert sender is required.");
  }

  return async function handleAlertDelivery(input, { workerId, signal } = {}) {
    const job = requireJob(input);
    const deliveryId = job.payload.deliveryId;
    const delivery = await destinationStore.getDelivery(workerId, deliveryId, job.id, job.leaseToken);
    if (!delivery) throw new AlertDeliveryHandlerError("delivery_unavailable", "The leased alert delivery is no longer available.");

    if (delivery.alreadyTerminal || (TERMINAL.has(delivery.status) && delivery.status !== "cancelled")) {
      return { status: delivery.status, alreadyTerminal: true };
    }

    if (delivery.status === "cancelled") {
      const cancelled = await destinationStore.markCancelled(workerId, deliveryId, job.id, job.leaseToken);
      if (!cancelled.accepted) throw new AlertDeliveryHandlerError("lease_lost", "The alert delivery lease was lost before cancellation.");
      return { status: "cancelled" };
    }

    if (delivery.status !== "queued" || !delivery.destination
      || !["slack", "teams", "pagerduty"].includes(delivery.destination.channel)
      || typeof delivery.destination.secret !== "string"
      || typeof delivery.eventId !== "string" || !UUID.test(delivery.eventId)
      || !delivery.eventPayload || typeof delivery.eventPayload !== "object" || Array.isArray(delivery.eventPayload)) {
      throw new AlertDeliveryHandlerError("invalid_delivery", "The leased alert delivery record is incomplete or invalid.");
    }

    try {
      const result = await sender.send({
        channel: delivery.destination.channel,
        secret: delivery.destination.secret,
        event: { eventId: delivery.eventId, payload: delivery.eventPayload },
        signal
      });
      if (result?.accepted !== true) {
        throw new AlertDispatchError(502, "provider_rejected", "The alert provider did not confirm acceptance.");
      }
      const marked = await destinationStore.markDelivered(
        workerId, deliveryId, job.id, job.leaseToken,
        { providerReceiptId: result.providerReceiptId ?? null }
      );
      if (!marked.accepted) throw new AlertDeliveryHandlerError("lease_lost", "The alert delivery lease was lost before completion.");
      return { status: "delivered" };
    } catch (error) {
      if (job.attempts >= job.maxAttempts && !(error instanceof AlertDeliveryHandlerError && error.code === "lease_lost")) {
        const errorCode = typeof error?.code === "string" && ERROR_CODE.test(error.code) ? error.code : "provider_failed";
        const marked = await destinationStore.markFailed(
          workerId, deliveryId, job.id, job.leaseToken, { errorCode }
        );
        if (!marked.accepted) throw new AlertDeliveryHandlerError("lease_lost", "The alert delivery lease was lost before failure could be recorded.");
      }
      throw error;
    }
  };
}
