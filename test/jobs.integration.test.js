import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withUserTransaction } from "../src/platform/database.js";
import { createJobQueue } from "../src/platform/jobs.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("durable jobs enforce tenant RLS, idempotency, fenced leases, retries and append-only events", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const runtime = new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL, max: 3 });
  const worker = new Pool({ connectionString: process.env.SEARQON_WORKER_DATABASE_URL, max: 3 });
  const queue = createJobQueue({ database: { pool: runtime }, workerPool: worker });
  const userA = randomUUID();
  const userB = randomUUID();
  const viewer = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const workerId = "worker-node-01";
  const email = id => id + "@jobs.example.test";
  const payload = { alertId: randomUUID(), destinationId: randomUUID(), schemaVersion: 1 };

  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Jobs A'),($3,$4,'Jobs B'),($5,$6,'Jobs Viewer')",
      [userA,email(userA),userB,email(userB),viewer,email(viewer)]
    );
    await owner.query(
      "INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Jobs A',$2),($3,'Jobs B',$4)",
      [orgA,"jobs-"+userA.replaceAll("-",""),orgB,"jobs-"+userB.replaceAll("-","")]
    );
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'viewer')",
      [orgA,userA,orgB,userB,viewer]
    );

    const input = {
      jobType: "alert_delivery", payload, idempotencyKey: "queue-idempotency-0001", priority: 70, maxAttempts: 3
    };
    const first = await queue.enqueue(userA,orgA,input);
    const replay = await queue.enqueue(userA,orgA,input);
    assert.equal(first.job.id,replay.job.id);
    assert.equal(first.idempotentReplay,false);
    assert.equal(replay.idempotentReplay,true);
    await assert.rejects(
      queue.enqueue(userA,orgA,{...input,payload:{...payload,alertId:randomUUID()}}),
      error => error.code === "idempotency_key_conflict"
    );
    await assert.rejects(
      queue.enqueue(viewer,orgA,{...input,idempotencyKey:"viewer-job-denied-01"}),
      error => error.code === "insufficient_role"
    );

    const hidden = await withUserTransaction(runtime,userB,client => client.query(
      "SELECT id FROM searqon.jobs WHERE id = $1",[first.job.id]
    ));
    assert.equal(hidden.rows.length,0);
    await assert.rejects(
      withUserTransaction(runtime,userA,client => client.query(
        "UPDATE searqon.jobs SET priority = 99 WHERE id = $1",[first.job.id]
      )),
      error => error.code === "42501"
    );

    const unmatched = await queue.enqueue(userA,orgA,{
      jobType:"site_crawl",payload:{projectId:randomUUID()},idempotencyKey:"queue-unmatched-0001"
    });
    const claimed = await queue.claim(workerId,{limit:1,leaseSeconds:30,jobTypes:["alert_delivery"]});
    assert.equal(claimed.length,1);
    assert.equal(claimed[0].id,first.job.id);
    assert.equal(claimed[0].status,"leased");
    assert.equal(claimed[0].attempts,1);
    const unmatchedState = await owner.query("SELECT status FROM searqon.jobs WHERE id=$1",[unmatched.job.id]);
    assert.equal(unmatchedState.rows[0].status,"queued");
    assert.equal((await queue.claim("worker-node-02",{limit:1,leaseSeconds:30,jobTypes:["alert_delivery"]})).length,0);
    assert.equal((await queue.complete("worker-node-02",claimed[0].id,claimed[0].leaseToken)).accepted,false);
    assert.equal((await queue.complete(workerId,claimed[0].id,randomUUID())).accepted,false);
    const extended = await queue.extendLease(workerId,claimed[0].id,claimed[0].leaseToken,{leaseSeconds:45});
    assert.equal(extended.extended,true);
    const completed = await queue.complete(workerId,claimed[0].id,claimed[0].leaseToken);
    assert.equal(completed.accepted,true);
    assert.equal(completed.job.status,"succeeded");
    assert.equal((await queue.complete(workerId,claimed[0].id,claimed[0].leaseToken)).accepted,false);

    const retryJob = await queue.enqueue(userA,orgA,{
      jobType:"site_crawl",payload:{projectId:randomUUID()},idempotencyKey:"queue-retry-0001",maxAttempts:2
    });
    const attemptOne = (await queue.claim(workerId,{limit:1,leaseSeconds:30,jobTypes:["site_crawl"]})).find(job => job.id === retryJob.job.id);
    assert.ok(attemptOne);
    const retried = await queue.retry(workerId,attemptOne.id,attemptOne.leaseToken,{errorCode:"upstream_timeout",retryDelaySeconds:0});
    assert.equal(retried.job.status,"queued");
    const attemptTwo = (await queue.claim(workerId,{limit:1,leaseSeconds:30,jobTypes:["site_crawl"]})).find(job => job.id === retryJob.job.id);
    assert.equal(attemptTwo.attempts,2);
    const exhausted = await queue.retry(workerId,attemptTwo.id,attemptTwo.leaseToken,{errorCode:"upstream_timeout",retryDelaySeconds:0});
    assert.equal(exhausted.job.status,"failed");

    const recoveredJob = await queue.enqueue(userA,orgA,{
      jobType:"geo_sampling",payload:{samplingPlanId:randomUUID()},idempotencyKey:"queue-recover-0001",maxAttempts:2
    });
    const firstLease = (await queue.claim(workerId,{limit:1,leaseSeconds:30,jobTypes:["geo_sampling"]})).find(job => job.id === recoveredJob.job.id);
    assert.ok(firstLease);
    await owner.query("UPDATE searqon.jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1",[firstLease.id]);
    const recovered = (await queue.claim(workerId,{limit:1,leaseSeconds:30,jobTypes:["geo_sampling"]})).find(job => job.id === recoveredJob.job.id);
    assert.equal(recovered.attempts,2);
    assert.notEqual(recovered.leaseToken,firstLease.leaseToken);
    assert.equal((await queue.complete(workerId,recovered.id,firstLease.leaseToken)).accepted,false);
    assert.equal((await queue.complete(workerId,recovered.id,recovered.leaseToken)).accepted,true);

    const deadJob = await queue.enqueue(userA,orgA,{
      jobType:"scheduled_report",payload:{reportId:randomUUID()},idempotencyKey:"queue-dead-0001",maxAttempts:1
    });
    const deadLease = (await queue.claim(workerId,{limit:1,leaseSeconds:30,jobTypes:["scheduled_report"]})).find(job => job.id === deadJob.job.id);
    await owner.query("UPDATE searqon.jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1",[deadLease.id]);
    const afterDeadLease = await queue.claim(workerId,{limit:10,leaseSeconds:30,jobTypes:["alert_delivery"]});
    assert.equal(afterDeadLease.some(job => job.id === deadJob.job.id),false);
    const stillExpired = await owner.query("SELECT status FROM searqon.jobs WHERE id=$1",[deadJob.job.id]);
    assert.equal(stillExpired.rows[0].status,"leased");
    await queue.claim(workerId,{limit:10,leaseSeconds:30,jobTypes:["scheduled_report"]});
    const deadState = await owner.query("SELECT status,last_error_code FROM searqon.jobs WHERE id = $1",[deadJob.job.id]);
    assert.equal(deadState.rows[0].status,"failed");
    assert.equal(deadState.rows[0].last_error_code,"max_attempts_exceeded");

    const events = await owner.query("SELECT event_type,actor_kind FROM searqon.job_events WHERE job_id = $1 ORDER BY id",[recoveredJob.job.id]);
    assert.deepEqual(events.rows.map(row => row.event_type),["queued","leased","lease_expired","leased","succeeded"]);
    assert.ok(events.rows.every(row => row.actor_kind === "user" || row.actor_kind === "worker"));
    await assert.rejects(
      owner.query("UPDATE searqon.job_events SET event_type='tampered' WHERE job_id = $1",[first.job.id]),
      error => error.code === "55000"
    );
  } finally {
    await worker.end();
    await runtime.end();
    await owner.end();
  }
});
