import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBillingDatabasePool } from "./billing-database-pools.js";
import { createPaddleBillingRuntime } from "./paddle-billing-runtime.js";

export function startPaddleBillingWorker({
  environment=process.env,
  logger=message=>process.stdout.write(JSON.stringify(message)+"\n"),
  errorLogger=()=>{}
}={}) {
  if(environment.SEARQON_BILLING_WEBHOOKS_ENABLED!=="true") {
    throw new Error("Paddle billing worker is disabled. Set SEARQON_BILLING_WEBHOOKS_ENABLED=true only after approval.");
  }
  for(const key of [
    "PADDLE_API_KEY","PADDLE_NOTIFICATION_SECRET","PADDLE_PRICE_PLAN_MAP_JSON",
    "SEARQON_BILLING_INGEST_DATABASE_URL","SEARQON_BILLING_WORKER_DATABASE_URL"
  ]) {
    if(typeof environment[key]!=="string" || environment[key].length===0) {
      throw new Error("Paddle billing worker configuration is incomplete.");
    }
  }
  const ingestPool=createBillingDatabasePool(environment.SEARQON_BILLING_INGEST_DATABASE_URL,{role:"ingest"});
  let workerPool;
  try {
    workerPool=createBillingDatabasePool(environment.SEARQON_BILLING_WORKER_DATABASE_URL,{role:"worker"});
    const runtime=createPaddleBillingRuntime({
      ingestPool,workerPool,
      notificationSecret:environment.PADDLE_NOTIFICATION_SECRET,
      apiKey:environment.PADDLE_API_KEY,
      environment:environment.PADDLE_ENVIRONMENT??"sandbox",
      pricePlanMap:environment.PADDLE_PRICE_PLAN_MAP_JSON,
      workerId:environment.SEARQON_BILLING_WORKER_ID
    });

    let stopping=false;
    let timer=null;
    let current=Promise.resolve();
    async function tick() {
      if(stopping) return;
      current=runtime.worker.runOnce().then(result=>{
        if(result.claimed>0) logger({event:"searqon_billing_worker_batch",...result});
      }).catch(()=>{
        errorLogger({event:"searqon_billing_worker_tick_failed"});
      });
      await current;
      if(!stopping) timer=setTimeout(tick,1000);
    }
    void tick();

    async function shutdown() {
      if(stopping) return;
      stopping=true;
      if(timer) clearTimeout(timer);
      await current.catch(()=>{});
      const results=await Promise.allSettled([ingestPool.end(),workerPool.end()]);
      process.exitCode=results.some(result=>result.status==="rejected")?1:0;
    }
    return Object.freeze({shutdown});
  } catch(error) {
    void ingestPool.end().catch(()=>{});
    void workerPool?.end().catch(()=>{});
    throw error;
  }
}

const invokedPath=process.argv[1]?resolve(process.argv[1]):"";
if(invokedPath && pathToFileURL(invokedPath).href===import.meta.url) {
  let worker;
  try {
    worker=startPaddleBillingWorker();
  } catch {
    process.stderr.write("Searqon Paddle billing worker configuration failed.\n");
    process.exitCode=1;
  }
  if(worker) {
    let shuttingDown=false;
    const shutdown=()=>{
      if(shuttingDown) return;
      shuttingDown=true;
      worker.shutdown().then(()=>process.exit(process.exitCode??0));
    };
    process.once("SIGTERM",shutdown);
    process.once("SIGINT",shutdown);
  }
}
