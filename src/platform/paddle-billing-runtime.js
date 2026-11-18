import { createBillingWebhookProcessor } from "./billing-webhook.js";
import { createBillingWebhookStore } from "./billing-webhook-store.js";
import { createBillingWebhookWorker } from "./billing-webhook-worker.js";
import { createBillingSubscriptionReconciler } from "./billing-subscription-reconciler.js";
import { createPaddleProviderAdapter } from "./providers/paddle.js";

function resolvePricePlanMap(value) {
  if(typeof value==="string") {
    try { value=JSON.parse(value); }
    catch { throw new TypeError("PADDLE_PRICE_PLAN_MAP_JSON must contain valid JSON."); }
  }
  if(!value || typeof value!=="object" || Array.isArray(value)
    || (Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)
    || Object.keys(value).length===0) {
    throw new TypeError("An explicit Paddle price-to-plan mapping is required.");
  }
  return value;
}

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
  pricePlanMap=process.env.PADDLE_PRICE_PLAN_MAP_JSON,
  workerId=process.env.SEARQON_BILLING_WORKER_ID,
  fetchImpl=globalThis.fetch,
  now=()=>new Date()
}={}) {
  if(typeof workerId!=="string" || workerId.trim().length<3) {
    throw new TypeError("A dedicated Paddle billing worker identity is required.");
  }
  if(typeof apiKey!=="string" || apiKey.length<16) {
    throw new TypeError("A Paddle API key is required for canonical subscription reconciliation.");
  }
  const resolvedPricePlanMap=resolvePricePlanMap(pricePlanMap);
  const adapter=createPaddleProviderAdapter({
    notificationSecret,apiKey,environment,pricePlanMap:resolvedPricePlanMap,fetchImpl,now
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
