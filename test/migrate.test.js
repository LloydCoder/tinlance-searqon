import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runMigrations } from "../src/platform/migrate.js";

async function withMigrations(files, run) {
  const directory = await mkdtemp(join(tmpdir(), "searqon-migrations-"));
  try {
    await mkdir(directory, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(directory, name), content, "utf8");
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function fakeDatabase({ existing = new Map(), failOnSql } = {}) {
  const calls = [];
  let closed = false;
  let released = false;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT checksum FROM searqon.schema_migrations")) {
        const name = values[0];
        return existing.has(name) ? { rowCount: 1, rows: [{ checksum: existing.get(name) }] } : { rowCount: 0, rows: [] };
      }
      if (failOnSql && sql.includes(failOnSql)) throw new Error("migration SQL failed");
      return { rowCount: 0, rows: [] };
    },
    release() { released = true; }
  };
  const database = {
    pool: { async connect() { return client; } },
    async close() { closed = true; }
  };
  return { database, calls, isClosed: () => closed, isReleased: () => released };
}

test("migration runner applies sorted SQL files and records checksums transactionally", async () => {
  await withMigrations({
    "0002_second.sql": "SELECT 2;",
    "0001_first.sql": "SELECT 1;",
    "README.md": "ignored"
  }, async directory => {
    const fake = fakeDatabase();
    const result = await runMigrations({
      connectionString: "postgresql://migration:secret@localhost/searqon",
      migrationsDirectory: directory,
      createDatabaseImpl: () => fake.database
    });
    assert.deepEqual(result.applied, ["0001_first.sql", "0002_second.sql"]);
    const statements = fake.calls.map(call => call.sql);
    assert.ok(statements.indexOf("BEGIN") < statements.indexOf("SELECT 1;"));
    assert.ok(statements.indexOf("SELECT 1;") < statements.findIndex(sql => sql.includes("INSERT INTO searqon.schema_migrations")));
    assert.equal(statements.filter(sql => sql === "COMMIT").length, 2);
    assert.equal(fake.isReleased(), true);
    assert.equal(fake.isClosed(), true);
  });
});

test("migration runner skips matching checksums", async () => {
  const sql = "SELECT 1;";
  const checksum = createHash("sha256").update(sql).digest("hex");
  await withMigrations({ "0001_first.sql": sql }, async directory => {
    const fake = fakeDatabase({ existing: new Map([["0001_first.sql", checksum]]) });
    const result = await runMigrations({ migrationsDirectory: directory, createDatabaseImpl: () => fake.database });
    assert.deepEqual(result.applied, []);
    assert.equal(fake.calls.some(call => call.sql === sql), false);
  });
});

test("migration runner refuses to silently change an applied migration", async () => {
  await withMigrations({ "0001_first.sql": "SELECT 1;" }, async directory => {
    const fake = fakeDatabase({ existing: new Map([["0001_first.sql", "0".repeat(64)]]) });
    await assert.rejects(
      runMigrations({ migrationsDirectory: directory, createDatabaseImpl: () => fake.database }),
      /checksum mismatch/
    );
    assert.equal(fake.isReleased(), true);
    assert.equal(fake.isClosed(), true);
  });
});

test("migration runner rolls back failed migrations and closes resources", async () => {
  await withMigrations({ "0001_first.sql": "SELECT fail_migration;" }, async directory => {
    const fake = fakeDatabase({ failOnSql: "fail_migration" });
    await assert.rejects(
      runMigrations({ migrationsDirectory: directory, createDatabaseImpl: () => fake.database }),
      /migration SQL failed/
    );
    assert.ok(fake.calls.some(call => call.sql === "ROLLBACK"));
    assert.equal(fake.isReleased(), true);
    assert.equal(fake.isClosed(), true);
  });
});


test("migration runner strips file transaction wrappers so schema and checksum commit atomically", async () => {
  const migration = "BEGIN;\nSELECT 1;\nCOMMIT;";
  await withMigrations({ "0001_wrapped.sql": migration }, async directory => {
    const fake = fakeDatabase();
    await runMigrations({ migrationsDirectory: directory, createDatabaseImpl: () => fake.database });
    const statements = fake.calls.map(call => call.sql);
    assert.equal(statements.includes(migration), false);
    assert.ok(statements.includes("SELECT 1;"));
    assert.equal(statements.filter(sql => sql === "BEGIN").length, 1);
    assert.equal(statements.filter(sql => sql === "COMMIT").length, 1);
  });
});
