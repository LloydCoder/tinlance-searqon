import test from "node:test";
import assert from "node:assert/strict";
import { createPaddleBillingRuntime } from "../src/platform/paddle-billing-runtime.js";

test("Paddle runtime requires isolated database pools, worker identity and explicit price mapping",()=>{
  const ingestPool={async query(){}};
  const workerPool={async connect(){throw new Error("not used during construction");}};
  assert.throws(()=>createPaddleBillingRuntime({
    ingestPool,workerPool,notificationSecret:"pdl_ntfset_unit_secret",
    apiKey:"pdl_sdbx_unit_api_key",workerId:"billing-worker-01"
  }),/price-to-plan mapping/);
  const runtime=createPaddleBillingRuntime({
    ingestPool,workerPool,notificationSecret:"pdl_ntfset_unit_secret",
    apiKey:"pdl_sdbx_unit_api_key",workerId:"billing-worker-01",
    pricePlanMap:{"pri_01grnn4zta5a1mf02jjze7y2ys":"growth"},
    fetchImpl:async()=>{throw new Error("network must not be called during construction");}
  });
  assert.equal(typeof runtime.processor,"function");
  assert.equal(typeof runtime.worker.runOnce,"function");
  assert.equal(typeof runtime.store.acceptVerifiedEvent,"function");
  assert.equal(typeof runtime.adapter.fetchCanonicalSubscription,"function");
});
