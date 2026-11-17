import { createJobQueue } from "./jobs.js";
import { createAlertDestinationStore } from "./alert-destinations.js";
import { createAlertSender } from "./alert-sender.js";
import { createAlertDeliveryHandler } from "./alert-delivery-handler.js";
import { createWorkerRunner } from "./worker-runner.js";

export function createAlertDeliveryWorker({
  database,
  workerId,
  encryptionKeyring,
  sender = createAlertSender(),
  concurrency = 2,
  leaseSeconds = 60,
  pollIntervalMs = 1000
} = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A dedicated worker database pool is required.");
  }
  const queue = createJobQueue({ database, workerPool: database.pool });
  const destinationStore = createAlertDestinationStore({
    database,
    workerPool: database.pool,
    encryptionKeyring
  });
  const handler = createAlertDeliveryHandler({ destinationStore, sender });
  return createWorkerRunner({
    queue,
    workerId,
    handlers: { alert_delivery: handler },
    concurrency,
    leaseSeconds,
    pollIntervalMs
  });
}
