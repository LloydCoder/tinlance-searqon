import { createHash } from "node:crypto";
import { withUserTransaction } from "./database.js";

const JOB_TYPES = new Set(["assessment","site_crawl","geo_sampling","alert_delivery","scheduled_report"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|api.?key|credential|private.?key)/i;
const WRITERS = new Set(["owner","admin","analyst"]);
const EMPTY_RESULT_DIGEST = createHash("sha256").update("{}").digest("hex");

export class JobQueueError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "JobQueueError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) throw new JobQueueError(400,"invalid_"+field,field+" must be a valid UUID.");
  return value;
}

function requireWorkerId(value) {
  if (typeof value !== "string" || !WORKER_ID.test(value)) throw new JobQueueError(400,"invalid_worker_id","A valid worker identity is required.");
  return value;
}

function requireJobTypes(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > JOB_TYPES.size
    || value.some(type => typeof type !== "string" || !JOB_TYPES.has(type))
    || new Set(value).size !== value.length) {
    throw new JobQueueError(400,"invalid_job_types","Worker job types must be a unique list of supported job types.");
  }
  return [...value];
}

function requireInteger(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new JobQueueError(400,"invalid_"+field,field+" must be an integer between "+min+" and "+max+".");
  }
  return value;
}

function requireTimestamp(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new JobQueueError(400,"invalid_"+field,field+" must be a valid ISO timestamp.");
  }
  return new Date(value).toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function inspectPayload(value, path = "payload") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) inspectPayload(value[i], path + "[" + i + "]");
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new JobQueueError(400,"sensitive_payload_field","Job payloads must not contain credentials, tokens, cookies or secrets.");
    inspectPayload(child, path + "." + key);
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || (Object.getPrototypeOf(payload) !== Object.prototype && Object.getPrototypeOf(payload) !== null)) {
    throw new JobQueueError(400,"invalid_payload","Job payload must be a plain JSON object.");
  }
  inspectPayload(payload);
  let serialized;
  try { serialized = stableJson(payload); }
  catch { throw new JobQueueError(400,"invalid_payload","Job payload must be valid JSON."); }
  if (typeof serialized !== "string" || Buffer.byteLength(serialized,"utf8") > 16384) {
    throw new JobQueueError(413,"payload_too_large","Job payload must not exceed 16 KiB.");
  }
  try { return JSON.parse(serialized); }
  catch { throw new JobQueueError(400,"invalid_payload","Job payload must be valid JSON."); }
}

function jobRow(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    createdBy: row.created_by,
    jobType: row.job_type,
    payloadVersion: row.payload_version,
    payload: row.payload,
    payloadSha256: row.payload_sha256,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    scheduledAt: row.scheduled_at,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    idempotencyKey: row.idempotency_key,
    resultSha256: row.result_sha256,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at
  };
}

async function withWorkerTransaction(pool, workerId, operation) {
  if (!pool || typeof pool.connect !== "function") throw new JobQueueError(503,"worker_unavailable","A dedicated worker database pool is not configured.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE searqon_worker");
    await client.query("SELECT set_config('searqon.worker_id',$1,true)",[workerId]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function requireWriter(client, organizationId, userId) {
  const result = await client.query(
    "SELECT role FROM searqon.memberships WHERE organization_id = $1 AND user_id = $2",
    [organizationId,userId]
  );
  const role = result.rows?.[0]?.role;
  if (!role) throw new JobQueueError(404,"workspace_not_found","The requested workspace was not found.");
  if (!WRITERS.has(role)) throw new JobQueueError(403,"insufficient_role","Your workspace role cannot enqueue background jobs.");
}

async function appendUserEvent(client, job, userId, eventType, metadata = {}) {
  await client.query(
    `INSERT INTO searqon.job_events
      (job_id,organization_id,event_type,actor_kind,actor_user_id,worker_id,attempt,metadata)
     VALUES ($1,$2,$3,'user',$4,NULL,$5,$6::jsonb)`,
    [job.id,job.organization_id,eventType,userId,job.attempts,JSON.stringify(metadata)]
  );
}

async function appendWorkerEvent(client, job, workerId, eventType, metadata = {}) {
  await client.query(
    `INSERT INTO searqon.job_events
      (job_id,organization_id,event_type,actor_kind,actor_user_id,worker_id,attempt,metadata)
     VALUES ($1,$2,$3,'worker',NULL,$4,$5,$6::jsonb)`,
    [job.id,job.organization_id,eventType,workerId,job.attempts,JSON.stringify(metadata)]
  );
}

export function createJobQueue({ database, workerPool = null } = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }

  return Object.freeze({
    async enqueue(userId, organizationId, input) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new JobQueueError(400,"invalid_request","Job details are required.");
      if (!JOB_TYPES.has(input.jobType)) throw new JobQueueError(400,"invalid_job_type","The requested job type is not supported.");
      const payloadVersion = requireInteger(input.payloadVersion ?? 1,"payload_version",1,100);
      const payload = validatePayload(input.payload);
      const serializedPayload = stableJson(payload);
      const payloadSha256 = createHash("sha256").update(serializedPayload).digest("hex");
      const priority = requireInteger(input.priority ?? 50,"priority",0,100);
      const maxAttempts = requireInteger(input.maxAttempts ?? 5,"max_attempts",1,20);
      const scheduledAt = requireTimestamp(input.scheduledAt,"scheduled_at");
      if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        throw new JobQueueError(400,"invalid_idempotency_key","A valid idempotency key between 8 and 128 safe characters is required.");
      }

      return withUserTransaction(database.pool,userId,async client => {
        await requireWriter(client,organizationId,userId);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[organizationId+":"+input.idempotencyKey]);
        const inserted = await client.query(
          `INSERT INTO searqon.jobs
            (organization_id,created_by,job_type,payload_version,payload,payload_sha256,status,priority,max_attempts,scheduled_at,idempotency_key)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,'queued',$7,$8,COALESCE($9::timestamptz,now()),$10)
           ON CONFLICT (organization_id,idempotency_key) DO NOTHING
           RETURNING *`,
          [organizationId,userId,input.jobType,payloadVersion,JSON.stringify(payload),payloadSha256,priority,maxAttempts,scheduledAt,input.idempotencyKey]
        );
        if (inserted.rows[0]) {
          const row = inserted.rows[0];
          await appendUserEvent(client,row,userId,"queued",{jobType:row.job_type,payloadVersion,payloadSha256});
          return { job:jobRow(row), idempotentReplay:false };
        }
        const existing = await client.query(
          "SELECT * FROM searqon.jobs WHERE organization_id = $1 AND idempotency_key = $2",
          [organizationId,input.idempotencyKey]
        );
        const row = existing.rows[0];
        const matches = row
          && row.job_type === input.jobType
          && row.payload_version === payloadVersion
          && row.payload_sha256 === payloadSha256
          && row.priority === priority
          && row.max_attempts === maxAttempts
          && (!scheduledAt || new Date(row.scheduled_at).getTime() === Date.parse(scheduledAt));
        if (!matches) throw new JobQueueError(409,"idempotency_key_conflict","The idempotency key was already used for a different job.");
        return { job:jobRow(row), idempotentReplay:true };
      });
    },

    async claim(workerId, { limit = 10, leaseSeconds = 60, jobTypes } = {}) {
      requireWorkerId(workerId);
      requireInteger(limit,"claim_limit",1,100);
      requireInteger(leaseSeconds,"lease_seconds",5,3600);
      const allowedJobTypes = requireJobTypes(jobTypes);
      return withWorkerTransaction(workerPool,workerId,async client => {
        const exhausted = await client.query(
          `UPDATE searqon.jobs
           SET status='failed',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
               last_error_code='max_attempts_exceeded',finished_at=now(),updated_at=now()
           WHERE status='leased' AND lease_expires_at <= now() AND attempts >= max_attempts
             AND ($1::text[] IS NULL OR job_type = ANY($1::text[]))
           RETURNING *`,
          [allowedJobTypes]
        );
        for (const row of exhausted.rows) await appendWorkerEvent(client,row,workerId,"failed",{reason:"max_attempts_exceeded"});

        const claimed = await client.query(
          `WITH candidates AS (
             SELECT id,status AS previous_status
             FROM searqon.jobs
             WHERE attempts < max_attempts
               AND ((status='queued' AND scheduled_at <= now())
                 OR (status='leased' AND lease_expires_at <= now()))
               AND ($4::text[] IS NULL OR job_type = ANY($4::text[]))
             ORDER BY priority DESC,scheduled_at,created_at,id
             FOR UPDATE SKIP LOCKED
             LIMIT $1
           ),
           updated AS (
             UPDATE searqon.jobs j
             SET status='leased',attempts=j.attempts+1,lease_owner=$2,lease_token=gen_random_uuid(),
                 lease_expires_at=now()+($3 * interval '1 second'),updated_at=now(),last_error_code=NULL
             FROM candidates c
             WHERE j.id=c.id
             RETURNING j.*,c.previous_status
           )
           SELECT * FROM updated ORDER BY priority DESC,scheduled_at,created_at,id`,
          [limit,workerId,leaseSeconds,allowedJobTypes]
        );
        for (const row of claimed.rows) {
          if (row.previous_status === "leased") await appendWorkerEvent(client,row,workerId,"lease_expired",{reclaimed:true});
          await appendWorkerEvent(client,row,workerId,"leased",{leaseSeconds});
        }
        return claimed.rows.map(jobRow);
      });
    },

    async complete(workerId, jobId, leaseToken, { resultSha256 = EMPTY_RESULT_DIGEST } = {}) {
      requireWorkerId(workerId);
      requireUuid(jobId,"job_id");
      requireUuid(leaseToken,"lease_token");
      if (typeof resultSha256 !== "string" || !/^[a-f0-9]{64}$/.test(resultSha256)) {
        throw new JobQueueError(400,"invalid_result_digest","A SHA-256 result digest is required.");
      }
      return withWorkerTransaction(workerPool,workerId,async client => {
        const result = await client.query(
          `UPDATE searqon.jobs
           SET status='succeeded',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
               result_sha256=$4,finished_at=now(),updated_at=now()
           WHERE id=$1 AND status='leased' AND lease_owner=$2 AND lease_token=$3 AND lease_expires_at > now()
           RETURNING *`,
          [jobId,workerId,leaseToken,resultSha256]
        );
        if (!result.rows[0]) return { accepted:false, reason:"lease_lost" };
        await appendWorkerEvent(client,result.rows[0],workerId,"succeeded",{resultSha256});
        return { accepted:true, job:jobRow(result.rows[0]) };
      });
    },

    async retry(workerId, jobId, leaseToken, { errorCode, retryDelaySeconds = 30 } = {}) {
      requireWorkerId(workerId);
      requireUuid(jobId,"job_id");
      requireUuid(leaseToken,"lease_token");
      if (typeof errorCode !== "string" || !ERROR_CODE.test(errorCode)) {
        throw new JobQueueError(400,"invalid_error_code","A bounded machine-readable error code is required.");
      }
      requireInteger(retryDelaySeconds,"retry_delay_seconds",0,86400);
      return withWorkerTransaction(workerPool,workerId,async client => {
        const result = await client.query(
          `UPDATE searqon.jobs
           SET status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
               lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=$4,
               scheduled_at=CASE WHEN attempts >= max_attempts THEN scheduled_at ELSE now()+($5 * interval '1 second') END,
               finished_at=CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,updated_at=now()
           WHERE id=$1 AND status='leased' AND lease_owner=$2 AND lease_token=$3 AND lease_expires_at > now()
           RETURNING *`,
          [jobId,workerId,leaseToken,errorCode,retryDelaySeconds]
        );
        if (!result.rows[0]) return { accepted:false, reason:"lease_lost" };
        const row = result.rows[0];
        const eventType = row.status === "failed" ? "failed" : "retry_scheduled";
        await appendWorkerEvent(client,row,workerId,eventType,{errorCode,retryDelaySeconds});
        return { accepted:true, job:jobRow(row) };
      });
    },

    async extendLease(workerId, jobId, leaseToken, { leaseSeconds = 60 } = {}) {
      requireWorkerId(workerId);
      requireUuid(jobId,"job_id");
      requireUuid(leaseToken,"lease_token");
      requireInteger(leaseSeconds,"lease_seconds",5,3600);
      return withWorkerTransaction(workerPool,workerId,async client => {
        const result = await client.query(
          `UPDATE searqon.jobs
           SET lease_expires_at=now()+($4 * interval '1 second'),updated_at=now()
           WHERE id=$1 AND status='leased' AND lease_owner=$2 AND lease_token=$3 AND lease_expires_at > now()
           RETURNING *`,
          [jobId,workerId,leaseToken,leaseSeconds]
        );
        if (!result.rows[0]) return { extended:false, reason:"lease_lost" };
        await appendWorkerEvent(client,result.rows[0],workerId,"lease_extended",{leaseSeconds});
        return { extended:true, leaseExpiresAt:result.rows[0].lease_expires_at };
      });
    }
  });
}
