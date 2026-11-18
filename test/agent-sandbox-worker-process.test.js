import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAgentSandboxWorkerConfig,
  assertAgentSandboxWorkerRole,
  runAgentSandboxWorker
} from "../src/platform/agent-sandbox-worker-process.js";

const env = {
  SEARQON_AGENT_WORKER_DATABASE_URL:"postgresql://worker-db.example.test:5432/searqon",
  SEARQON_AGENT_WORKER_ID:"agent-sandbox-01",
  SEARQON_AGENT_WORKER_CONCURRENCY:"1",
  SEARQON_AGENT_WORKER_POLL_MS:"500"
};

function privilegeRow(overrides = {}) {
  return {
    jobsSelect:true,jobsUpdate:true,eventsSelect:true,eventsInsert:true,eventsSequence:true,
    resultsSelect:true,resultsInsert:true,alertDestinationsRead:false,alertOutboxRead:false,
    databaseCreate:false,schemaCreate:false,
    ...overrides
  };
}

function poolFor(row = privilegeRow()) {
  const calls = [];
  let released = false;
  return {
    calls,
    released:()=>released,
    async connect() {
      return {
        async query(sql) {
          calls.push(sql);
          if (sql.includes("has_table_privilege")) return {rows:[row]};
          return {rows:[]};
        },
        release() { released = true; }
      };
    }
  };
}

test("agent worker config requires a PostgreSQL URL and bounded stable identity", () => {
  const config = parseAgentSandboxWorkerConfig(env);
  assert.equal(config.workerId,"agent-sandbox-01");
  assert.equal(config.concurrency,1);
  assert.equal(config.pollIntervalMs,500);
  assert.throws(()=>parseAgentSandboxWorkerConfig({...env,SEARQON_AGENT_WORKER_DATABASE_URL:"https://example.test"}),error=>error.code==="invalid_worker_database_url");
  assert.throws(()=>parseAgentSandboxWorkerConfig({...env,SEARQON_AGENT_WORKER_ID:"x"}),error=>error.code==="invalid_worker_id");
  assert.throws(()=>parseAgentSandboxWorkerConfig({...env,SEARQON_AGENT_WORKER_CONCURRENCY:"3"}),error=>error.code==="invalid_worker_concurrency");
  assert.throws(()=>parseAgentSandboxWorkerConfig({...env,SEARQON_AGENT_WORKER_DATABASE_URL:undefined}),error=>error.code==="worker_database_url_required");
});

test("agent worker role has queue/result access but no alert secrets or schema creation", async () => {
  const pool = poolFor();
  assert.equal(await assertAgentSandboxWorkerRole(pool),true);
  assert.ok(pool.calls.includes("SET LOCAL ROLE searqon_agent_worker"));
  assert.equal(pool.calls.at(-1),"ROLLBACK");
  assert.equal(pool.released(),true);
});

test("agent worker role preflight fails closed if it can read alert destinations", async () => {
  const pool = poolFor(privilegeRow({alertDestinationsRead:true}));
  await assert.rejects(assertAgentSandboxWorkerRole(pool),error=>error.code==="worker_privileges_invalid");
  assert.equal(pool.released(),true);
});

test("agent worker process verifies role, runs cycles and closes its database", async () => {
  const controller = new AbortController();
  const pool = poolFor();
  let closed = false;
  let workerOptions;
  const database = {
    pool,
    async healthCheck() { return true; },
    async close() { closed = true; }
  };
  const events = [];
  const result = await runAgentSandboxWorker({
    env,
    signal:controller.signal,
    createDatabaseImpl:async options=>{
      assert.equal(options.connectionString,env.SEARQON_AGENT_WORKER_DATABASE_URL);
      return database;
    },
    createWorkerImpl:options=>{
      workerOptions = options;
      return {
        async runOnce() {
          controller.abort();
          return {claimed:1,completed:1,retried:0,failed:0,leaseLost:0,runnerErrors:0};
        }
      };
    },
    logger:{info:value=>events.push(value),error:value=>events.push(value)}
  });
  assert.deepEqual(result,{stopped:true});
  assert.equal(workerOptions.workerId,env.SEARQON_AGENT_WORKER_ID);
  assert.equal(workerOptions.concurrency,1);
  assert.equal(closed,true);
  assert.deepEqual(events,[{
    event:"agent_simulation_worker_cycle",
    claimed:1,completed:1,retried:0,failed:0,leaseLost:0,runnerErrors:0
  }]);
});
