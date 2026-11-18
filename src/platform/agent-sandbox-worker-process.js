import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createDatabase } from "./database.js";
import { createAgentSimulationWorker } from "./agent-sandbox-worker.js";

const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;

export class AgentSandboxWorkerProcessError extends Error {
  constructor(code,message) {
    super(message);
    this.name = "AgentSandboxWorkerProcessError";
    this.code = code;
  }
}

function boundedInteger(value,fallback,name,min,max) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new AgentSandboxWorkerProcessError("invalid_"+name,"The agent simulation worker "+name+" setting is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new AgentSandboxWorkerProcessError("invalid_"+name,"The agent simulation worker "+name+" setting is outside its allowed range.");
  }
  return parsed;
}

export function parseAgentSandboxWorkerConfig(env = process.env) {
  const databaseUrl = env?.SEARQON_AGENT_WORKER_DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new AgentSandboxWorkerProcessError("worker_database_url_required","SEARQON_AGENT_WORKER_DATABASE_URL must be configured.");
  }
  let parsedUrl;
  try { parsedUrl = new URL(databaseUrl); }
  catch { throw new AgentSandboxWorkerProcessError("invalid_worker_database_url","The agent simulation worker database URL is invalid."); }
  if (!["postgres:","postgresql:"].includes(parsedUrl.protocol) || !parsedUrl.hostname || parsedUrl.pathname === "/") {
    throw new AgentSandboxWorkerProcessError("invalid_worker_database_url","The agent simulation worker database URL must be PostgreSQL with a host and database name.");
  }
  const workerId = env.SEARQON_AGENT_WORKER_ID;
  if (typeof workerId !== "string" || !WORKER_ID.test(workerId)) {
    throw new AgentSandboxWorkerProcessError("invalid_worker_id","SEARQON_AGENT_WORKER_ID must be a valid stable worker identity.");
  }
  return Object.freeze({
    databaseUrl,
    workerId,
    concurrency:boundedInteger(env.SEARQON_AGENT_WORKER_CONCURRENCY,1,"worker_concurrency",1,2),
    pollIntervalMs:boundedInteger(env.SEARQON_AGENT_WORKER_POLL_MS,1000,"worker_poll_ms",100,60000)
  });
}

export async function assertAgentSandboxWorkerRole(pool) {
  if (!pool || typeof pool.connect !== "function") {
    throw new AgentSandboxWorkerProcessError("worker_database_unavailable","A dedicated agent simulation worker database pool is required.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE searqon_agent_worker");
    const result = await client.query(
      `SELECT
        has_table_privilege(current_user,'searqon.jobs','SELECT') AS "jobsSelect",
        (SELECT bool_and(has_column_privilege(current_user,'searqon.jobs',column_name,'UPDATE'))
         FROM unnest(ARRAY['status','attempts','scheduled_at','lease_owner','lease_token','lease_expires_at','finished_at','result_sha256','last_error_code','updated_at']) AS column_name) AS "jobsUpdate",
        has_table_privilege(current_user,'searqon.job_events','SELECT') AS "eventsSelect",
        has_table_privilege(current_user,'searqon.job_events','INSERT') AS "eventsInsert",
        has_sequence_privilege(current_user,'searqon.job_events_id_seq','USAGE') AS "eventsSequence",
        has_table_privilege(current_user,'searqon.agent_simulation_results','SELECT') AS "resultsSelect",
        has_table_privilege(current_user,'searqon.agent_simulation_results','INSERT') AS "resultsInsert",
        has_table_privilege(current_user,'searqon.alert_destinations','SELECT') AS "alertDestinationsRead",
        has_table_privilege(current_user,'searqon.alert_delivery_outbox','SELECT') AS "alertOutboxRead",
        has_database_privilege(current_user,current_database(),'CREATE') AS "databaseCreate",
        has_schema_privilege(current_user,'searqon','CREATE') AS "schemaCreate"`
    );
    const privileges = result.rows?.[0];
    const required = ["jobsSelect","jobsUpdate","eventsSelect","eventsInsert","eventsSequence","resultsSelect","resultsInsert"];
    const forbidden = ["alertDestinationsRead","alertOutboxRead","databaseCreate","schemaCreate"];
    if (!privileges || required.some(key => privileges[key] !== true) || forbidden.some(key => privileges[key] !== false)) {
      throw new AgentSandboxWorkerProcessError("worker_privileges_invalid","The agent simulation worker role does not match its least-privilege contract.");
    }
    return true;
  } catch (error) {
    if (error instanceof AgentSandboxWorkerProcessError) throw error;
    throw new AgentSandboxWorkerProcessError("worker_role_unavailable","The configured database login cannot assume or verify the restricted agent simulation worker role.");
  } finally {
    await client.query("ROLLBACK").catch(()=>{});
    client.release();
  }
}

function safeCode(error) {
  return typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : "worker_cycle_failed";
}

function sleep(milliseconds,signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolveSleep => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort",finish);
      resolveSleep();
    };
    const timer = setTimeout(finish,milliseconds);
    signal?.addEventListener("abort",finish,{once:true});
  });
}

export async function runAgentSandboxWorker({
  env = process.env,
  signal,
  createDatabaseImpl = createDatabase,
  createWorkerImpl = createAgentSimulationWorker,
  logger = console
} = {}) {
  const config = parseAgentSandboxWorkerConfig(env);
  const database = await createDatabaseImpl({
    connectionString:config.databaseUrl,
    maxConnections:config.concurrency * 2 + 2,
    onPoolError:event=>logger.error?.({event:"agent_worker_database_pool_error",code:safeCode(event)})
  });
  try {
    if (!await database.healthCheck()) {
      throw new AgentSandboxWorkerProcessError("worker_database_unavailable","The agent simulation worker database health check failed.");
    }
    await assertAgentSandboxWorkerRole(database.pool);
    const runner = createWorkerImpl({
      database,
      workerId:config.workerId,
      concurrency:config.concurrency,
      pollIntervalMs:config.pollIntervalMs
    });
    let consecutiveFailures = 0;
    while (!signal?.aborted) {
      try {
        const stats = await runner.runOnce();
        consecutiveFailures = 0;
        if (stats && stats.claimed > 0) {
          logger.info?.({
            event:"agent_simulation_worker_cycle",
            claimed:stats.claimed,
            completed:stats.completed,
            retried:stats.retried,
            failed:stats.failed,
            leaseLost:stats.leaseLost,
            runnerErrors:stats.runnerErrors
          });
        }
        if (!signal?.aborted && (!stats || stats.claimed === 0)) await sleep(config.pollIntervalMs,signal);
      } catch (error) {
        consecutiveFailures = Math.min(consecutiveFailures + 1,8);
        logger.error?.({event:"agent_simulation_worker_cycle_failed",code:safeCode(error)});
        if (!signal?.aborted) await sleep(Math.min(30000,500 * (2 ** (consecutiveFailures - 1))),signal);
      }
    }
    return {stopped:true};
  } finally {
    await database.close();
  }
}

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM",stop);
  process.once("SIGINT",stop);
  try {
    await runAgentSandboxWorker({signal:controller.signal});
  } catch (error) {
    console.error({event:"agent_simulation_worker_start_failed",code:safeCode(error)});
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM",stop);
    process.removeListener("SIGINT",stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
