import { simulateAgentJourney } from "../agent-sandbox.js";
import { createJobQueue } from "./jobs.js";
import { createWorkerRunner } from "./worker-runner.js";

export class AgentSimulationWorkerError extends Error {
  constructor(code,message) {
    super(message);
    this.name = "AgentSimulationWorkerError";
    this.code = code;
  }
}


async function persistResult({ pool, workerId, job, result }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE searqon_agent_worker");
    await client.query("SELECT set_config('searqon.worker_id',$1,true)",[workerId]);
    await client.query("SELECT set_config('searqon.lease_token',$1,true)",[job.leaseToken]);
    const existing = await client.query(
      "SELECT result_sha256 FROM searqon.agent_simulation_results WHERE job_id=$1 AND organization_id=$2",
      [job.id,job.organizationId]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].result_sha256 !== result.resultSha256) {
        throw new AgentSimulationWorkerError("simulation_result_conflict","A retried simulation produced a different result digest.");
      }
      await client.query("COMMIT");
      return { stored:false, replay:true };
    }
    await client.query(
      `INSERT INTO searqon.agent_simulation_results
        (job_id,organization_id,input_sha256,result_sha256,result)
       VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [job.id,job.organizationId,job.payloadSha256,result.resultSha256,JSON.stringify(result)]
    );
    await client.query("COMMIT");
    return { stored:true, replay:false };
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {
    client.release();
  }
}

export function createAgentSimulationWorker({
  database,
  workerId,
  concurrency = 1,
  leaseSeconds = 120,
  pollIntervalMs = 1000
} = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A dedicated agent simulation worker database pool is required.");
  }
  if (typeof workerId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/.test(workerId)) {
    throw new TypeError("A valid agent simulation worker identity is required.");
  }
  const queue = createJobQueue({
    database,
    workerPool:database.pool,
    workerRole:"searqon_agent_worker"
  });
  const handler = async (job,{workerId:activeWorkerId,signal}) => {
    if (signal.aborted) throw new AgentSimulationWorkerError("simulation_cancelled","The simulation lease was lost.");
    const result = simulateAgentJourney(job.payload,{runId:job.id});
    if (signal.aborted) throw new AgentSimulationWorkerError("simulation_cancelled","The simulation lease was lost.");
    const persisted = await persistResult({pool:database.pool,workerId:activeWorkerId,job,result});
    if (signal.aborted) throw new AgentSimulationWorkerError("simulation_cancelled","The simulation lease was lost.");
    return {
      resultSha256:result.resultSha256,
      resultBytes:Buffer.byteLength(JSON.stringify(result),"utf8"),
      persisted:persisted.stored || persisted.replay
    };
  };
  return createWorkerRunner({
    queue,
    workerId,
    handlers:{agent_simulation:handler},
    concurrency,
    leaseSeconds,
    pollIntervalMs
  });
}
