import { randomUUID } from "node:crypto";
import { withUserTransaction } from "./database.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLANS=new Set(["starter","growth","agency","business","enterprise"]);
const INTERVALS=new Set(["month","year"]);
const TRANSACTION_ID=/^txn_[a-z0-9]{26}$/i;

export class PaddleCheckoutError extends Error {
  constructor(statusCode,code,message) {
    super(message);
    this.name="PaddleCheckoutError";
    this.statusCode=statusCode;
    this.code=code;
  }
}

function resolveCheckoutUrl(value) {
  let url;
  try { url=new URL(value); }
  catch { throw new TypeError("An approved Paddle checkout return URL is required."); }
  if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError("The Paddle checkout return URL must be a clean HTTPS URL.");
  }
  return url;
}

function parseCheckoutPriceMap(value) {
  if(typeof value==="string") {
    try { value=JSON.parse(value); }
    catch { throw new TypeError("PADDLE_CHECKOUT_PRICE_MAP_JSON must contain valid JSON."); }
  }
  if(!value || typeof value!=="object" || Array.isArray(value)
    || (Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)) {
    throw new TypeError("A Paddle checkout price map is required.");
  }
  const result={};
  for(const [key,priceId] of Object.entries(value)) {
    const match=/^(starter|growth|agency|business|enterprise):(month|year)$/.exec(key);
    if(!match || typeof priceId!=="string" || !/^pri_[a-z0-9]{26}$/i.test(priceId)) {
      throw new TypeError("Paddle checkout price mappings must use plan:interval keys and valid Paddle price IDs.");
    }
    result[key]=priceId;
  }
  if(Object.keys(result).length===0) throw new TypeError("At least one Paddle checkout price mapping is required.");
  return Object.freeze(result);
}

async function readResponse(response,maxBytes=1024*1024) {
  const length=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(length) && length>maxBytes) throw new PaddleCheckoutError(502,"provider_response_too_large","Paddle returned an oversized checkout response.");
  const text=await response.text();
  if(Buffer.byteLength(text,"utf8")>maxBytes) throw new PaddleCheckoutError(502,"provider_response_too_large","Paddle returned an oversized checkout response.");
  try { return JSON.parse(text); }
  catch { throw new PaddleCheckoutError(502,"provider_response_invalid","Paddle returned an invalid checkout response."); }
}

/**
 * Creates hosted Paddle checkout transactions behind a tenant-authorized,
 * locally idempotent intent. Paddle does not receive an idempotency header;
 * an ambiguous network outcome is marked unknown and is never auto-retried.
 */
export function createPaddleCheckoutService({
  database,
  apiKey=process.env.PADDLE_API_KEY,
  environment=process.env.PADDLE_ENVIRONMENT??"sandbox",
  checkoutReturnUrl=process.env.PADDLE_CHECKOUT_RETURN_URL,
  checkoutPriceMap=process.env.PADDLE_CHECKOUT_PRICE_MAP_JSON,
  pricePlanMap=process.env.PADDLE_PRICE_PLAN_MAP_JSON,
  fetchImpl=globalThis.fetch,
  now=()=>new Date()
}={}) {
  if(!database || typeof database.pool?.connect!=="function") throw new TypeError("A Searqon application database is required.");
  if(typeof apiKey!=="string" || apiKey.length<16) throw new TypeError("A Paddle API key is required.");
  if(!["sandbox","live"].includes(environment)) throw new TypeError("Paddle environment must be sandbox or live.");
  if(typeof fetchImpl!=="function") throw new TypeError("A fetch implementation is required.");
  const checkoutBase=resolveCheckoutUrl(checkoutReturnUrl);
  const prices=parseCheckoutPriceMap(checkoutPriceMap);
  let planMap=pricePlanMap;
  if(typeof planMap==="string") {
    try { planMap=JSON.parse(planMap); }
    catch { throw new TypeError("PADDLE_PRICE_PLAN_MAP_JSON must contain valid JSON."); }
  }
  if(!planMap || typeof planMap!=="object" || Array.isArray(planMap)) throw new TypeError("A Paddle price-to-plan map is required.");
  for(const [key,priceId] of Object.entries(prices)) {
    const plan=key.split(":")[0];
    if(planMap[priceId]!==plan) throw new TypeError("Checkout and canonical Paddle price mappings must agree.");
  }
  const apiBase=environment==="live"?"https://api.paddle.com":"https://sandbox-api.paddle.com";

  async function setFailure(userId,intentId,state,errorCode) {
    await withUserTransaction(database,userId,client=>
      client.query("SELECT searqon.fail_billing_checkout_intent($1,$2,$3)",[intentId,state,errorCode])
    );
  }

  return Object.freeze({
    async createCheckout(userId,organizationId,input={}) {
      const plan=input.plan;
      const billingInterval=input.billingInterval;
      const requestId=input.requestId??randomUUID();
      if(typeof userId!=="string" || !UUID.test(userId)
        || typeof organizationId!=="string" || !UUID.test(organizationId)
        || !PLANS.has(plan) || !INTERVALS.has(billingInterval)
        || typeof requestId!=="string" || !UUID.test(requestId)) {
        throw new PaddleCheckoutError(400,"checkout_request_invalid","A valid workspace, plan, billing interval and request ID are required.");
      }
      const priceId=prices[plan+":"+billingInterval];
      if(!priceId || planMap[priceId]!==plan) {
        throw new PaddleCheckoutError(400,"checkout_price_unavailable","The selected plan and billing interval are not configured.");
      }
      const created=await withUserTransaction(database,userId,client=>
        client.query(
          "SELECT * FROM searqon.create_billing_checkout_intent($1,$2,$3,$4)",
          [organizationId,requestId,plan,billingInterval]
        )
      );
      const intent=created.rows?.[0];
      if(!intent) throw new PaddleCheckoutError(503,"checkout_intent_unavailable","The checkout request could not be recorded.");
      if(!intent.is_new) {
        const expired=intent.intent_state==="ready" && intent.expires_at && new Date(intent.expires_at).getTime()<=now().getTime();
        return Object.freeze({
          intentId:intent.intent_id,
          state:expired?"expired":intent.intent_state,
          checkoutUrl:expired?null:intent.checkout_url,
          providerTransactionId:intent.provider_transaction_id??null,
          expiresAt:intent.expires_at??null
        });
      }

      const customData={
        organization_id:organizationId,
        searqon_checkout_intent_id:intent.intent_id,
        searqon_plan:plan,
        searqon_billing_interval:billingInterval
      };
      let response;
      try {
        response=await fetchImpl(apiBase+"/transactions",{
          method:"POST",
          headers:{authorization:"Bearer "+apiKey,"content-type":"application/json",accept:"application/json"},
          body:JSON.stringify({
            items:[{price_id:priceId,quantity:1}],
            collection_mode:"automatic",
            enable_checkout:true,
            checkout:{url:checkoutBase.toString()},
            custom_data:customData
          }),
          redirect:"error",
          signal:AbortSignal.timeout(8_000)
        });
      } catch {
        await setFailure(userId,intent.intent_id,"unknown","provider_request_outcome_unknown");
        return Object.freeze({intentId:intent.intent_id,state:"unknown",checkoutUrl:null,providerTransactionId:null,expiresAt:null});
      }
      if(!response.ok) {
        const state=response.status>=500?"unknown":"failed";
        await setFailure(userId,intent.intent_id,state,state==="unknown"?"provider_request_outcome_unknown":"provider_request_rejected");
        if(state==="unknown") return Object.freeze({intentId:intent.intent_id,state,checkoutUrl:null,providerTransactionId:null,expiresAt:null});
        throw new PaddleCheckoutError(502,"checkout_provider_rejected","Paddle did not accept the checkout request.");
      }

      let body;
      try { body=await readResponse(response); }
      catch {
        await setFailure(userId,intent.intent_id,"unknown","provider_response_unconfirmed");
        return Object.freeze({intentId:intent.intent_id,state:"unknown",checkoutUrl:null,providerTransactionId:null,expiresAt:null});
      }
      const transaction=body?.data;
      const transactionId=transaction?.id;
      let checkoutUrl;
      try {
        checkoutUrl=new URL(transaction?.checkout?.url);
      } catch {}
      const validResponse=TRANSACTION_ID.test(transactionId??"")
        && ["draft","ready"].includes(transaction?.status)
        && transaction?.custom_data?.searqon_checkout_intent_id===intent.intent_id
        && transaction?.custom_data?.organization_id===organizationId
        && checkoutUrl?.protocol==="https:"
        && checkoutUrl?.origin===checkoutBase.origin
        && checkoutUrl?.pathname===checkoutBase.pathname
        && checkoutUrl?.searchParams.get("_ptxn")===transactionId;
      if(!validResponse) {
        await setFailure(userId,intent.intent_id,"unknown","provider_response_unconfirmed");
        return Object.freeze({intentId:intent.intent_id,state:"unknown",checkoutUrl:null,providerTransactionId:null,expiresAt:null});
      }

      const clock=now();
      if(!(clock instanceof Date) || !Number.isFinite(clock.getTime())) {
        await setFailure(userId,intent.intent_id,"unknown","checkout_clock_invalid");
        return Object.freeze({intentId:intent.intent_id,state:"unknown",checkoutUrl:null,providerTransactionId:null,expiresAt:null});
      }
      const expiresAt=new Date(clock.getTime()+30*60*1000);
      const attached=await withUserTransaction(database,userId,client=>
        client.query(
          "SELECT searqon.attach_billing_checkout_transaction($1,$2,$3,$4) AS attached",
          [intent.intent_id,transactionId,checkoutUrl.toString(),expiresAt.toISOString()]
        )
      );
      if(attached.rows?.[0]?.attached!==true) {
        await setFailure(userId,intent.intent_id,"unknown","checkout_persist_failed");
        return Object.freeze({intentId:intent.intent_id,state:"unknown",checkoutUrl:null,providerTransactionId:null,expiresAt:null});
      }
      return Object.freeze({
        intentId:intent.intent_id,
        state:"ready",
        checkoutUrl:checkoutUrl.toString(),
        providerTransactionId:transactionId,
        expiresAt:expiresAt.toISOString()
      });
    }
  });
}
