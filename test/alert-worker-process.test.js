import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAlertWorkerConfig,
  assertAlertWorkerRole,
  runAlertWorker
} from "../src/platform/alert-worker-process.js";

const keyring = JSON.stringify({
  currentVersion: "v1",
  keys: { v1: Buffer.alloc(32, 7).toString("base64") }
});
const env = {
  SEARQON_WORKER_DATABASE_URL: "postgresql://db.example.test:5432/searqon",
  SEARQON_WORKER_ID: "worker-alerts-01",
  SEARQON_ALERT_DESTINATION_KEYRING_JSON: keyring,
  SEARQON_WORKER_CONCURRENCY: "3",
  SEARQON_WORKER_POLL_MS: "750"
};

test("alert worker config requires isolated DB credentials, identity and a valid keyring", () => {
  const config = parseAlertWorkerConfig(env);
  assert.equal(config.workerId, "worker-alerts-01");
  assert.equal(config.concurrency, 3);
  assert.equal(config.pollIntervalMs, 750);
  assert.equal(config.encryptionKeyring.currentVersion, "v1");
  assert.equal(config.databaseUrl, env.SEARQON_WORKER_DATABASE_URL);
  assert.throws(() => parseAlertWorkerConfig({ ...env, SEARQON_WORKER_DATABASE_URL: undefined }), error => error.code === "worker_database_url_required");
  assert.throws(() => parseAlertWorkerConfig({ ...env, SEARQON_WORKER_ID: "x" }), error => error.code === "invalid_worker_id");
  assert.throws(() => parseAlertWorkerConfig({ ...env, SEARQON_ALERT_DESTINATION_KEYRING_JSON: "not-json" }), error => error.code === "invalid_keyring");
  assert.throws(() => parseAlertWorkerConfig({ ...env, SEARQON_WORKER_DATABASE_URL: "https://example.com" }), error => error.code === "invalid_worker_database_url");
  assert.throws(() => parseAlertWorkerConfig({ ...env, SEARQON_WORKER_CONCURRENCY: "0" }), error => error.code === "invalid_worker_concurrency");
});

test("worker role preflight uses a transaction-local restricted role and checks required privileges", async () => {
  const queries = [];
  const pool = {
    async connect() {
      return {
        async query(sql, params) {
          queries.push({ sql, params });
          if (sql.includes("has_table_privilege")) return { rows: [{
            jobsSelect: true, jobsUpdate: true, eventsSelect: true, eventsInsert: true, eventsSequence: true,
            destinationsSelect: true, alertEventsSelect: true, outboxSelect: true, outboxUpdate: true
          }] };
          return { rows: [] };
        },
        release() {}
      };
    }
  };
  await assertAlertWorkerRole(pool, "worker-alerts-01");
  assert.ok(queries.some(q => q.sql === "SET LOCAL ROLE searqon_worker"));
  assert.ok(queries.some(q => q.sql.includes("set_config('searqon.worker_id'")));
  assert.equal(queries.at(-1).sql, "ROLLBACK");
});

test("worker role preflight fails closed when required table privileges are absent", async () => {
  const pool = {
    async connect() {
      return {
        async query(sql) {
          if (sql.includes("has_table_privilege")) return { rows: [{
            jobsSelect: true, jobsUpdate: false, eventsSelect: true, eventsInsert: true, eventsSequence: true,
            destinationsSelect: true, alertEventsSelect: true, outboxSelect: true, outboxUpdate: true
          }] };
          return { rows: [] };
        },
        release() {}
      };
    }
  };
  await assert.rejects(assertAlertWorkerRole(pool, "worker-alerts-01"), error => error.code === "worker_privileges_missing");
});

test("worker loop closes its database and emits only aggregate safe telemetry", async () => {
  const controller = new AbortController();
  const events = [];
  let closed = false;
  let cycles = 0;
  let workerOptions;
  const database = {
    pool: { async connect() { return { async query(sql) {
      if (sql.includes("has_table_privilege")) return { rows: [{
        jobsSelect: true, jobsUpdate: true, eventsSelect: true, eventsInsert: true, eventsSequence: true,
        destinationsSelect: true, alertEventsSelect: true, outboxSelect: true, outboxUpdate: true
      }] };
      return { rows: [] };
    }, release() {} }; } },
    async healthCheck() { return true; },
    async close() { closed = true; }
  };
  const result = await runAlertWorker({
    env,
    signal: controller.signal,
    createDatabaseImpl: () => database,
    createWorkerImpl: options => {
      workerOptions = options;
      return ({
      async runOnce() {
        cycles++;
        controller.abort();
        return { claimed: 1, completed: 1, retried: 0, failed: 0, leaseLost: 0, runnerErrors: 0 };
      }
    });
    },
    logger: {
      info(value) { events.push(value); },
      error(value) { events.push(value); }
    }
  });
  assert.equal(cycles, 1);
  assert.equal(workerOptions.workerId, "worker-alerts-01");
  assert.equal(workerOptions.concurrency, 3);
  assert.equal(workerOptions.encryptionKeyring.currentVersion, "v1");
  assert.equal(closed, true);
  assert.deepEqual(result, { stopped: true });
  assert.deepEqual(events, [{
    event: "alert_worker_cycle",
    claimed: 1, completed: 1, retried: 0, failed: 0, leaseLost: 0, runnerErrors: 0
  }]);
});
