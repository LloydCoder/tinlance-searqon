import test from "node:test";
import assert from "node:assert/strict";
import { createJobQueue, JobQueueError } from "../src/platform/jobs.js";

function fixture() {
  let connects = 0;
  const pool = { async connect() { connects += 1; throw new Error("database should not be reached"); } };
  return { queue: createJobQueue({ database: { pool } }), connects: () => connects };
}

test("job queue requires a PostgreSQL database pool", () => {
  assert.throws(() => createJobQueue(), /PostgreSQL database pool/);
  assert.throws(() => createJobQueue({ database: { pool: {} } }), /PostgreSQL database pool/);
  assert.throws(() => createJobQueue({ database: { pool: { connect() {} } }, workerRole: "searqon_app" }), /least-privilege worker database role/);
});

test("enqueue validates type, payload safety, payload size, priority and idempotency before database access", async () => {
  const { queue, connects } = fixture();
  const base = {
    jobType: "alert_delivery",
    payload: { alertId: "20000000-0000-4000-8000-000000000001", version: 1 },
    idempotencyKey: "job-idempotency-0001"
  };
  await assert.rejects(queue.enqueue("10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001",{...base,jobType:"unknown"}),
    error => error instanceof JobQueueError && error.code === "invalid_job_type");
  await assert.rejects(queue.enqueue("10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001",{...base,payload:{apiKey:"secret"}}),
    error => error instanceof JobQueueError && error.code === "sensitive_payload_field");
  await assert.rejects(queue.enqueue("10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001",{...base,payload:{data:"x".repeat(17000)}}),
    error => error instanceof JobQueueError && error.code === "payload_too_large");
  await assert.rejects(queue.enqueue("bad-user","20000000-0000-4000-8000-000000000001",base),
    error => error instanceof JobQueueError && error.code === "invalid_user_id");
  await assert.rejects(queue.enqueue("10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001",{...base,priority:101}),
    error => error instanceof JobQueueError && error.code === "invalid_priority");
  await assert.rejects(queue.enqueue("10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001",{...base,idempotencyKey:"short"}),
    error => error instanceof JobQueueError && error.code === "invalid_idempotency_key");
  assert.equal(connects(),0);
});

test("worker operations validate identities, lease bounds and UUID tokens", async () => {
  const { queue, connects } = fixture();
  await assert.rejects(queue.claim("x",{limit:1,leaseSeconds:30}),
    error => error instanceof JobQueueError && error.code === "invalid_worker_id");
  await assert.rejects(queue.claim("worker-node-01",{limit:0,leaseSeconds:30}),
    error => error instanceof JobQueueError && error.code === "invalid_claim_limit");
  await assert.rejects(queue.claim("worker-node-01",{limit:1,leaseSeconds:0}),
    error => error instanceof JobQueueError && error.code === "invalid_lease_seconds");
  await assert.rejects(queue.complete("worker-node-01","bad-id","bad-token"),
    error => error instanceof JobQueueError && error.code === "invalid_job_id");
  await assert.rejects(queue.retry("worker-node-01","20000000-0000-4000-8000-000000000001","bad-token",{errorCode:"invalid"}),
    error => error instanceof JobQueueError && error.code === "invalid_lease_token");
  assert.equal(connects(),0);
});

test("worker methods fail closed when a dedicated worker database pool is not configured", async () => {
  const { queue } = fixture();
  await assert.rejects(queue.claim("worker-node-01"), error => error.code === "worker_unavailable");
  await assert.rejects(queue.complete("worker-node-01","20000000-0000-4000-8000-000000000001","30000000-0000-4000-8000-000000000001"),
    error => error.code === "worker_unavailable");
});


test("claim validates an explicit allowlist of supported job types before database access", async () => {
  const { queue, connects } = fixture();
  const worker = "worker-node-01";
  await assert.rejects(queue.claim(worker,{jobTypes:"alert_delivery"}), error => error.code === "invalid_job_types");
  await assert.rejects(queue.claim(worker,{jobTypes:["unknown"]}), error => error.code === "invalid_job_types");
  await assert.rejects(queue.claim(worker,{jobTypes:["alert_delivery","alert_delivery"]}), error => error.code === "invalid_job_types");
  await assert.rejects(queue.claim(worker,{jobTypes:Array(7).fill("alert_delivery")}), error => error.code === "invalid_job_types");
  assert.equal(connects(),0);
});

test("agent simulation is a supported durable job type", async () => {
  const { queue, connects } = fixture();
  const base = { jobType:"agent_simulation", payload:{version:1,origin:"https://docs.example.test",documents:[],journey:[{action:"discover"}]}, idempotencyKey:"agent-simulation-0001" };
  await assert.rejects(queue.enqueue("10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001",base),
    /database should not be reached/);
  assert.equal(connects(),1);
});
