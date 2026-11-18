import { createHmac, timingSafeEqual } from "node:crypto";

const PROVIDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLANS=new Set(["starter","growth","agency","business","enterprise"]);
const SUBSCRIPTION_EVENTS=new Map([
  ["subscription.created","customer.subscription.created"],
  ["subscription.updated","customer.subscription.updated"],
  ["subscription.activated","customer.subscription.updated"],
  ["subscription.trialing","customer.subscription.updated"],
  ["subscription.past_due","customer.subscription.updated"],
  ["subscription.paused","customer.subscription.updated"],
  ["subscription.resumed","customer.subscription.updated"],
  ["subscription.canceled","customer.subscription.deleted"]
]);

export class PaddleAdapterError extends Error {
  constructor(statusCode,code,message) {
    super(message);
    this.name="PaddleAdapterError";
    this.statusCode=statusCode;
    this.code=code;
  }
}

function validDate(value) {
  if(typeof value!=="string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function getHeader(headers,name) {
  const key=Object.keys(headers??{}).find(value=>value.toLowerCase()===name);
  const value=key?headers[key]:undefined;
  return typeof value==="string"?value:null;
}

function parseSignature(value) {
  if(!value || value.length>4096) throw new PaddleAdapterError(401,"signature_invalid","The provider signature is invalid.");
  let timestamp;
  const signatures=[];
  for(const part of value.split(";")) {
    const index=part.indexOf("=");
    if(index<1) continue;
    const key=part.slice(0,index).trim();
    const entry=part.slice(index+1).trim();
    if(key==="ts") {
      if(timestamp!==undefined) throw new PaddleAdapterError(401,"signature_invalid","The provider signature is invalid.");
      timestamp=entry;
    } else if(key==="h1") {
      if(/^[a-f0-9]{64}$/i.test(entry)) signatures.push(entry.toLowerCase());
    }
  }
  if(!/^\d{10}$/.test(timestamp??"") || signatures.length===0) {
    throw new PaddleAdapterError(401,"signature_invalid","The provider signature is invalid.");
  }
  return {timestamp:Number(timestamp),signatures};
}

function verifySignature({rawBody,header,secret,now,toleranceSeconds}) {
  if(!Buffer.isBuffer(rawBody) || rawBody.length===0) {
    throw new PaddleAdapterError(400,"invalid_raw_body","The original webhook request bytes are required.");
  }
  if(rawBody.length>256*1024) throw new PaddleAdapterError(413,"payload_too_large","The webhook payload exceeds the configured limit.");
  const parsed=parseSignature(header);
  const clock=now();
  if(!(clock instanceof Date) || !Number.isFinite(clock.getTime())) throw new TypeError("The trusted clock must return a valid Date.");
  if(Math.abs(Math.floor(clock.getTime()/1000)-parsed.timestamp)>toleranceSeconds) {
    throw new PaddleAdapterError(401,"signature_stale","The provider signature is outside the accepted timestamp window.");
  }
  const expected=createHmac("sha256",secret)
    .update(String(parsed.timestamp)+":","utf8")
    .update(rawBody)
    .digest();
  const valid=parsed.signatures.some(signature=>timingSafeEqual(expected,Buffer.from(signature,"hex")));
  if(!valid) throw new PaddleAdapterError(401,"signature_invalid","The provider signature could not be verified.");
}

function parseEvent(rawBody) {
  let event;
  try { event=JSON.parse(rawBody.toString("utf8")); }
  catch { throw new PaddleAdapterError(400,"event_invalid","The signed provider event is not valid JSON."); }
  if(!event || typeof event!=="object" || Array.isArray(event)
    || typeof event.event_id!=="string" || !/^evt_[a-z0-9]{26}$/i.test(event.event_id)
    || typeof event.event_type!=="string" || typeof event.occurred_at!=="string"
    || !event.data || typeof event.data!=="object" || Array.isArray(event.data)) {
    throw new PaddleAdapterError(400,"event_invalid","The signed provider event does not match the expected event envelope.");
  }
  const occurredAt=validDate(event.occurred_at);
  if(!occurredAt) throw new PaddleAdapterError(400,"event_invalid","The provider event timestamp is invalid.");
  return {...event,occurred_at:occurredAt};
}

function mappedPlan(data,pricePlanMap) {
  const recurring=(Array.isArray(data.items)?data.items:[]).filter(item=>item?.recurring===true);
  if(recurring.length!==1 || typeof recurring[0]?.price?.id!=="string") {
    throw new PaddleAdapterError(400,"provider_plan_unmapped","The Paddle subscription must contain exactly one recurring Searqon price.");
  }
  const plan=pricePlanMap[recurring[0].price.id];
  if(!PLANS.has(plan)) throw new PaddleAdapterError(400,"provider_plan_unmapped","The Paddle price is not mapped to a supported Searqon plan.");
  return plan;
}

function periodBounds(data) {
  const start=validDate(data?.current_billing_period?.starts_at);
  const end=validDate(data?.current_billing_period?.ends_at);
  if(!start || !end || Date.parse(end)<=Date.parse(start)) {
    throw new PaddleAdapterError(400,"provider_period_invalid","The Paddle subscription does not contain a valid current billing period.");
  }
  return {start,end};
}

async function readBoundedResponse(response,maxBytes) {
  const declared=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(declared) && declared>maxBytes) {
    throw new PaddleAdapterError(502,"provider_response_too_large","Paddle returned an oversized subscription response.");
  }
  if(response.body && typeof response.body.getReader==="function") {
    const reader=response.body.getReader();
    const chunks=[];
    let size=0;
    try {
      while(true) {
        const {done,value}=await reader.read();
        if(done) break;
        size+=value.byteLength;
        if(size>maxBytes) {
          await reader.cancel().catch(()=>{});
          throw new PaddleAdapterError(502,"provider_response_too_large","Paddle returned an oversized subscription response.");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  const text=await response.text();
  if(Buffer.byteLength(text,"utf8")>maxBytes) {
    throw new PaddleAdapterError(502,"provider_response_too_large","Paddle returned an oversized subscription response.");
  }
  return text;
}

function canonicalSnapshot(data,event,pricePlanMap) {
  if(!data || typeof data!=="object" || data.id!==event.providerSubscriptionId
    || data.customer_id!==event.payload.providerCustomerId
    || data.custom_data?.organization_id!==event.organizationId
    || !UUID.test(data.custom_data?.organization_id??"")) {
    throw new PaddleAdapterError(502,"provider_binding_invalid","The Paddle subscription does not match the verified workspace and customer binding.");
  }
  const status=data.status;
  if(!["active","trialing","past_due","paused","canceled"].includes(status)) {
    throw new PaddleAdapterError(502,"provider_status_unsupported","The Paddle subscription status is not supported.");
  }
  const plan=status==="trialing"?"trial":mappedPlan(data,pricePlanMap);
  const bounds=periodBounds(data);
  const cycle=data.billing_cycle;
  const interval=status==="trialing"?"none":
    cycle?.frequency===1 && cycle.interval==="month"?"month":
    cycle?.frequency===1 && cycle.interval==="year"?"year":null;
  if(!interval) throw new PaddleAdapterError(502,"provider_interval_unsupported","Only monthly and annual Paddle billing intervals are supported.");
  const trialItem=(Array.isArray(data.items)?data.items:[]).find(item=>item?.recurring===true);
  const trialEndsAt=status==="trialing"?validDate(trialItem?.trial_dates?.ends_at):null;
  if(status==="trialing" && (!trialEndsAt || Date.parse(trialEndsAt)<=Date.parse(bounds.start))) {
    throw new PaddleAdapterError(502,"provider_trial_invalid","The Paddle trial period is invalid.");
  }
  const canceledAt=data.canceled_at===null || data.canceled_at===undefined?null:validDate(data.canceled_at);
  if(data.canceled_at!==null && data.canceled_at!==undefined && !canceledAt) {
    throw new PaddleAdapterError(502,"provider_snapshot_invalid","Paddle returned an invalid cancellation timestamp.");
  }
  return {
    organizationId:event.organizationId,
    providerCustomerId:data.customer_id,
    providerSubscriptionId:data.id,
    status,
    plan,
    billingInterval:interval,
    currentPeriodStart:bounds.start,
    currentPeriodEnd:bounds.end,
    trialEndsAt,
    cancelAtPeriodEnd:data.scheduled_change?.action==="cancel",
    canceledAt
  };
}

/**
 * Paddle Billing adapter. It verifies Paddle-Signature over raw bytes, then
 * maps subscription events into Searqon's canonical event contract. Provider
 * API reads are separate and are used for canonical reconciliation.
 */
export function createPaddleProviderAdapter({
  notificationSecret=process.env.PADDLE_NOTIFICATION_SECRET,
  apiKey=process.env.PADDLE_API_KEY,
  environment=process.env.PADDLE_ENVIRONMENT??"sandbox",
  pricePlanMap={},
  fetchImpl=globalThis.fetch,
  now=()=>new Date(),
  signatureToleranceSeconds=5,
  maxResponseBytes=1024*1024
}={}) {
  if(typeof notificationSecret!=="string" || notificationSecret.length<16) {
    throw new TypeError("A Paddle notification destination secret is required.");
  }
  if(!["sandbox","live"].includes(environment)) throw new TypeError("Paddle environment must be sandbox or live.");
  if(!pricePlanMap || typeof pricePlanMap!=="object" || Array.isArray(pricePlanMap)) throw new TypeError("A Paddle price-to-plan map is required.");
  const plans=Object.freeze({...pricePlanMap});
  if(Object.values(plans).some(plan=>!PLANS.has(plan))) throw new TypeError("Paddle price mappings must use supported paid Searqon plans.");
  if(typeof fetchImpl!=="function") throw new TypeError("A fetch implementation is required.");
  if(!Number.isSafeInteger(signatureToleranceSeconds) || signatureToleranceSeconds<1 || signatureToleranceSeconds>300) {
    throw new RangeError("Paddle signature tolerance must be between 1 and 300 seconds.");
  }
  if(!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes<1024 || maxResponseBytes>4*1024*1024) {
    throw new RangeError("Paddle API response limit is invalid.");
  }
  const apiBase=environment==="live"?"https://api.paddle.com":"https://sandbox-api.paddle.com";

  return Object.freeze({
    async verifyAndParse({rawBody,headers,receivedAt}) {
      verifySignature({
        rawBody,header:getHeader(headers,"paddle-signature"),secret:notificationSecret,
        now,toleranceSeconds:signatureToleranceSeconds
      });
      const event=parseEvent(rawBody);
      const canonicalType=SUBSCRIPTION_EVENTS.get(event.event_type);
      if(!canonicalType) {
        return {ignored:true,providerEventId:event.event_id};
      }
      const data=event.data;
      const organizationId=data.custom_data?.organization_id;
      if(typeof organizationId!=="string" || !UUID.test(organizationId)
        || typeof data.customer_id!=="string" || !PROVIDER_ID.test(data.customer_id)
        || typeof data.id!=="string" || !PROVIDER_ID.test(data.id)) {
        throw new PaddleAdapterError(400,"event_invalid","The Paddle subscription event is missing its tenant or subscription binding.");
      }
      const status=data.status;
      if(!["active","trialing","past_due","paused","canceled"].includes(status)) {
        throw new PaddleAdapterError(400,"provider_status_unsupported","The Paddle subscription status is not supported.");
      }
      const plan=status==="trialing"?"trial":mappedPlan(data,plans);
      const bounds=periodBounds(data);
      const trialItem=(Array.isArray(data.items)?data.items:[]).find(item=>item?.recurring===true);
      const trialEndsAt=status==="trialing"?validDate(trialItem?.trial_dates?.ends_at):null;
      return {
        providerEventId:event.event_id,
        eventType:canonicalType,
        verifiedAt:receivedAt,
        providerCreatedAt:event.occurred_at,
        payload:{
          organizationId,
          providerCustomerId:data.customer_id,
          providerSubscriptionId:data.id,
          status,
          plan,
          currentPeriodStart:bounds.start,
          currentPeriodEnd:bounds.end,
          trialEndsAt
        }
      };
    },

    async fetchCanonicalSubscription(event) {
      if(typeof apiKey!=="string" || apiKey.length<16) {
        throw new PaddleAdapterError(503,"provider_api_not_configured","Paddle API credentials are not configured.");
      }
      const subscriptionId=event?.payload?.providerSubscriptionId;
      if(typeof subscriptionId!=="string" || !/^sub_[a-z0-9]{26}$/i.test(subscriptionId)) {
        throw new PaddleAdapterError(400,"provider_subscription_id_invalid","The Paddle subscription identifier is invalid.");
      }
      const response=await fetchImpl(apiBase+"/subscriptions/"+encodeURIComponent(subscriptionId),{
        method:"GET",
        headers:{authorization:"Bearer "+apiKey,accept:"application/json"},
        redirect:"error",
        signal:AbortSignal.timeout(8_000)
      }).catch(()=>{throw new PaddleAdapterError(503,"provider_api_unavailable","Paddle canonical subscription lookup failed.");});
      if(!response.ok) throw new PaddleAdapterError(503,"provider_api_unavailable","Paddle canonical subscription lookup failed.");
      const text=await readBoundedResponse(response,maxResponseBytes).catch(error=>{
        if(error instanceof PaddleAdapterError) throw error;
        throw new PaddleAdapterError(503,"provider_api_unavailable","Paddle canonical subscription lookup failed.");
      });
      let body;
      try { body=JSON.parse(text); }
      catch { throw new PaddleAdapterError(502,"provider_response_invalid","Paddle returned an invalid subscription response."); }
      if(body?.data?.id!==subscriptionId) throw new PaddleAdapterError(502,"provider_response_invalid","Paddle returned a different subscription.");
      return canonicalSnapshot(body.data,event,plans);
    }
  });
}
