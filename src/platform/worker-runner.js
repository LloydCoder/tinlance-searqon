import { createHash } from "node:crypto";

const JOB_TYPES = new Set(["assessment","site_crawl","geo_sampling","alert_delivery","scheduled_report"]);
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

export class WorkerRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkerRunnerError";
    this.code = code;
  }
}

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new WorkerRunnerError("invalid_"+name,name+" must be an integer between "+min+" and "+max+".");
  }
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key)+":"+canonicalJson(value[key])).join(",") + "}";
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new WorkerRunnerError("invalid_result","Job handler results must be JSON serializable.");
  return serialized;
}

function resultDigest(result) {
  const serialized = canonicalJson(result === undefined ? {} : result);
  if (Buffer.byteLength(serialized,"utf8") > 65536) {
    throw new WorkerRunnerError("result_too_large","Job handler results must not exceed 64 KiB.");
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && ERROR_CODE.test(error.code) ? error.code : "handler_failed";
}

function sleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort",finish);
      resolve();
    };
    const timer = setTimeout(finish,milliseconds);
    signal?.addEventListener("abort",finish,{once:true});
  });
}

export function createWorkerRunner({
  queue,
  workerId,
  handlers,
  concurrency = 4,
  leaseSeconds = 60,
  pollIntervalMs = 1000,
  retryBaseSeconds = 30,
  maxRetrySeconds = 3600
} = {}) {
  if (!queue || typeof queue.claim !== "function" || typeof queue.complete !== "function"
    || typeof queue.retry !== "function" || typeof queue.extendLease !== "function") {
    throw new TypeError("A durable job queue with claim, complete, retry and extendLease methods is required.");
  }
  if (typeof workerId !== "string" || !WORKER_ID.test(workerId)) {
    throw new TypeError("A valid worker identity is required.");
  }
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)
    || (Object.getPrototypeOf(handlers) !== Object.prototype && Object.getPrototypeOf(handlers) !== null)) {
    throw new TypeError("A plain job handler registry is required.");
  }
  for (const [jobType, handler] of Object.entries(handlers)) {
    if (!JOB_TYPES.has(jobType)) throw new TypeError("The worker handler registry contains an unsupported job type.");
    if (typeof handler !== "function") throw new TypeError("Every registered job handler must be a function.");
  }
  integer(concurrency,"concurrency",1,20);
  integer(leaseSeconds,"lease_seconds",5,3600);
  integer(pollIntervalMs,"poll_interval_ms",100,60000);
  integer(retryBaseSeconds,"retry_base_seconds",1,3600);
  integer(maxRetrySeconds,"max_retry_seconds",1,86400);

  async function retryJob(job, errorCode) {
    const exponent = Math.min(10,Math.max(0,job.attempts - 1));
    const retryDelaySeconds = Math.min(maxRetrySeconds,retryBaseSeconds * (2 ** exponent));
    const result = await queue.retry(workerId,job.id,job.leaseToken,{errorCode,retryDelaySeconds});
    if (!result.accepted) return {status:"leaseLost"};
    return {status:result.job?.status === "failed" ? "failed" : "retried"};
  }

  async function processJob(job) {
    const handler = Object.hasOwn(handlers,job.jobType) ? handlers[job.jobType] : null;
    if (!handler) {
      try { return await retryJob(job,"handler_unavailable"); }
      catch { return {status:"runnerError"}; }
    }

    const controller = new AbortController();
    let heartbeatBusy = false;
    let heartbeatPromise = Promise.resolve();
    const heartbeatMs = Math.max(1000,Math.floor(leaseSeconds * 1000 / 3));
    const heartbeat = setInterval(() => {
      if (heartbeatBusy || controller.signal.aborted) return;
      heartbeatBusy = true;
      heartbeatPromise = heartbeatPromise.then(async () => {
        const result = await queue.extendLease(workerId,job.id,job.leaseToken,{leaseSeconds});
        if (!result.extended) controller.abort();
      }).catch(() => controller.abort()).finally(() => { heartbeatBusy = false; });
    },heartbeatMs);

    try {
      const result = await handler(job,{workerId,signal:controller.signal});
      clearInterval(heartbeat);
      await heartbeatPromise;
      if (controller.signal.aborted) return {status:"leaseLost"};
      const completed = await queue.complete(workerId,job.id,job.leaseToken,{resultSha256:resultDigest(result)});
      return {status:completed.accepted ? "completed" : "leaseLost"};
    } catch (error) {
      clearInterval(heartbeat);
      await heartbeatPromise;
      if (controller.signal.aborted) return {status:"leaseLost"};
      try { return await retryJob(job,safeErrorCode(error)); }
      catch { return {status:"runnerError"}; }
    }
  }

  async function runOnce() {
    const jobs = await queue.claim(workerId,{limit:concurrency,leaseSeconds});
    const results = await Promise.all(jobs.map(processJob));
    return {
      claimed:jobs.length,
      completed:results.filter(result => result.status === "completed").length,
      retried:results.filter(result => result.status === "retried").length,
      failed:results.filter(result => result.status === "failed").length,
      leaseLost:results.filter(result => result.status === "leaseLost").length,
      runnerErrors:results.filter(result => result.status === "runnerError").length
    };
  }

  return Object.freeze({
    runOnce,
    async run({ signal } = {}) {
      while (!signal?.aborted) {
        await runOnce();
        if (!signal?.aborted) await sleep(pollIntervalMs,signal);
      }
      return {stopped:true};
    }
  });
}
