import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDatabase } from "./database.js";

const MIGRATIONS_DIRECTORY = resolve(fileURLToPath(new URL("../../db/migrations/", import.meta.url)));
const LOCK_NAMESPACE = 1397049169;
const LOCK_ID = 1;

export async function runMigrations({
  connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  migrationsDirectory = MIGRATIONS_DIRECTORY,
  createDatabaseImpl = createDatabase
} = {}) {
  const database = createDatabaseImpl({ connectionString });
  let client;
  const applied = [];

  try {
    client = await database.pool.connect();
    await client.query("CREATE SCHEMA IF NOT EXISTS searqon");
    await client.query(`
      CREATE TABLE IF NOT EXISTS searqon.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("SELECT pg_advisory_lock($1, $2)", [LOCK_NAMESPACE, LOCK_ID]);

    const files = (await readdir(migrationsDirectory))
      .filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort();

    for (const name of files) {
      const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM searqon.schema_migrations WHERE name = $1",
        [name]
      );

      if (existing.rowCount > 0) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error("Applied migration checksum mismatch: " + name);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        // Migration files are authored with standalone BEGIN/COMMIT wrappers. Strip only
        // those outer statements so the migration and its checksum share this transaction.
        const migrationBody = sql
          .replace(/^\s*BEGIN\s*;\s*/i, "")
          .replace(/\s*COMMIT\s*;\s*$/i, "");
        await client.query(migrationBody);
        await client.query(
          "INSERT INTO searqon.schema_migrations (name, checksum) VALUES ($1, $2)",
          [name, checksum]
        );
        await client.query("COMMIT");
        applied.push(name);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }

    return { applied };
  } finally {
    if (client) {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, LOCK_ID]).catch(() => {});
      client.release();
    }
    await database.close();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  runMigrations()
    .then(result => {
      process.stdout.write(JSON.stringify({ status: "ok", applied: result.applied }) + "\n");
    })
    .catch(error => {
      process.stderr.write("Database migration failed: " + (error?.message ?? "unknown error") + "\n");
      process.exitCode = 1;
    });
}
