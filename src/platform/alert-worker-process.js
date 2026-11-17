import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDatabase } from "./database.js";
import { createAlertDeliveryWorker } from "./alert-worker.js";

const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export class AlertWorkerProcessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AlertWorkerProcessError";
    this.code = code;
  }
}

function boundedEnvInteger(value, fallback, name, minimum, maximum) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new AlertWorkerProcessError("invalid_" + name, "The alert worker " + name + " setting is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AlertWorkerProcessError("invalid_" + name, "The alert worker " + name + " setting is outside its allowed range.");
  }
  return parsed;
}

function parseKeyring(raw) {
  if (typeof raw !== "string" || raw.length === 0 || Buffer.byteLength(raw, "utf8") > 16384) {
    throw new AlertWorkerProcessError("keyring_required", "The alert destination encryption keyring is required.");
  }
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new AlertWorkerProcessError("invalid_keyring", "The alert destination encryption keyring is not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.currentVersion !== "string" || !KEY_VERSION.test(value.currentVersion)
    || !value.keys || typeof value.keys !== "object" || Array.isArray(value.keys)
    || !Object.hasOwn(value.keys, value.currentVersion)) {
    throw new AlertWorkerProcessError("invalid_keyring", "The alert destination encryption keyring structure is invalid.");
  }
  const versions = Object.keys(value.keys);
  if (versions.length < 1 || versions.length > 10) {
    throw new AlertWorkerProcessError("invalid_keyring", "The alert destination keyring must contain between one and ten key versions.");
  }
  const keys = Object.create(null);
  for (const version of versions) {
    const encoded = value.keys[version];
    if (!KEY_VERSION.test(version) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
      throw new AlertWorkerProcessError("invalid_keyring", "An alert destination encryption key has an invalid encoding.");
    }
    const decoded = Buffer.from(encoded, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== encoded) {
      throw new AlertWorkerProcessError("invalid_keyring", "Alert destination encryption keys must be canonical 256-bit base64 values.");
    }
    keys[version] = encoded;
  }
  return Object.freeze({ currentVersion: value.currentVersion, keys: Object.freeze(keys) });
}

export function parseAlertWorkerConfig(env = process.env) {
  const databaseUrl = env?.SEARQON_WORKER_DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new AlertWorkerProcessError("worker_database_url_required", "SEARQON_WORKER_DATABASE_URL must be configured.");
  }
  let parsedUrl;
  try { parsedUrl = new URL(databaseUrl); }
  catch { throw new AlertWorkerProcessError("invalid_worker_database_url", "The alert worker database URL is invalid."); }
  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !parsedUrl.hostname || parsedUrl.pathname === "/") {
    throw new AlertWorkerProcessError("invalid_worker_database_url", "The alert worker database URL must be a PostgreSQL URL with a host and database name.");
  }
  const workerId = env.SEARQON_WORKER_ID;
  if (typeof workerId !== "string" || !WORKER_ID.test(workerId)) {
    throw new AlertWorkerProcessError("invalid_worker_id", "SEARQON_WORKER_ID must be a valid stable worker identity.");
  }
  const encryptionKeyring = parseKeyring(env.SEARQON_ALERT_DESTINATION_KEYRING_JSON);
  return Object.freeze({
    databaseUrl,
    workerId,
    encryptionKeyring,
    concurrency: boundedEnvInteger(env.SEARQON_WORKER_CONCURRENCY, 2, "worker_concurrency", 1, 10),
    pollIntervalMs: boundedEnvInteger(env.SEARQON_WORKER_POLL_MS, 1000, "worker_poll_ms", 100, 60000)
  });
}

export async function assertAlertWorkerRole(pool, workerId) {
  if (!pool || typeof pool.connect !== "function") {
    throw new AlertWorkerProcessError("worker_database_unavailable", "A dedicated worker database pool is required.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE searqon_worker");
    await client.query("SELECT set_config('searqon.worker_id',$1,true)", [workerId]);
    const result = await client.query(
      `SELECT
        has_table_privilege(current_user,'searqon.jobs','SELECT') AS "jobsSelect",
        (SELECT bool_and(has_column_privilege(current_user,'searqon.jobs',column_name,'UPDATE'))
         FROM unnest(ARRAY['status','attempts','scheduled_at','lease_owner','lease_token','lease_expires_at','finished_at','result_sha256','last_error_code','updated_at']) AS column_name) AS "jobsUpdate",
        has_table_privilege(current_user,'searqon.job_events','SELECT') AS "eventsSelect",
        has_table_privilege(current_user,'searqon.job_events','INSERT') AS "eventsInsert",
        has_sequence_privilege(current_user,'searqon.job_events_id_seq','USAGE') AS "eventsSequence",
        has_table_privilege(current_user,'searqon.alert_destinations','SELECT') AS "destinationsSelect",
        has_table_privilege(current_user,'searqon.geo_alert_events','SELECT') AS "alertEventsSelect",
        has_table_privilege(current_user,'searqon.alert_delivery_outbox','SELECT') AS "outboxSelect",
        (SELECT bool_and(has_column_privilege(current_user,'searqon.alert_delivery_outbox',column_name,'UPDATE'))
         FROM unnest(ARRAY['status','provider_receipt_id','last_error_code','delivered_at','updated_at']) AS column_name) AS "outboxUpdate"`
    );
    const privileges = result.rows?.[0];
    if (!privileges || Object.values(privileges).some(value => value !== true)) {
      throw new AlertWorkerProcessError("worker_privileges_missing", "The configured database login lacks required alert worker privileges.");
    }
    return true;
  } catch (error) {
    if (error instanceof AlertWorkerProcessError) throw error;
    throw new AlertWorkerProcessError("worker_role_unavailable", "The configured database login cannot assume the restricted alert worker role.");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

function safeCode(error) {
  return typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : "worker_cycle_failed";
}

function sleep(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolveSleep => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolveSleep();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function runAlertWorker({
  env = process.env,
  signal,
  createDatabaseImpl = createDatabase,
  createWorkerImpl = createAlertDeliveryWorker,
  logger = console
} = {}) {
  const config = parseAlertWorkerConfig(env);
  const database = await createDatabaseImpl({
    connectionString: config.databaseUrl,
    maxConnections: config.concurrency * 2 + 2,
    onPoolError: event => logger.error?.({ event: "alert_worker_database_pool_error", code: safeCode(event) })
  });
  try {
    if (!await database.healthCheck()) {
      throw new AlertWorkerProcessError("worker_database_unavailable", "The alert worker database health check failed.");
    }
    await assertAlertWorkerRole(database.pool, config.workerId);
    const runner = createWorkerImpl({
      database,
      workerId: config.workerId,
      encryptionKeyring: config.encryptionKeyring,
      concurrency: config.concurrency,
      pollIntervalMs: config.pollIntervalMs
    });
    let consecutiveFailures = 0;
    while (!signal?.aborted) {
      try {
        const stats = await runner.runOnce();
        consecutiveFailures = 0;
        if (stats && stats.claimed > 0) {
          logger.info?.({
            event: "alert_worker_cycle",
            claimed: stats.claimed,
            completed: stats.completed,
            retried: stats.retried,
            failed: stats.failed,
            leaseLost: stats.leaseLost,
            runnerErrors: stats.runnerErrors
          });
        }
        if (!signal?.aborted && (!stats || stats.claimed === 0)) {
          await sleep(config.pollIntervalMs, signal);
        }
      } catch (error) {
        consecutiveFailures = Math.min(consecutiveFailures + 1, 8);
        logger.error?.({ event: "alert_worker_cycle_failed", code: safeCode(error) });
        if (!signal?.aborted) await sleep(Math.min(30000, 500 * (2 ** (consecutiveFailures - 1))), signal);
      }
    }
    return { stopped: true };
  } finally {
    await database.close();
  }
}

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await runAlertWorker({ signal: controller.signal });
  } catch (error) {
    console.error({ event: "alert_worker_start_failed", code: safeCode(error) });
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
