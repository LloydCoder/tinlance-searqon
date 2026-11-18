import { createBillingWebhookProcessor } from "./billing-webhook.js";
import { createBillingWebhookStore } from "./billing-webhook-store.js";
import { createBillingWebhookWorker } from "./billing-webhook-worker.js";
import { createBillingSubscriptionReconciler } from "./billing-subscription-reconciler.js";
import { createPaddleProviderAdapter } from "./providers/paddle.js";

/**
 * Assemble the Paddle webhook trust chain. This factory does not create
 * credentials, network resources or background processes. Call it only after
 * the Paddle seller account, price mapping and isolated DB logins are approved.
 */
export function createPaddleBillingRuntime({
  ingestPool,
  workerPool,
  notificationSecret=process.env.PADDLE_NOTIFICATION_SECRET,
  apiKey=process.env.PADDLE_API_KEY,
  environment=process.env.PADDLE_ENVIRONMENT??"sandbox",
  pricePlanMap,
  workerId=process.env.SEARQON_BILLING_WORKER_ID,
  fetchImpl=globalThis.fetch,
  now=()=>new Date()
}={}) {
  if(typeof workerId!=="string" || workerId.trim().length<3) {
    throw new TypeError("A dedicated Paddle billing worker identity is required.");
  }
  if(!pricePlanMap || typeof pricePlanMap!=="object" || Array.isArray(pricePlanMap) || Object.keys(pricePlanMap).length===0) {
    throw new TypeError("An explicit Paddle price-to-plan mapping is required.");
  }
  const adapter=createPaddleProviderAdapter({
    notificationSecret,apiKey,environment,pricePlanMap,fetchImpl,now
  });
  const store=createBillingWebhookStore({ingestPool,workerPool,now});
  const processor=createBillingWebhookProcessor({
    adapters:{paddle:adapter},
    persist:event=>store.acceptVerifiedEvent(event),
    now
  });
  const reconciler=createBillingSubscriptionReconciler({
    workerPool,
    adapters:{paddle:adapter}
  });
  const worker=createBillingWebhookWorker({
    store,
    workerId,
    reconcileProviderEvent:(event,context)=>reconciler.reconcile(event,context)
  });
  return Object.freeze({processor,worker,store,adapter});
}
