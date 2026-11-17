import { createHash } from "node:crypto";
import { withUserTransaction } from "./database.js";
import { createUsageLedger } from "./usage-ledger.js";
import { createSubscriptionEntitlementResolver } from "./subscription-entitlements.js";
import { analyzeGeoObservation, aggregateGeoObservations } from "../geo.js";
import { verifyEvidenceRecord } from "../evidence.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const WRITERS = new Set(["owner","admin","analyst"]);
const MAX_RAW_PAYLOAD_BYTES = 2 * 1024 * 1024;

class DuplicateGeoEvidenceError extends Error {}

export class GeoObservationError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "GeoObservationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new GeoObservationError(400,"invalid_" + field,field + " must be a valid identifier.");
  }
  return value;
}

function canonicalPayload(input, normalized) {
  return {
    prompt: input.prompt.trim(),
    answer: input.answer.trim(),
    brand: normalized.brand,
    targetDomain: normalized.targetDomain,
    provider: {
      name: normalized.provider.name,
      observationClass: normalized.observationClass,
      model: normalized.provider.model,
      region: normalized.provider.region,
      locale: normalized.provider.locale
    },
    citations: normalized.citations.map(item => item.url),
    sampledAt: normalized.sampledAt
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function hashPayload(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function observationRow(row, idempotentReplay = false) {
  return {
    id: row.id,
    projectId: row.project_id,
    providerName: row.provider_name,
    observationClass: row.observation_class,
    sampledAt: row.sampled_at,
    brand: row.brand,
    targetDomain: row.target_domain,
    mentioned: row.mentioned,
    mentionCount: row.mention_count,
    citationCount: row.citation_count,
    brandCited: row.brand_cited,
    observation: row.normalized_observation,
    evidence: {
      id: row.evidence_id,
      sha256: row.evidence_sha256,
      byteLength: row.evidence_bytes
    },
    submittedAt: row.submitted_at,
    idempotentReplay
  };
}

async function requireProject(client,userId,projectId,write = false) {
  const result = await client.query(
    `SELECT p.organization_id,m.role
     FROM searqon.projects p
     JOIN searqon.memberships m ON m.organization_id=p.organization_id
     WHERE p.id=$1 AND m.user_id=$2`,
    [projectId,userId]
  );
  const row = result.rows?.[0];
  if (!row) throw new GeoObservationError(404,"project_not_found","The requested project was not found.");
  if (write && !WRITERS.has(row.role)) {
    throw new GeoObservationError(403,"insufficient_role","Your workspace role cannot submit GEO observations.");
  }
  return row.organization_id;
}

export function createGeoObservationService({
  database,
  usageLedger = null,
  getEntitlements = null
} = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }
  const entitlementResolver = getEntitlements ?? createSubscriptionEntitlementResolver();
  const ledger = usageLedger ?? createUsageLedger({ database, getEntitlements: entitlementResolver });
  if (typeof ledger?.consume !== "function") throw new TypeError("A trusted atomic usage ledger is required.");

  return Object.freeze({
    async submit(userId,projectId,input) {
      requireUuid(userId,"user_id");
      requireUuid(projectId,"project_id");
      if (!input || typeof input !== "object" || Array.isArray(input)
        || typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        throw new GeoObservationError(400,"invalid_idempotency_key","A valid idempotency key is required.");
      }
      let normalized;
      try { normalized = analyzeGeoObservation(input); }
      catch (error) {
        throw new GeoObservationError(400,"invalid_observation",error instanceof Error ? error.message : "The GEO observation is invalid.");
      }
      const rawPayload = canonicalPayload(input,normalized);
      const rawBytes = Buffer.byteLength(JSON.stringify(rawPayload),"utf8");
      if (rawBytes < 1 || rawBytes > MAX_RAW_PAYLOAD_BYTES) {
        throw new GeoObservationError(413,"observation_too_large","The supplied GEO observation exceeds the storage limit.");
      }
      const sourcePayloadHash = hashPayload(rawPayload);
      const organizationId = await withUserTransaction(database.pool,userId,client =>
        requireProject(client,userId,projectId,true)
      );

      let consumed;
      try {
        consumed = await ledger.consume(userId,organizationId,{
          meter:"supplied_geo_observations",
          quantity:1,
          idempotencyKey:input.idempotencyKey
        },async client => {
        const currentOrganizationId = await requireProject(client,userId,projectId,true);
        if (currentOrganizationId !== organizationId) {
          throw new GeoObservationError(404,"project_not_found","The requested project was not found.");
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[organizationId + ":geo-evidence:" + normalized.evidence.id]);
        const duplicateEvidence = await client.query(
          "SELECT * FROM searqon.geo_observations WHERE organization_id=$1 AND project_id=$2 AND evidence_id=$3 FOR UPDATE",
          [organizationId,projectId,normalized.evidence.id]
        );
        if (duplicateEvidence.rows[0]) {
          if (duplicateEvidence.rows[0].source_payload_hash !== sourcePayloadHash) {
            throw new GeoObservationError(409,"evidence_identifier_conflict","The evidence identifier is already associated with different source content.");
          }
          throw new DuplicateGeoEvidenceError();
        }
        const inserted = await client.query(
          `INSERT INTO searqon.geo_observations
            (organization_id,project_id,submitted_by,provider_name,observation_class,sampled_at,
             brand,target_domain,mentioned,mention_count,citation_count,brand_cited,
             normalized_observation,raw_payload,source_payload_hash,evidence_id,evidence_sha256,
             evidence_bytes,idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19)
           RETURNING *`,
          [organizationId,projectId,userId,normalized.provider.name,normalized.observationClass,
            normalized.sampledAt,normalized.brand,normalized.targetDomain,normalized.mentioned,
            normalized.mentionCount,normalized.citationCount,normalized.brandCited,
            JSON.stringify(normalized),JSON.stringify(rawPayload),sourcePayloadHash,
            normalized.evidence.id,normalized.evidence.sha256,normalized.evidence.byteLength,input.idempotencyKey]
        );
        return inserted.rows[0];
        });
      } catch (error) {
        if (!(error instanceof DuplicateGeoEvidenceError)) throw error;
        const duplicate = await withUserTransaction(database.pool,userId,async client => {
          await requireProject(client,userId,projectId,false);
          const result = await client.query(
            "SELECT * FROM searqon.geo_observations WHERE organization_id=$1 AND project_id=$2 AND evidence_id=$3",
            [organizationId,projectId,normalized.evidence.id]
          );
          return result.rows[0] ?? null;
        });
        if (!duplicate || duplicate.source_payload_hash !== sourcePayloadHash) {
          throw new GeoObservationError(409,"evidence_identifier_conflict","The evidence identifier is already associated with different source content.");
        }
        return {
          observation: observationRow(duplicate,true),
          usage: null,
          idempotentReplay: false,
          deduplicated: true
        };
      }

      if (!consumed.idempotentReplay) {
        return {
          observation: observationRow(consumed.result),
          usage: consumed.usage,
          idempotentReplay: false
        };
      }
      const existing = await withUserTransaction(database.pool,userId,async client => {
        await requireProject(client,userId,projectId,false);
        const result = await client.query(
          "SELECT * FROM searqon.geo_observations WHERE organization_id=$1 AND idempotency_key=$2",
          [organizationId,input.idempotencyKey]
        );
        return result.rows[0] ?? null;
      });
      if (!existing || existing.project_id !== projectId || existing.source_payload_hash !== sourcePayloadHash) {
        throw new GeoObservationError(409,"idempotency_key_conflict","The idempotency key was already used for a different observation.");
      }
      return {
        observation: observationRow(existing,true),
        usage: consumed.usage,
        idempotentReplay: true
      };
    },

    async list(userId,projectId,{limit = 50} = {}) {
      requireUuid(userId,"user_id");
      requireUuid(projectId,"project_id");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new GeoObservationError(400,"invalid_limit","The observation list limit must be between 1 and 100.");
      }
      return withUserTransaction(database.pool,userId,async client => {
        await requireProject(client,userId,projectId,false);
        const result = await client.query(
          `SELECT * FROM searqon.geo_observations
           WHERE project_id=$1
           ORDER BY sampled_at DESC,id DESC
           LIMIT $2`,
          [projectId,limit]
        );
        return result.rows.map(row => observationRow(row));
      });
    },

    async getEvidence(userId,observationId) {
      requireUuid(userId,"user_id");
      requireUuid(observationId,"observation_id");
      return withUserTransaction(database.pool,userId,async client => {
        const result = await client.query(
          "SELECT * FROM searqon.geo_observations WHERE id=$1",
          [observationId]
        );
        const row = result.rows?.[0];
        if (!row) throw new GeoObservationError(404,"observation_not_found","The requested GEO observation was not found.");
        const recomputed = analyzeGeoObservation(row.raw_payload);
        const recordedEvidence = verifyEvidenceRecord(row.normalized_observation.evidence);
        if (!recordedEvidence.valid || recomputed.evidence.id !== row.evidence_id
          || recomputed.evidence.sha256 !== row.evidence_sha256
          || recomputed.evidence.byteLength !== row.evidence_bytes
          || row.normalized_observation.evidence.id !== row.evidence_id
          || row.normalized_observation.evidence.sha256 !== row.evidence_sha256
          || stableJson(recomputed) !== stableJson(row.normalized_observation)
          || row.source_payload_hash !== hashPayload(row.raw_payload)) {
          throw new GeoObservationError(409,"evidence_integrity_failure","The stored GEO observation failed its evidence integrity check.");
        }
        return {
          observationId:row.id,
          rawPayload:row.raw_payload,
          normalizedObservation:row.normalized_observation,
          evidence:row.normalized_observation.evidence,
          integrity:{valid:true,algorithm:"sha256"}
        };
      });
    },

    async aggregate(userId,projectId,options = {}) {
      requireUuid(userId,"user_id");
      requireUuid(projectId,"project_id");
      return withUserTransaction(database.pool,userId,async client => {
        await requireProject(client,userId,projectId,false);
        const result = await client.query(
          "SELECT normalized_observation FROM searqon.geo_observations WHERE project_id=$1 ORDER BY sampled_at DESC LIMIT 5000",
          [projectId]
        );
        return aggregateGeoObservations(result.rows.map(row => row.normalized_observation),options);
      });
    }
  });
}
