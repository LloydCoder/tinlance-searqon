import { createHash, randomUUID } from "node:crypto";
import { withUserTransaction } from "./database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ALERT_TYPES = new Set(["mention_change","brand_citation_change"]);
const METRICS = new Set(["mention","brand_citation"]);
const DIRECTIONS = new Set(["decline","increase"]);
const SEVERITIES = new Set(["low","medium","high"]);
const WRITERS = new Set(["owner","admin","analyst"]);
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|api.?key|credential|private.?key)/i;
const MAX_COHORTS = 2000;
const MAX_ALERTS = 500;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_BYTES = 65536;
const MAX_COOLDOWN_SECONDS = 2592000;

export class GeoAlertStoreError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "GeoAlertStoreError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) throw new GeoAlertStoreError(400,"invalid_"+field,field+" must be a valid UUID.");
  return value;
}

function requireIdentifier(value, field) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw new GeoAlertStoreError(400,"invalid_"+field,field+" is invalid.");
  return value;
}

function timestamp(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new GeoAlertStoreError(400,"invalid_"+field,field+" must be an ISO-8601 UTC timestamp.");
  }
  const parsed = new Date(value);
  if (parsed.toISOString() !== value) throw new GeoAlertStoreError(400,"invalid_"+field,field+" must be a canonical UTC timestamp.");
  return parsed;
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key)+":"+stableJson(value[key])).join(",") + "}";
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new GeoAlertStoreError(400,"invalid_json","Alert state must contain JSON values only.");
  return serialized;
}

function inspectSafe(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const child of value) inspectSafe(child);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new GeoAlertStoreError(400,"sensitive_payload_field","Alert snapshots and events must not contain credentials or secrets.");
    inspectSafe(child);
  }
}

function boundedJson(value, maximumBytes, code, field) {
  inspectSafe(value);
  let serialized;
  try { serialized = stableJson(value); }
  catch (error) {
    if (error instanceof GeoAlertStoreError) throw error;
    throw new GeoAlertStoreError(400,"invalid_json",field+" must be valid JSON.");
  }
  if (Buffer.byteLength(serialized,"utf8") > maximumBytes) {
    throw new GeoAlertStoreError(413,code,field+" exceeds its storage size limit.");
  }
  return { value:JSON.parse(serialized), serialized, digest:createHash("sha256").update(serialized).digest("hex") };
}

function validateComparison(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new GeoAlertStoreError(400,"invalid_comparison","A GEO comparison is required.");
  const report = input.report;
  if (!report || typeof report !== "object" || report.schemaVersion !== "1.0.0" || report.type !== "geo_alert_report") {
    throw new GeoAlertStoreError(400,"invalid_report","A GEO alert report version 1.0.0 is required.");
  }
  const baselineId = requireIdentifier(report.baselineId,"snapshot_id");
  const currentId = requireIdentifier(report.currentId,"snapshot_id");
  if (baselineId === currentId) throw new GeoAlertStoreError(400,"invalid_snapshot_id","Baseline and current snapshot IDs must differ.");
  const baselineAt = timestamp(report.baselineAt,"baseline_at");
  const currentAt = timestamp(report.currentAt,"current_at");
  const evaluatedAt = timestamp(report.evaluatedAt,"evaluated_at");
  if (currentAt.getTime() < baselineAt.getTime() || evaluatedAt.getTime() < currentAt.getTime()) {
    throw new GeoAlertStoreError(400,"invalid_timestamp_order","Current capture and evaluation times must not precede the baseline/current capture.");
  }
  if (!report.policy || !Number.isSafeInteger(report.policy.cooldownSeconds)
    || report.policy.cooldownSeconds < 0 || report.policy.cooldownSeconds > MAX_COOLDOWN_SECONDS) {
    throw new GeoAlertStoreError(400,"invalid_cooldown","Cooldown must be between zero and 30 days.");
  }
  if (!Array.isArray(input.baseline) || !Array.isArray(input.current)
    || input.baseline.length > MAX_COHORTS || input.current.length > MAX_COHORTS) {
    throw new GeoAlertStoreError(400,"too_many_cohorts","Each aggregate snapshot must contain at most 2,000 cohorts.");
  }
  for (const row of [...input.baseline,...input.current]) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new GeoAlertStoreError(400,"invalid_snapshot","Every aggregate cohort must be an object.");
    }
  }
  const baseline = boundedJson(input.baseline,MAX_SNAPSHOT_BYTES,"snapshot_too_large","Baseline snapshot");
  const current = boundedJson(input.current,MAX_SNAPSHOT_BYTES,"snapshot_too_large","Current snapshot");
  if (!Array.isArray(report.alerts) || report.alerts.length > MAX_ALERTS) {
    throw new GeoAlertStoreError(400,"invalid_alerts","The alert report must contain at most 500 alert candidates.");
  }
  const alertIds = new Set();
  const dedupeKeys = new Set();
  const alerts = report.alerts.map(alert => {
    if (!alert || typeof alert !== "object" || Array.isArray(alert)) {
      throw new GeoAlertStoreError(400,"invalid_alert","Every alert candidate must be an object.");
    }
    const alertId = requireIdentifier(alert.alertId,"alert_id");
    if (!DIGEST.test(alert.dedupeKey ?? "")) throw new GeoAlertStoreError(400,"invalid_dedupe_key","Alert dedupe keys must be SHA-256 digests.");
    if (!ALERT_TYPES.has(alert.type) || !METRICS.has(alert.metric) || !DIRECTIONS.has(alert.direction) || !SEVERITIES.has(alert.severity)) {
      throw new GeoAlertStoreError(400,"invalid_alert_classification","Alert type, metric, direction or severity is invalid.");
    }
    if ((alert.type === "mention_change" && alert.metric !== "mention")
      || (alert.type === "brand_citation_change" && alert.metric !== "brand_citation")) {
      throw new GeoAlertStoreError(400,"invalid_alert_classification","Alert type and metric do not match.");
    }
    if (alert.baselineId !== baselineId || alert.currentId !== currentId
      || alert.baselineAt !== report.baselineAt || alert.currentAt !== report.currentAt
      || alert.evaluatedAt !== report.evaluatedAt) {
      throw new GeoAlertStoreError(400,"snapshot_reference_mismatch","Alert evidence must reference the report's exact baseline and current snapshots.");
    }
    if (alertIds.has(alertId) || dedupeKeys.has(alert.dedupeKey)) {
      throw new GeoAlertStoreError(400,"duplicate_alert","A comparison cannot contain duplicate alert IDs or dedupe keys.");
    }
    alertIds.add(alertId);
    dedupeKeys.add(alert.dedupeKey);
    const payload = boundedJson(alert,MAX_EVENT_BYTES,"alert_too_large","Alert event");
    return { alert:payload.value, alertId, dedupeKey:alert.dedupeKey, payloadSha256:payload.digest };
  });
  return {
    baselineId,currentId,baselineAt,currentAt,evaluatedAt,
    cooldownSeconds:report.policy.cooldownSeconds,
    baseline,current,alerts
  };
}

async function requireWriter(client, organizationId, userId) {
  const result = await client.query(
    "SELECT role FROM searqon.memberships WHERE organization_id=$1 AND user_id=$2",
    [organizationId,userId]
  );
  const role = result.rows?.[0]?.role;
  if (!role) throw new GeoAlertStoreError(404,"workspace_not_found","The requested workspace was not found.");
  if (!WRITERS.has(role)) throw new GeoAlertStoreError(403,"insufficient_role","Your workspace role cannot persist GEO alert state.");
}

async function persistSnapshot(client, organizationId, userId, snapshotId, capturedAt, payload) {
  const inserted = await client.query(
    `INSERT INTO searqon.geo_alert_snapshots
      (organization_id,snapshot_id,captured_at,cohort_count,snapshot,payload_sha256,created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
     ON CONFLICT (organization_id,snapshot_id) DO NOTHING
     RETURNING id,payload_sha256,captured_at`,
    [organizationId,snapshotId,capturedAt,payload.value.length,JSON.stringify(payload.value),payload.digest,userId]
  );
  if (inserted.rows[0]) return { id:inserted.rows[0].id, digest:inserted.rows[0].payload_sha256, idempotentReplay:false };
  const existing = await client.query(
    "SELECT id,payload_sha256,captured_at FROM searqon.geo_alert_snapshots WHERE organization_id=$1 AND snapshot_id=$2",
    [organizationId,snapshotId]
  );
  const row = existing.rows[0];
  if (!row || row.payload_sha256 !== payload.digest || new Date(row.captured_at).getTime() !== capturedAt.getTime()) {
    throw new GeoAlertStoreError(409,"snapshot_id_conflict","A snapshot ID is already stored with different content or capture time.");
  }
  return { id:row.id, digest:row.payload_sha256, idempotentReplay:true };
}

async function enqueueAlertDeliveries(client,organizationId,userId,eventRow) {
  const destinations = await client.query(
    `SELECT id,channel FROM searqon.alert_destinations
     WHERE organization_id=$1 AND status='enabled'
     ORDER BY id FOR SHARE`,
    [organizationId]
  );
  const deliveries = [];
  for (const destination of destinations.rows) {
    const deliveryId = randomUUID();
    const jobId = randomUUID();
    const payload = { deliveryId };
    const serializedPayload = stableJson(payload);
    const payloadSha256 = createHash("sha256").update(serializedPayload).digest("hex");
    const idempotencyKey = "alert-delivery:"+eventRow.event_id+":"+destination.id;
    const job = await client.query(
      `INSERT INTO searqon.jobs
        (id,organization_id,created_by,job_type,payload_version,payload,payload_sha256,status,priority,max_attempts,scheduled_at,idempotency_key)
       VALUES ($1,$2,$3,'alert_delivery',1,$4::jsonb,$5,'queued',70,5,now(),$6)
       RETURNING id,organization_id,attempts`,
      [jobId,organizationId,userId,JSON.stringify(payload),payloadSha256,idempotencyKey]
    );
    await client.query(
      `INSERT INTO searqon.job_events
        (job_id,organization_id,event_type,actor_kind,actor_user_id,worker_id,attempt,metadata)
       VALUES ($1,$2,'queued','user',$3,NULL,0,$4::jsonb)`,
      [jobId,organizationId,userId,JSON.stringify({
        jobType:"alert_delivery",deliveryId,eventId:eventRow.event_id,destinationId:destination.id
      })]
    );
    await client.query(
      `INSERT INTO searqon.alert_delivery_outbox
        (id,organization_id,event_id,destination_id,job_id,status)
       VALUES ($1,$2,$3,$4,$5,'queued')`,
      [deliveryId,organizationId,eventRow.id,destination.id,job.rows[0].id]
    );
    deliveries.push({
      id:deliveryId,jobId:job.rows[0].id,destinationId:destination.id,
      channel:destination.channel,status:"queued"
    });
  }
  return deliveries;
}

export function createGeoAlertStore({ database, now = () => new Date() } = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }
  if (typeof now !== "function") throw new TypeError("A trusted server clock returning a valid Date is required.");
  const initialClockValue = now();
  if (!(initialClockValue instanceof Date) || !Number.isFinite(initialClockValue.getTime())) {
    throw new TypeError("A trusted server clock returning a valid Date is required.");
  }

  return Object.freeze({
    async recordComparison(userId, organizationId, input) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      const comparison = validateComparison(input);
      const storedAt = now();
      if (!(storedAt instanceof Date) || !Number.isFinite(storedAt.getTime())) {
        throw new GeoAlertStoreError(503,"clock_unavailable","The trusted server clock is unavailable.");
      }

      return withUserTransaction(database.pool,userId,async client => {
        await requireWriter(client,organizationId,userId);
        const baselineSnapshot = await persistSnapshot(
          client,organizationId,userId,comparison.baselineId,comparison.baselineAt,comparison.baseline
        );
        const currentSnapshot = await persistSnapshot(
          client,organizationId,userId,comparison.currentId,comparison.currentAt,comparison.current
        );
        const events = [];
        const alerts = [...comparison.alerts].sort((a,b) => a.dedupeKey.localeCompare(b.dedupeKey));
        for (const item of alerts) {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [organizationId+":"+item.dedupeKey]
          );
          const existing = await client.query(
            "SELECT id,event_id,state,suppressed_until,suppression_reason,payload_sha256 FROM searqon.geo_alert_events WHERE organization_id=$1 AND alert_id=$2",
            [organizationId,item.alertId]
          );
          if (existing.rows[0]) {
            const row = existing.rows[0];
            if (row.payload_sha256 !== item.payloadSha256) {
              throw new GeoAlertStoreError(409,"alert_id_conflict","An alert ID is already stored with different content.");
            }
            events.push({
              id:row.id,eventId:row.event_id,alertId:item.alertId,state:row.state,
              suppressedUntil:row.suppressed_until,suppressionReason:row.suppression_reason,
              deliveries:[],idempotentReplay:true
            });
            continue;
          }

          const cooldownResult = await client.query(
            `SELECT last_evaluated_at,cooldown_until
             FROM searqon.geo_alert_cooldowns
             WHERE organization_id=$1 AND dedupe_key=$2 FOR UPDATE`,
            [organizationId,item.dedupeKey]
          );
          const cooldown = cooldownResult.rows[0];
          let state = "emitted";
          let suppressedUntil = null;
          let suppressionReason = null;
          if (cooldown && new Date(cooldown.cooldown_until).getTime() > storedAt.getTime()) {
            state = "suppressed";
            suppressedUntil = new Date(cooldown.cooldown_until);
            suppressionReason = "cooldown_active";
          } else if (cooldown && comparison.evaluatedAt.getTime() < new Date(cooldown.last_evaluated_at).getTime()) {
            state = "suppressed";
            suppressedUntil = new Date(Math.max(new Date(cooldown.cooldown_until).getTime(),storedAt.getTime()));
            suppressionReason = "out_of_order_evaluation";
          }

          const eventId = randomUUID();
          const inserted = await client.query(
            `INSERT INTO searqon.geo_alert_events
              (organization_id,event_id,alert_id,dedupe_key,alert_type,metric,direction,severity,
               baseline_snapshot_id,current_snapshot_id,state,suppressed_until,suppression_reason,
               payload,payload_sha256,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
             RETURNING id,event_id,state,suppressed_until,suppression_reason`,
            [organizationId,eventId,item.alertId,item.dedupeKey,item.alert.type,item.alert.metric,
              item.alert.direction,item.alert.severity,comparison.baselineId,comparison.currentId,
              state,suppressedUntil,suppressionReason,JSON.stringify(item.alert),item.payloadSha256,userId]
          );
          const row = inserted.rows[0];
          let deliveries = [];
          if (state === "emitted") {
            const cooldownUntil = new Date(storedAt.getTime()+comparison.cooldownSeconds*1000);
            await client.query(
              `INSERT INTO searqon.geo_alert_cooldowns
                (organization_id,dedupe_key,last_emitted_event_id,last_emitted_at,last_evaluated_at,cooldown_until)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (organization_id,dedupe_key) DO UPDATE SET
                 last_emitted_event_id=EXCLUDED.last_emitted_event_id,
                 last_emitted_at=EXCLUDED.last_emitted_at,
                 last_evaluated_at=EXCLUDED.last_evaluated_at,
                 cooldown_until=EXCLUDED.cooldown_until,
                 updated_at=now()`,
              [organizationId,item.dedupeKey,row.id,storedAt,comparison.evaluatedAt,cooldownUntil]
            );
            deliveries = await enqueueAlertDeliveries(client,organizationId,userId,row);
          }
          events.push({
            id:row.id,eventId:row.event_id,alertId:item.alertId,state:row.state,
            suppressedUntil:row.suppressed_until,suppressionReason:row.suppression_reason,
            deliveries,idempotentReplay:false
          });
        }

        return {
          baselineSnapshot,
          currentSnapshot,
          events,
          summary:{
            emitted:events.filter(event => event.state === "emitted" && !event.idempotentReplay).length,
            suppressed:events.filter(event => event.state === "suppressed" && !event.idempotentReplay).length,
            idempotentReplays:events.filter(event => event.idempotentReplay).length,
            queuedDeliveries:events.reduce((sum,event)=>sum+event.deliveries.length,0)
          }
        };
      });
    }
  });
}
