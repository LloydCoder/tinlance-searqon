import { withUserTransaction } from "./database.js";
import { createJobQueue } from "./jobs.js";
import { simulateAgentJourney } from "../agent-sandbox.js";

export function createAgentSimulationService({ database } = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }
  const queue = createJobQueue({database});

  return Object.freeze({
    async enqueue(userId,organizationId,manifest,idempotencyKey) {
      // Validate the bounded, read-only manifest before it is persisted in the durable queue.
      simulateAgentJourney(manifest);
      return queue.enqueue(userId,organizationId,{
        jobType:"agent_simulation",
        payloadVersion:1,
        payload:manifest,
        idempotencyKey,
        maxAttempts:2
      });
    },

    async getResult(userId,jobId) {
      if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
        const error = new TypeError("A valid simulation job UUID is required.");
        error.code = "invalid_job_id";
        throw error;
      }
      return withUserTransaction(database.pool,userId,async client => {
        const result = await client.query(
          `SELECT r.job_id,r.input_sha256,r.result_sha256,r.result,r.created_at
           FROM searqon.agent_simulation_results r
           JOIN searqon.jobs j ON j.id=r.job_id AND j.organization_id=r.organization_id
           WHERE r.job_id=$1 AND j.job_type='agent_simulation' AND j.status='succeeded'`,
          [jobId]
        );
        return result.rows[0] ?? null;
      });
    }
  });
}
