import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, withUserTransaction } from "../src/platform/database.js";

function fakeClient({ failCommit = false, failRollback = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql === "COMMIT" && failCommit) throw new Error("commit failed");
      if (sql === "ROLLBACK" && failRollback) throw new Error("rollback failed");
      return { rows: [] };
    },
    release(error) { calls.push({ release: true, error }); }
  };
}

test("database factory requires a PostgreSQL URL and rejects unsupported protocols", () => {
  assert.throws(() => createDatabase({ connectionString: "" }), /DATABASE_URL/);
  assert.throws(() => createDatabase({ connectionString: "mysql://localhost/db" }), /PostgreSQL connection URL/);
});

test("database factory configures bounded pool and requires TLS for non-loopback hosts", () => {
  let options;
  class FakePool {
    constructor(value) { options = value; }
    on() {}
    async end() {}
  }
  const db = createDatabase({
    connectionString: "postgresql://app:secret@db.example.test:5432/searqon",
    PoolImpl: FakePool
  });
  assert.equal(options.max, 10);
  assert.equal(options.connectionTimeoutMillis, 5000);
  assert.equal(options.idleTimeoutMillis, 30000);
  assert.equal(options.statement_timeout, 15000);
  assert.equal(options.query_timeout, 20000);
  assert.equal(options.lock_timeout, 5000);
  assert.equal(options.application_name, "searqon-api");
  assert.equal(options.keepAlive, true);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(typeof db.healthCheck, "function");
  assert.equal(typeof db.close, "function");
});

test("database factory permits plaintext only for loopback development hosts", () => {
  let options;
  class FakePool {
    constructor(value) { options = value; }
    on() {}
    async end() {}
  }
  createDatabase({ connectionString: "postgresql://app:secret@127.0.0.1:5432/searqon", PoolImpl: FakePool });
  assert.equal(options.ssl, false);
});

test("remote database URLs cannot downgrade TLS through sslmode query parameters", () => {
  let options;
  class FakePool {
    constructor(value) { options = value; }
    on() {}
    async end() {}
  }
  createDatabase({
    connectionString: "postgresql://app:secret@db.example.test:5432/searqon?sslmode=disable&sslrootcert=%2Ftmp%2Funtrusted.pem&application_name=custom-client",
    PoolImpl: FakePool
  });
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(options.connectionString.includes("sslmode"), false);
  assert.equal(options.connectionString.includes("sslrootcert"), false);
  assert.equal(options.connectionString.includes("application_name=custom-client"), true);
});

test("loopback database URLs cannot force TLS through connection-string options", () => {
  let options;
  class FakePool {
    constructor(value) { options = value; }
    on() {}
    async end() {}
  }
  createDatabase({
    connectionString: "postgresql://app:secret@localhost:5432/searqon?sslmode=require",
    PoolImpl: FakePool
  });
  assert.equal(options.ssl, false);
  assert.equal(options.connectionString.includes("sslmode"), false);
});

test("remote PostgreSQL TLS accepts an explicitly configured trusted CA", () => {
  let options;
  class FakePool {
    constructor(value) { options = value; }
    on() {}
    async end() {}
  }
  createDatabase({
    connectionString: "postgresql://app:secret@db.example.test:5432/searqon",
    sslCa: "-----BEGIN CERTIFICATE-----\\nexample-root-ca\\n-----END CERTIFICATE-----",
    PoolImpl: FakePool
  });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.match(options.ssl.ca, /BEGIN CERTIFICATE/);
});

test("user transaction sets identity transaction-locally and commits", async () => {
  const client = fakeClient();
  const pool = { async connect() { return client; } };
  const result = await withUserTransaction(pool, "10000000-0000-4000-8000-000000000001", async connection => {
    await connection.query("SELECT 42");
    return "done";
  });
  assert.equal(result, "done");
  assert.deepEqual(client.calls.map(call => call.sql ?? "RELEASE"), [
    "BEGIN",
    "SET LOCAL ROLE searqon_app",
    "SELECT set_config('searqon.user_id', $1, true)",
    "SELECT 42",
    "COMMIT",
    "RELEASE"
  ]);
  assert.deepEqual(client.calls[2].values, ["10000000-0000-4000-8000-000000000001"]);
});

test("user transaction rejects malformed identities before acquiring a connection", async () => {
  let connects = 0;
  await assert.rejects(
    withUserTransaction({ async connect() { connects += 1; } }, "not-a-uuid", async () => {}),
    /valid user UUID/
  );
  assert.equal(connects, 0);
});

test("user transaction rolls back callback failures and preserves the original error", async () => {
  const client = fakeClient();
  const pool = { async connect() { return client; } };
  const failure = new Error("operation failed");
  await assert.rejects(
    withUserTransaction(pool, "10000000-0000-4000-8000-000000000001", async () => { throw failure; }),
    error => error === failure
  );
  assert.equal(client.calls.some(call => call.sql === "ROLLBACK"), true);
  assert.equal(client.calls.at(-1).release, true);
});

test("user transaction destroys a connection when rollback fails", async () => {
  const client = fakeClient({ failRollback: true });
  const pool = { async connect() { return client; } };
  const failure = new Error("operation failed");
  await assert.rejects(
    withUserTransaction(pool, "10000000-0000-4000-8000-000000000001", async () => { throw failure; }),
    error => error === failure
  );
  assert.equal(client.calls.at(-1).release, true);
  assert.match(client.calls.at(-1).error.message, /rollback failed/);
});

test("user transaction destroys a connection when commit fails", async () => {
  const client = fakeClient({ failCommit: true });
  const pool = { async connect() { return client; } };
  await assert.rejects(
    withUserTransaction(pool, "10000000-0000-4000-8000-000000000001", async () => "result"),
    /commit failed/
  );
  assert.equal(client.calls.some(call => call.sql === "ROLLBACK"), true);
  assert.equal(client.calls.at(-1).release, true);
});

test("database factory reports only a safe pool error code", () => {
  let listener;
  let reported;
  class FakePool {
    constructor() {}
    on(event, callback) { if (event === "error") listener = callback; }
    async end() {}
  }
  createDatabase({
    connectionString: "postgresql://app:secret@db.example.test:5432/searqon",
    PoolImpl: FakePool,
    onPoolError: value => { reported = value; }
  });
  listener({ code: "ECONNRESET", message: "password=must-not-be-forwarded" });
  assert.deepEqual(reported, { code: "ECONNRESET" });
});

test("database factory rejects unsafe pool sizes", () => {
  assert.throws(() => createDatabase({
    connectionString: "postgresql://app:secret@localhost:5432/searqon",
    maxConnections: 0
  }), /maxConnections/);
  assert.throws(() => createDatabase({
    connectionString: "postgresql://app:secret@localhost:5432/searqon",
    maxConnections: 51
  }), /maxConnections/);
});
