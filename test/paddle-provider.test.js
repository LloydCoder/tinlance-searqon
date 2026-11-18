import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createPaddleProviderAdapter } from "../src/platform/providers/paddle.js";

const secret="pdl_ntfset_test_secret_for_unit_tests";
const apiKey="pdl_sdbx_apikey_for_unit_tests";
const organizationId="20000000-0000-4000-8000-000000000001";
const customerId="ctm_01grnn4zta5a1mf02jjze7y2ys";
const subscriptionId="sub_01h04vsc0qhwtsbsxh3422wjs4";
const priceId="pri_01grnn4zta5a1mf02jjze7y2ys";
const now=()=>new Date("2026-11-18T12:00:00.000Z");
const pricePlanMap={[priceId]:"growth"};

function eventEnvelope(overrides={}) {
  return {
    event_id:"evt_01gks14ge726w50ch2tmaw2a1x",
    event_type:"subscription.created",
    occurred_at:"2026-11-18T11:59:59.000Z",
    data:{
      id:subscriptionId,
      transaction_id:"txn_01h04vsc0qhwtsbsxh3422wjs4",
      customer_id:customerId,
      status:"active",
      custom_data:{organization_id:organizationId},
      current_billing_period:{starts_at:"2026-11-01T00:00:00.000Z",ends_at:"2026-12-01T00:00:00.000Z"},
      billing_cycle:{interval:"month",frequency:1},
      items:[{recurring:true,price:{id:priceId},trial_dates:null}],
      scheduled_change:null,
      canceled_at:null
    },
    ...overrides
  };
}

function signedRequest(body,{timestamp=Math.floor(now().getTime()/1000),secretKey=secret}={}) {
  const rawBody=Buffer.from(JSON.stringify(body));
  const signature=createHmac("sha256",secretKey).update(String(timestamp)+":").update(rawBody).digest("hex");
  return {rawBody,headers:{"paddle-signature":`ts=${timestamp};h1=${signature}`}};
}

test("Paddle adapter verifies raw bytes and normalizes subscription events",async()=>{
  const adapter=createPaddleProviderAdapter({notificationSecret:secret,apiKey,pricePlanMap,now});
  const body=eventEnvelope();
  const request=signedRequest(body);
  const result=await adapter.verifyAndParse({...request,receivedAt:"2026-11-18T12:00:00.000Z"});
  assert.equal(result.providerEventId,body.event_id);
  assert.equal(result.eventType,"customer.subscription.created");
  assert.equal(result.providerCreatedAt,"2026-11-18T11:59:59.000Z");
  assert.equal(result.payload.organizationId,organizationId);
  assert.equal(result.payload.plan,"growth");
  assert.equal(result.payload.status,"active");
  assert.equal(result.payload.providerTransactionId,"txn_01h04vsc0qhwtsbsxh3422wjs4");
});

test("Paddle adapter supports multiple h1 signatures during secret rotation",async()=>{
  const adapter=createPaddleProviderAdapter({notificationSecret:secret,apiKey,pricePlanMap,now});
  const body=eventEnvelope();
  const request=signedRequest(body);
  const second=createHmac("sha256","previous-secret-key-for-test").update(String(Math.floor(now().getTime()/1000))+":").update(request.rawBody).digest("hex");
  request.headers["paddle-signature"]+=";h1="+second;
  const result=await adapter.verifyAndParse({...request,receivedAt:"2026-11-18T12:00:00.000Z"});
  assert.equal(result.eventType,"customer.subscription.created");
});

test("Paddle adapter rejects invalid, malformed and stale signatures before parsing",async()=>{
  const adapter=createPaddleProviderAdapter({notificationSecret:secret,apiKey,pricePlanMap,now});
  const request=signedRequest(eventEnvelope());
  await assert.rejects(adapter.verifyAndParse({
    ...request,headers:{"paddle-signature":"ts="+Math.floor(now().getTime()/1000)+";h1="+"0".repeat(64)},
    receivedAt:"2026-11-18T12:00:00.000Z"
  }),error=>error.statusCode===401 && error.code==="signature_invalid");
  const stale=signedRequest(eventEnvelope(),{timestamp:Math.floor(now().getTime()/1000)-6});
  await assert.rejects(adapter.verifyAndParse({...stale,receivedAt:"2026-11-18T12:00:00.000Z"}),
    error=>error.statusCode===401 && error.code==="signature_stale");
  await assert.rejects(adapter.verifyAndParse({
    rawBody:Buffer.from("{"),headers:request.headers,receivedAt:"2026-11-18T12:00:00.000Z"
  }),error=>error.statusCode===401);
});

test("Paddle adapter acknowledges verified non-subscription events without processing them",async()=>{
  const adapter=createPaddleProviderAdapter({notificationSecret:secret,apiKey,pricePlanMap,now});
  const body=eventEnvelope({event_type:"transaction.completed"});
  const request=signedRequest(body);
  const result=await adapter.verifyAndParse({...request,receivedAt:"2026-11-18T12:00:00.000Z"});
  assert.deepEqual(result,{ignored:true,providerEventId:body.event_id});
});

test("Paddle canonical API adapter validates workspace binding and maps subscription status",async()=>{
  let requested;
  const canonical={
    id:subscriptionId,customer_id:customerId,custom_data:{organization_id:organizationId},
    status:"active",billing_cycle:{interval:"month",frequency:1},
    current_billing_period:{starts_at:"2026-11-01T00:00:00.000Z",ends_at:"2026-12-01T00:00:00.000Z"},
    items:[{recurring:true,price:{id:priceId},trial_dates:null}],
    scheduled_change:{action:"cancel"},canceled_at:null
  };
  const adapter=createPaddleProviderAdapter({
    notificationSecret:secret,apiKey,pricePlanMap,now,environment:"sandbox",
    fetchImpl:async(url,options)=>{
      requested={url,options};
      return {ok:true,status:200,text:async()=>JSON.stringify({data:canonical})};
    }
  });
  const snapshot=await adapter.fetchCanonicalSubscription({
    organizationId,provider:"paddle",providerEventId:"evt_01gks14ge726w50ch2tmaw2a1x",
    payload:{providerCustomerId:customerId,providerSubscriptionId:subscriptionId}
  });
  assert.equal(requested.url,"https://sandbox-api.paddle.com/subscriptions/"+subscriptionId);
  assert.equal(requested.options.headers.authorization,"Bearer "+apiKey);
  assert.equal(snapshot.organizationId,organizationId);
  assert.equal(snapshot.plan,"growth");
  assert.equal(snapshot.billingInterval,"month");
  assert.equal(snapshot.cancelAtPeriodEnd,true);
});

test("Paddle canonical API adapter rejects mismatched workspace metadata and unsupported billing intervals",async()=>{
  const canonical={
    id:subscriptionId,customer_id:customerId,custom_data:{organization_id:"20000000-0000-4000-8000-000000000099"},
    status:"active",billing_cycle:{interval:"month",frequency:1},
    current_billing_period:{starts_at:"2026-11-01T00:00:00.000Z",ends_at:"2026-12-01T00:00:00.000Z"},
    items:[{recurring:true,price:{id:priceId}}]
  };
  const adapter=createPaddleProviderAdapter({
    notificationSecret:secret,apiKey,pricePlanMap,now,
    fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({data:canonical})})
  });
  await assert.rejects(adapter.fetchCanonicalSubscription({
    organizationId,providerEventId:"evt_01gks14ge726w50ch2tmaw2a1x",
    payload:{providerCustomerId:customerId,providerSubscriptionId:subscriptionId}
  }),error=>error.code==="provider_binding_invalid");
});


test("Paddle adapter maps paused and trialing states without granting a paid plan to a trial",async()=>{
  const adapter=createPaddleProviderAdapter({notificationSecret:secret,apiKey,pricePlanMap,now});
  const pausedBody=eventEnvelope({
    event_type:"subscription.paused",
    data:{...eventEnvelope().data,status:"paused"}
  });
  const pausedRequest=signedRequest(pausedBody);
  const paused=await adapter.verifyAndParse({...pausedRequest,receivedAt:"2026-11-18T12:00:00.000Z"});
  assert.equal(paused.payload.status,"paused");
  assert.equal(paused.payload.plan,"growth");

  const trialBody=eventEnvelope({
    event_type:"subscription.trialing",
    data:{
      ...eventEnvelope().data,status:"trialing",
      items:[{recurring:true,price:{id:priceId},trial_dates:{starts_at:"2026-11-01T00:00:00.000Z",ends_at:"2026-11-20T00:00:00.000Z"}}]
    }
  });
  const trialRequest=signedRequest(trialBody);
  const trial=await adapter.verifyAndParse({...trialRequest,receivedAt:"2026-11-18T12:00:00.000Z"});
  assert.equal(trial.payload.status,"trialing");
  assert.equal(trial.payload.plan,"trial");
  assert.equal(trial.payload.trialEndsAt,"2026-11-20T00:00:00.000Z");
});

test("Paddle canonical reconciliation rejects unsupported multi-month billing frequencies",async()=>{
  const canonical={
    id:subscriptionId,customer_id:customerId,custom_data:{organization_id:organizationId},
    status:"active",billing_cycle:{interval:"month",frequency:3},
    current_billing_period:{starts_at:"2026-11-01T00:00:00.000Z",ends_at:"2027-02-01T00:00:00.000Z"},
    items:[{recurring:true,price:{id:priceId},trial_dates:null}]
  };
  const adapter=createPaddleProviderAdapter({
    notificationSecret:secret,apiKey,pricePlanMap,now,
    fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({data:canonical})})
  });
  await assert.rejects(adapter.fetchCanonicalSubscription({
    organizationId,providerEventId:"evt_01gks14ge726w50ch2tmaw2a1x",
    payload:{providerCustomerId:customerId,providerSubscriptionId:subscriptionId}
  }),error=>error.code==="provider_interval_unsupported");
});


test("Paddle canonical API adapter rejects oversized provider responses before parsing",async()=>{
  const adapter=createPaddleProviderAdapter({
    notificationSecret:secret,apiKey,pricePlanMap,now,maxResponseBytes:1024,
    fetchImpl:async()=>({
      ok:true,status:200,
      headers:{get:()=> "2048"},
      async text(){assert.fail("oversized response must not be read");}
    })
  });
  await assert.rejects(adapter.fetchCanonicalSubscription({
    organizationId,providerEventId:"evt_01gks14ge726w50ch2tmaw2a1x",
    payload:{providerCustomerId:customerId,providerSubscriptionId:subscriptionId}
  }),error=>error.code==="provider_response_too_large");
});
