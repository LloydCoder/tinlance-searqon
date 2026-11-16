import { Pool } from "pg";

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function connectionOptions(connectionString, maxConnections) {
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new Error("DATABASE_URL must be configured.");
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use a PostgreSQL connection URL.");
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
    throw new Error("DATABASE_URL must include a database host and database name.");
  }

  const loopback = LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  return {
    connectionString,
    max: maxConnections,
    min: 0,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    maxUses: 7_500,
    keepAlive: true,
    application_name: "searqon-api",
    statement_timeout: 15_000,
    query_timeout: 20_000,
    lock_timeout: 5_000,
    // Never disable certificate verification for a remote database.
    ssl: loopback ? false : { rejectUnauthorized: true }
  };
}

export function createDatabase({
  connectionString = process.env.DATABASE_URL,
  PoolImpl = Pool,
  onPoolError = () => {},
  maxConnections = 10
} = {}) {
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 50) {
    throw new RangeError("maxConnections must be an integer between 1 and 50.");
  }
  if (typeof onPoolError !== "function") {
    throw new TypeError("onPoolError must be a function.");
  }

  const pool = new PoolImpl(connectionOptions(connectionString, maxConnections));
  pool.on("error", error => {
    // Do not pass connection strings, SQL, or error messages to the logger.
    onPoolError({ code: typeof error?.code === "string" ? error.code : "database_pool_error" });
  });

  return {
    pool,
    async healthCheck() {
      const result = await pool.query("SELECT 1 AS ok");
      return result.rows?.[0]?.ok === 1;
    },
    async close() {
      await pool.end();
    }
  };
}

/**
 * Run tenant-scoped work in one transaction with transaction-local identity.
 * The user ID must come from an independently authenticated server-side session,
 * never from a request body, URL, header or model/tool output.
 */
export async function withUserTransaction(pool, userId, work) {
  if (typeof userId !== "string" || !USER_ID_PATTERN.test(userId)) {
    throw new TypeError("A valid user UUID is required for a tenant transaction.");
  }
  if (typeof work !== "function") {
    throw new TypeError("Tenant transaction work must be a function.");
  }

  const client = await pool.connect();
  let transactionStarted = false;
  let releaseError;

  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT set_config('searqon.user_id', $1, true)", [userId]);
    const result = await work(client);
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        releaseError = rollbackError;
      }
    } else {
      releaseError = error;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
