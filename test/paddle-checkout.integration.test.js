import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPaddleCheckoutService } from "../src/platform/paddle-checkout.js";

const databaseUrl=process.env.DATABASE_URL;
let disposable=false;
if(databaseUrl && process.env.SEARQON_TEST_DATABASE==="1") {
  try {
    const name=decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable=/(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("Paddle checkout creates one tenant-bound transaction and returns the same URL for idempotent retries",{skip:!disposable},async()=>{
  const owner=new Pool({connectionString:databaseUrl});
  const runtime=new Pool({connectionString:process.env.SEARQON_RUNTIME_DATABASE_URL});
  const userId=randomUUID(),organizationId=randomUUID(),requestId=randomUUID();
  const priceId="pri_01grnn4zta5a1mf02jjze7y2ys";
  const transactionId="txn_01h04vsc0qhwtsbsxh3422wjs4";
  const calls=[];
  const service=createPaddleCheckoutService({
    database:{pool:runtime},
    apiKey:"pdl_sdbx_test_api_key_123456",
    environment:"sandbox",
    checkoutReturnUrl:"https://searqon.example.test/billing/checkout/",
    checkoutPriceMap:{"growth:month":priceId},
    pricePlanMap:{[priceId]:"growth"},
    now:()=>new Date(),
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      const request=JSON.parse(options.body);
      return {
        ok:true,status:201,
        headers:{get:()=>null},
        text:async()=>JSON.stringify({data:{
          id:transactionId,status:"draft",custom_data:request.custom_data,
          checkout:{url:"https://searqon.example.test/billing/checkout/?_ptxn="+transactionId}
        }})
      };
    }
  });

  try {
    await owner.query("INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Checkout Owner')",
      [userId,userId+"@paddle-checkout.example.test"]);
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Checkout Workspace',$2)",
      [organizationId,"paddle-checkout-"+userId.replaceAll("-","")]);
    await owner.query("INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner')",
      [organizationId,userId]);

    const first=await service.createCheckout(userId,organizationId,{plan:"growth",billingInterval:"month",requestId});
    assert.equal(first.state,"ready");
    assert.equal(first.providerTransactionId,transactionId);
    assert.equal(first.checkoutUrl,"https://searqon.example.test/billing/checkout/?_ptxn="+transactionId);
    assert.equal(calls.length,1);
    const sent=JSON.parse(calls[0].options.body);
    assert.equal(calls[0].url,"https://sandbox-api.paddle.com/transactions");
    assert.equal(calls[0].options.headers.authorization,"Bearer pdl_sdbx_test_api_key_123456");
    assert.equal(sent.items[0].price_id,priceId);
    assert.equal(sent.custom_data.organization_id,organizationId);
    assert.equal(sent.custom_data.searqon_checkout_intent_id,first.intentId);

    const retry=await service.createCheckout(userId,organizationId,{plan:"growth",billingInterval:"month",requestId});
    assert.equal(retry.state,"ready");
    assert.equal(retry.intentId,first.intentId);
    assert.equal(retry.checkoutUrl,first.checkoutUrl);
    assert.equal(calls.length,1);

    await assert.rejects(
      service.createCheckout(userId,organizationId,{plan:"starter",billingInterval:"month",requestId}),
      error=>error.code==="22023"
    );
    assert.equal(calls.length,1);
  } finally {
    await runtime.end();
    await owner.end();
  }
});

test("Paddle checkout denies non-admin members and does not call the provider",{skip:!disposable},async()=>{
  const owner=new Pool({connectionString:databaseUrl});
  const runtime=new Pool({connectionString:process.env.SEARQON_RUNTIME_DATABASE_URL});
  const ownerId=randomUUID(),viewerId=randomUUID(),organizationId=randomUUID();
  let calls=0;
  const priceId="pri_01grnn4zta5a1mf02jjze7y2ys";
  const service=createPaddleCheckoutService({
    database:{pool:runtime},apiKey:"pdl_sdbx_test_api_key_123456",environment:"sandbox",
    checkoutReturnUrl:"https://searqon.example.test/billing/checkout/",
    checkoutPriceMap:{"growth:month":priceId},pricePlanMap:{[priceId]:"growth"},
    fetchImpl:async()=>{calls++;throw new Error("must not call provider");}
  });
  try {
    await owner.query("INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Checkout Owner'),($3,$4,'Checkout Viewer')",
      [ownerId,ownerId+"@checkout-owner.example.test",viewerId,viewerId+"@checkout-viewer.example.test"]);
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Checkout Role Workspace',$2)",
      [organizationId,"paddle-checkout-role-"+ownerId.replaceAll("-","")]);
    await owner.query("INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'viewer')",
      [organizationId,ownerId,viewerId]);

    await assert.rejects(
      service.createCheckout(viewerId,organizationId,{plan:"growth",billingInterval:"month",requestId:randomUUID()}),
      error=>error.code==="42501"
    );
    assert.equal(calls,0);
  } finally {
    await runtime.end();
    await owner.end();
  }
});

test("Paddle checkout marks ambiguous provider outcomes unknown and never auto-retries them",{skip:!disposable},async()=>{
  const owner=new Pool({connectionString:databaseUrl});
  const runtime=new Pool({connectionString:process.env.SEARQON_RUNTIME_DATABASE_URL});
  const userId=randomUUID(),organizationId=randomUUID(),requestId=randomUUID();
  let calls=0;
  const priceId="pri_01grnn4zta5a1mf02jjze7y2ys";
  const service=createPaddleCheckoutService({
    database:{pool:runtime},apiKey:"pdl_sdbx_test_api_key_123456",environment:"sandbox",
    checkoutReturnUrl:"https://searqon.example.test/billing/checkout/",
    checkoutPriceMap:{"growth:month":priceId},pricePlanMap:{[priceId]:"growth"},
    fetchImpl:async()=>{calls++;throw new Error("network outcome unknown");}
  });
  try {
    await owner.query("INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Checkout Unknown')",
      [userId,userId+"@checkout-unknown.example.test"]);
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Checkout Unknown Workspace',$2)",
      [organizationId,"paddle-checkout-unknown-"+userId.replaceAll("-","")]);
    await owner.query("INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner')",
      [organizationId,userId]);

    const first=await service.createCheckout(userId,organizationId,{plan:"growth",billingInterval:"month",requestId});
    assert.equal(first.state,"unknown");
    const retry=await service.createCheckout(userId,organizationId,{plan:"growth",billingInterval:"month",requestId});
    assert.equal(retry.state,"unknown");
    assert.equal(calls,1);
  } finally {
    await runtime.end();
    await owner.end();
  }
});
