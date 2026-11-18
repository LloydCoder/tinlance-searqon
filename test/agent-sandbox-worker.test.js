import test from "node:test";
import assert from "node:assert/strict";
import { createAgentSimulationWorker } from "../src/platform/agent-sandbox-worker.js";

const manifest = {
  version:1,
  origin:"https://docs.example.test",
  documents:[{id:"home",url:"https://docs.example.test/",contentType:"text/html",content:"<title>Example</title>"}],
  journey:[{action:"discover"},{action:"read_document",documentId:"home"}]
};
const job = {
  id:"30000000-0000-4000-8000-000000000001",
  organizationId:"20000000-0000-4000-8000-000000000001",
  createdBy:"10000000-0000-4000-8000-000000000001",
  jobType:"agent_simulation",
  payloadVersion:1,
  payload:manifest,
  payloadSha256:"a".repeat(64),
  status:"leased",
  priority:50,
  attempts:1,
  maxAttempts:2,
  leaseToken:"40000000-0000-4000-8000-000000000001",
  idempotencyKey:"agent-simulation-0001"
};

function workerDatabase() {
  const statements = [];
  const resultRows = [];
  const pool = {
    async connect() {
      return {
        async query(sql,params=[]) {
          statements.push({sql,params});
          if (sql.includes("WITH candidates AS")) return {rows:[{...job,previous_status:"queued",organization_id:job.organizationId,created_by:job.createdBy,job_type:job.jobType,payload_version:1,payload_sha256:job.payloadSha256,max_attempts:2,lease_token:job.leaseToken,lease_owner:"agent-sandbox-01"}]};
          if (sql.includes("SELECT result_sha256 FROM searqon.agent_simulation_results")) return {rows:[]};
          if (sql.includes("INSERT INTO searqon.agent_simulation_results")) {
            resultRows.push(JSON.parse(params[4]));
            return {rows:[]};
          }
          if (sql.includes("UPDATE searqon.jobs") && sql.includes("RETURNING *")) return {rows:[{
            ...job,organization_id:job.organizationId,created_by:job.createdBy,job_type:job.jobType,
            payload_version:1,payload_sha256:job.payloadSha256,max_attempts:2,status:"succeeded",
            lease_owner:null,lease_token:null,lease_expires_at:null,result_sha256:params[3],
            finished_at:new Date(),updated_at:new Date()
          }]};
          return {rows:[]};
        },
        release() {}
      };
    }
  };
  return {database:{pool},statements,resultRows};
}

test("agent simulation worker claims only simulation jobs, persists bounded results and completes fenced lease", async () => {
  const fixture = workerDatabase();
  const worker = createAgentSimulationWorker({
    database:fixture.database,
    workerId:"agent-sandbox-01",
    concurrency:1
  });
  const stats = await worker.runOnce();
  assert.deepEqual(stats,{claimed:1,completed:1,retried:0,failed:0,leaseLost:0,runnerErrors:0});
  assert.ok(fixture.statements.some(item=>item.sql.includes("job_type = ANY") && item.params[3].includes("agent_simulation")));
  assert.ok(fixture.statements.some(item=>item.sql==="SET LOCAL ROLE searqon_agent_worker"));
  assert.equal(fixture.resultRows.length,1);
  assert.equal(fixture.resultRows[0].mode,"read_only_snapshot_simulation");
  assert.equal(fixture.resultRows[0].mutations,"disabled");
  assert.ok(fixture.statements.some(item=>item.sql.includes("UPDATE searqon.jobs") && item.sql.includes("status='succeeded'")));
});
