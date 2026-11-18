import test from "node:test";
import assert from "node:assert/strict";
import { createAgentSimulationService } from "../src/platform/agent-sandbox-service.js";

const userId = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const manifest = {
  version:1,
  origin:"https://docs.example.test",
  documents:[{id:"home",url:"https://docs.example.test/",contentType:"text/html",content:"<title>Docs</title><p>Read-only content</p>"}],
  journey:[{action:"discover"},{action:"read_document",documentId:"home"}]
};

function databaseFixture() {
  const queries = [];
  const row = {
    id:jobId,organization_id:organizationId,created_by:userId,job_type:"agent_simulation",
    payload_version:1,payload:manifest,payload_sha256:"a".repeat(64),status:"queued",
    priority:50,attempts:0,max_attempts:2,scheduled_at:new Date(0),lease_owner:null,
    lease_token:null,lease_expires_at:null,idempotency_key:"agent-simulation-0001",
    result_sha256:null,last_error_code:null,created_at:new Date(0),updated_at:new Date(0),finished_at:null
  };
  const pool = {
    async connect() {
      return {
        async query(sql,params) {
          queries.push({sql,params});
          if (sql.includes("SELECT role FROM searqon.memberships")) return {rows:[{role:"owner"}]};
          if (sql.includes("INSERT INTO searqon.jobs")) return {rows:[row]};
          if (sql.includes("SELECT r.job_id")) return {rows:[{
            job_id:jobId,input_sha256:"a".repeat(64),result_sha256:"b".repeat(64),result:{mode:"read_only_snapshot_simulation"},created_at:new Date(0)
          }]};
          return {rows:[]};
        },
        release() {}
      };
    }
  };
  return {database:{pool},queries};
}

test("agent simulation service validates manifests before durable enqueue", async () => {
  const {database,queries} = databaseFixture();
  const service = createAgentSimulationService({database});
  const result = await service.enqueue(userId,organizationId,manifest,"agent-simulation-0001");
  assert.equal(result.job.jobType,"agent_simulation");
  assert.equal(result.job.payload.origin,manifest.origin);
  assert.equal(result.job.maxAttempts,2);
  assert.ok(queries.some(query=>query.sql.includes("INSERT INTO searqon.jobs")));
  assert.ok(queries.some(query=>query.sql.includes("INSERT INTO searqon.job_events")));
});

test("agent simulation service rejects mutating manifests before database access", async () => {
  const {database,queries} = databaseFixture();
  const service = createAgentSimulationService({database});
  await assert.rejects(
    service.enqueue(userId,organizationId,{...manifest,journey:[{action:"delete_resource"}]},"agent-simulation-0002"),
    error=>error.code==="unsupported_action"
  );
  assert.equal(queries.length,0);
});

test("agent simulation result access validates job identity and uses the authenticated tenant transaction", async () => {
  const {database,queries} = databaseFixture();
  const service = createAgentSimulationService({database});
  await assert.rejects(service.getResult(userId,"not-a-uuid"),error=>error.code==="invalid_job_id");
  assert.equal(queries.length,0);
  const result = await service.getResult(userId,jobId);
  assert.equal(result.job_id,jobId);
  assert.ok(queries.some(query=>query.sql==="SET LOCAL ROLE searqon_app"));
  assert.ok(queries.some(query=>query.sql.includes("j.status='succeeded'")));
});
