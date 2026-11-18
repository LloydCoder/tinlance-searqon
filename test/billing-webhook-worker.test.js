import test from "node:test";
import assert from "node:assert/strict";
import { createBillingWebhookWorker } from "../src/platform/billing-webhook-worker.js";

function event(id,attempt=1) {
  return {id,leaseToken:"20000000-0000-4000-8000-000000000001",attempt};
}

test("billing worker completes only after canonical provider reconciliation", async () => {
  const completed=[];
  let reconciled=0;
  const store={
    async claim(){return [event("20000000-0000-4000-8000-000000000002")];},
    async complete(worker,id,token){completed.push({worker,id,token});return {accepted:true};},
    async retry(){assert.fail("successful reconciliation must not retry");}
  };
  const worker=createBillingWebhookWorker({
    store,workerId:"billing-worker-001",
    async reconcileProviderEvent(item,context){
      reconciled+=1;
      assert.equal(item.id,"20000000-0000-4000-8000-000000000002");
      assert.equal(context.workerId,"billing-worker-001");
      return {reconciled:true,source:"provider-canonical-api"};
    }
  });
  assert.deepEqual(await worker.runOnce(),{
    claimed:1,processed:1,retryScheduled:0,failed:0,leaseLost:0,workerErrors:0
  });
  assert.equal(reconciled,1);
  assert.equal(completed.length,1);
});

test("billing worker retries incomplete provider reconciliation with bounded exponential delay", async () => {
  const retries=[];
  const store={
    async claim(){return [event("20000000-0000-4000-8000-000000000003",3)];},
    async complete(){assert.fail("incomplete reconciliation must not complete");},
    async retry(worker,id,token,options){retries.push(options);return {accepted:true,exhausted:false};}
  };
  const worker=createBillingWebhookWorker({
    store,workerId:"billing-worker-002",retryBaseSeconds:20,maxRetrySeconds:100,
    async reconcileProviderEvent(){return {reconciled:false};}
  });
  assert.deepEqual(await worker.runOnce(),{
    claimed:1,processed:0,retryScheduled:1,failed:0,leaseLost:0,workerErrors:0
  });
  assert.deepEqual(retries,[{errorCode:"provider_reconciliation_incomplete",retryDelaySeconds:80}]);
});

test("billing worker treats lost lease as a fenced outcome and does not claim processing", async () => {
  const store={
    async claim(){return [event("20000000-0000-4000-8000-000000000004")];},
    async complete(){return {accepted:false};},
    async retry(){assert.fail("successful provider reconciliation must not retry after a lost completion lease");}
  };
  const worker=createBillingWebhookWorker({
    store,workerId:"billing-worker-003",
    async reconcileProviderEvent(){return {reconciled:true};}
  });
  assert.deepEqual(await worker.runOnce(),{
    claimed:1,processed:0,retryScheduled:0,failed:0,leaseLost:1,workerErrors:0
  });
});
