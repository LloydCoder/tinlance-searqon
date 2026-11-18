import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerRunner, WorkerRunnerError } from "../src/platform/worker-runner.js";

const job = {
  id:"20000000-0000-4000-8000-000000000001",
  jobType:"alert_delivery",
  payload:{alertId:"30000000-0000-4000-8000-000000000001"},
  attempts:2,
  leaseToken:"40000000-0000-4000-8000-000000000001"
};

function fakeQueue(jobs = [job]) {
  const calls = { claim:[], complete:[], retry:[], extend:[] };
  return {
    calls,
    async claim(workerId, options) { calls.claim.push({workerId,options}); return Array.isArray(options.jobTypes) ? jobs.filter(item => options.jobTypes.includes(item.jobType)) : jobs; },
    async complete(workerId,id,token,options) { calls.complete.push({workerId,id,token,options}); return {accepted:true}; },
    async retry(workerId,id,token,options) { calls.retry.push({workerId,id,token,options}); return {accepted:true,job:{status:"queued"}}; },
    async extendLease(workerId,id,token,options) { calls.extend.push({workerId,id,token,options}); return {extended:true}; }
  };
}

test("worker runner validates its queue, handler registry and bounded execution settings", () => {
  const queue = fakeQueue();
  assert.throws(() => createWorkerRunner(), /queue/);
  assert.throws(() => createWorkerRunner({queue,workerId:"x",handlers:{}}), /worker identity/);
  assert.throws(() => createWorkerRunner({queue,workerId:"worker-node-01",handlers:{unknown:()=>{}}}), /unsupported job type/);
  assert.throws(() => createWorkerRunner({queue,workerId:"worker-node-01",handlers:Object.assign(Object.create({alert_delivery:()=>{}}),{})}), /plain job handler registry/);
  assert.throws(() => createWorkerRunner({queue,workerId:"worker-node-01",handlers:{alert_delivery:()=>{}},concurrency:0}), /concurrency/);
});

test("worker runner executes registered handlers and completes with a digest only", async () => {
  const queue = fakeQueue();
  const runner = createWorkerRunner({
    queue, workerId:"worker-node-01",
    handlers:{alert_delivery:async (item,context) => ({jobId:item.id,signalAborted:context.signal.aborted})}
  });
  const result = await runner.runOnce();
  assert.deepEqual(result,{claimed:1,completed:1,retried:0,failed:0,leaseLost:0,runnerErrors:0});
  assert.equal(queue.calls.claim[0].options.limit,4);
  assert.deepEqual(queue.calls.claim[0].options.jobTypes,["alert_delivery"]);
  assert.equal(queue.calls.complete.length,1);
  assert.match(queue.calls.complete[0].options.resultSha256,/^[a-f0-9]{64}$/);
  assert.equal("result" in queue.calls.complete[0].options,false);
});

test("handler errors use bounded machine error codes and exponential retry delay", async () => {
  const queue = fakeQueue([{...job,attempts:3}]);
  const runner = createWorkerRunner({
    queue, workerId:"worker-node-01", retryBaseSeconds:10, maxRetrySeconds:50,
    handlers:{alert_delivery:async () => { const error = new Error("private error detail"); error.code="upstream_timeout"; throw error; }}
  });
  const result = await runner.runOnce();
  assert.equal(result.retried,1);
  assert.equal(queue.calls.retry[0].options.errorCode,"upstream_timeout");
  assert.equal(queue.calls.retry[0].options.retryDelaySeconds,40);
  assert.equal(JSON.stringify(queue.calls.retry[0]).includes("private error detail"),false);
});

test("workers with no registered handlers claim no jobs", async () => {
  const queue = fakeQueue();
  const runner = createWorkerRunner({queue,workerId:"worker-node-01",handlers:{}});
  const result = await runner.runOnce();
  assert.equal(result.claimed,0);
  assert.equal(result.retried,0);
  assert.deepEqual(queue.calls.claim[0].options.jobTypes,[]);
  assert.equal(queue.calls.retry.length,0);
  assert.equal(queue.calls.complete.length,0);
});

test("worker stops completion when the lease heartbeat is lost", async () => {
  const queue = fakeQueue();
  queue.extendLease = async (...args) => {
    queue.calls.extend.push(args);
    return {extended:false,reason:"lease_lost"};
  };
  const runner = createWorkerRunner({
    queue, workerId:"worker-node-01", leaseSeconds:5,
    handlers:{alert_delivery:async (_item,{signal}) => new Promise(resolve => {
      if (signal.aborted) return resolve("aborted");
      signal.addEventListener("abort",() => resolve("aborted"),{once:true});
    })}
  });
  const result = await runner.runOnce();
  assert.equal(result.leaseLost,1);
  assert.equal(queue.calls.extend.length,1);
  assert.equal(queue.calls.complete.length,0);
  assert.equal(queue.calls.retry.length,0);
});

test("worker loop exits cleanly on AbortSignal", async () => {
  const queue = fakeQueue([]);
  const runner = createWorkerRunner({queue,workerId:"worker-node-01",handlers:{},pollIntervalMs:100});
  const controller = new AbortController();
  const running = runner.run({signal:controller.signal});
  controller.abort();
  const result = await running;
  assert.deepEqual(result,{stopped:true});
});

test("worker runner accepts the dedicated agent_simulation job handler", async () => {
  const simulationJob = {
    ...job,
    jobType:"agent_simulation",
    payload:{version:1,origin:"https://docs.example.test",documents:[],journey:[{action:"discover"}]}
  };
  const queue = fakeQueue([simulationJob]);
  const runner = createWorkerRunner({
    queue,
    workerId:"worker-agent-01",
    handlers:{agent_simulation:async () => ({mode:"read_only_snapshot_simulation"})},
    concurrency:1
  });
  const result = await runner.runOnce();
  assert.deepEqual(result,{claimed:1,completed:1,retried:0,failed:0,leaseLost:0,runnerErrors:0});
  assert.deepEqual(queue.calls.claim[0].options.jobTypes,["agent_simulation"]);
});

test("agent simulation child crashes are retried without completing the job", async () => {
  const simulationJob = {...job,jobType:"agent_simulation"};
  const queue = fakeQueue([simulationJob]);
  const runner = createWorkerRunner({
    queue,
    workerId:"worker-agent-01",
    handlers:{agent_simulation:async () => {
      const error = new Error("child process terminated unexpectedly");
      error.code = "simulation_child_terminated";
      throw error;
    }},
    concurrency:1,
    retryBaseSeconds:5
  });
  const result = await runner.runOnce();
  assert.deepEqual(result,{claimed:1,completed:0,retried:1,failed:0,leaseLost:0,runnerErrors:0});
  assert.equal(queue.calls.retry[0].options.errorCode,"simulation_child_terminated");
  assert.equal(queue.calls.retry[0].options.retryDelaySeconds,10);
  assert.equal(queue.calls.complete.length,0);
});
