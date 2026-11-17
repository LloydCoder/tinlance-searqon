import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { withUserTransaction } from "./database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;
const CHANNELS = new Set(["slack","teams","pagerduty"]);
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const WRITERS = new Set(["owner","admin","analyst"]);
const TEAMS_HOST_SUFFIXES = [".webhook.office.com",".webhook.office365.com",".logic.azure.com",".webhook.microsoft.com"];

export class AlertDestinationError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "AlertDestinationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) throw new AlertDestinationError(400,"invalid_"+field,field+" must be a valid UUID.");
  return value;
}

function requireWorkerId(value) {
  if (typeof value !== "string" || !WORKER_ID.test(value)) throw new AlertDestinationError(400,"invalid_worker_id","A valid worker identity is required.");
  return value;
}

function normalizeKey(keyring, version = keyring?.currentVersion) {
  if (!keyring || typeof keyring !== "object" || Array.isArray(keyring)
    || (Object.getPrototypeOf(keyring) !== Object.prototype && Object.getPrototypeOf(keyring) !== null)
    || !keyring.keys || typeof keyring.keys !== "object" || Array.isArray(keyring.keys)
    || (Object.getPrototypeOf(keyring.keys) !== Object.prototype && Object.getPrototypeOf(keyring.keys) !== null)
    || typeof version !== "string" || !KEY_VERSION.test(version) || !Object.hasOwn(keyring.keys,version)) {
    throw new AlertDestinationError(503,"encryption_key_unavailable","A valid destination encryption key is not configured.");
  }
  const raw = keyring.keys[version];
  let key;
  if (Buffer.isBuffer(raw)) key = Buffer.from(raw);
  else if (typeof raw === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(raw)) key = Buffer.from(raw,"base64");
  if (!key || key.length !== 32) throw new AlertDestinationError(503,"encryption_key_unavailable","A 256-bit destination encryption key is unavailable.");
  return {version,key};
}

export function validateAlertDestinationSecret(channel, secret) {
  if (!CHANNELS.has(channel)) throw new AlertDestinationError(400,"invalid_channel","The alert destination channel is not supported.");
  if (typeof secret !== "string" || secret.length === 0 || Buffer.byteLength(secret,"utf8") > 2048
    || /[\u0000-\u001f\u007f]/.test(secret)) {
    throw new AlertDestinationError(400,"invalid_destination_secret","The destination credential is invalid.");
  }
  if (channel === "pagerduty") {
    if (!/^[A-Za-z0-9]{32,64}$/.test(secret)) {
      throw new AlertDestinationError(400,"invalid_destination_secret","PagerDuty routing keys must contain 32 to 64 alphanumeric characters.");
    }
    return secret;
  }
  let url;
  try { url = new URL(secret); }
  catch { throw new AlertDestinationError(400,"invalid_destination_secret","The destination must be a valid HTTPS webhook URL."); }
  const host = url.hostname.toLowerCase();
  const commonValid = url.protocol === "https:" && !url.username && !url.password
    && (!url.port || url.port === "443") && !url.hash && host.length > 0;
  if (!commonValid) throw new AlertDestinationError(400,"invalid_destination_secret","Only approved HTTPS webhook URLs are accepted.");
  if (channel === "slack") {
    if (host !== "hooks.slack.com" || !url.pathname.startsWith("/services/") || url.search) {
      throw new AlertDestinationError(400,"invalid_destination_secret","Slack destinations must use the official incoming-webhook host and path.");
    }
  } else if (!TEAMS_HOST_SUFFIXES.some(suffix => host.endsWith(suffix)) || url.pathname === "/") {
    throw new AlertDestinationError(400,"invalid_destination_secret","Teams destinations must use an approved Microsoft webhook host.");
  }
  return url.toString();
}

function snapshotKeyring(keyring) {
  const current = normalizeKey(keyring);
  const keys = Object.create(null);
  for (const version of Object.keys(keyring.keys)) {
    keys[version] = normalizeKey(keyring,version).key;
  }
  return Object.freeze({currentVersion:current.version,keys:Object.freeze(keys)});
}

function aad({organizationId,destinationId,channel,keyVersion}) {
  return Buffer.from(["searqon-alert-destination","v1",organizationId,destinationId,channel,keyVersion].join(":"));
}

export function encryptDestinationSecret({secret,organizationId,destinationId,channel,keyring} = {}) {
  requireUuid(organizationId,"organization_id");
  requireUuid(destinationId,"destination_id");
  const normalized = validateAlertDestinationSecret(channel,secret);
  const {version,key} = normalizeKey(keyring);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm",key,nonce);
  cipher.setAAD(aad({organizationId,destinationId,channel,keyVersion:version}));
  const ciphertext = Buffer.concat([cipher.update(normalized,"utf8"),cipher.final()]);
  return {
    ciphertext,
    nonce,
    tag:cipher.getAuthTag(),
    keyVersion:version,
    secretSha256:createHash("sha256").update(normalized).digest("hex")
  };
}

export function decryptDestinationSecret({ciphertext,nonce,tag,keyVersion,secretSha256,organizationId,destinationId,channel,keyring} = {}) {
  requireUuid(organizationId,"organization_id");
  requireUuid(destinationId,"destination_id");
  try {
    const {key} = normalizeKey(keyring,keyVersion);
    if (!Buffer.isBuffer(ciphertext) || !Buffer.isBuffer(nonce) || nonce.length !== 12
      || !Buffer.isBuffer(tag) || tag.length !== 16 || !/^[a-f0-9]{64}$/.test(secretSha256 ?? "")) {
      throw new Error("invalid encrypted destination fields");
    }
    const decipher = createDecipheriv("aes-256-gcm",key,nonce);
    decipher.setAAD(aad({organizationId,destinationId,channel,keyVersion}));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString("utf8");
    if (createHash("sha256").update(plaintext).digest("hex") !== secretSha256) throw new Error("destination digest mismatch");
    return validateAlertDestinationSecret(channel,plaintext);
  } catch {
    throw new AlertDestinationError(503,"destination_secret_unavailable","The encrypted destination could not be authenticated or decrypted.");
  }
}

function destinationRow(row) {
  return {
    id:row.id,
    organizationId:row.organization_id,
    channel:row.channel,
    displayName:row.display_name,
    status:row.status,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    lastVerifiedAt:row.last_verified_at
  };
}

async function requireWriter(client,organizationId,userId) {
  const result = await client.query(
    "SELECT role FROM searqon.memberships WHERE organization_id=$1 AND user_id=$2",
    [organizationId,userId]
  );
  const role = result.rows?.[0]?.role;
  if (!role) throw new AlertDestinationError(404,"workspace_not_found","The requested workspace was not found.");
  if (!WRITERS.has(role)) throw new AlertDestinationError(403,"insufficient_role","Your workspace role cannot manage alert destinations.");
}

async function appendAudit(client,organizationId,userId,eventType,destinationId,metadata) {
  await client.query(
    "INSERT INTO searqon.audit_events (organization_id,actor_user_id,event_type,subject_type,subject_id,metadata) VALUES ($1,$2,$3,'alert_destination',$4,$5::jsonb)",
    [organizationId,userId,eventType,destinationId,JSON.stringify(metadata)]
  );
}

async function withWorkerTransaction(pool,workerId,leaseToken,operation) {
  if (!pool || typeof pool.connect !== "function") {
    throw new AlertDestinationError(503,"worker_unavailable","A dedicated worker database pool is not configured.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE searqon_worker");
    await client.query("SELECT set_config('searqon.worker_id',$1,true)",[workerId]);
    await client.query("SELECT set_config('searqon.lease_token',$1,true)",[leaseToken]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally {
    client.release();
  }
}

export function createAlertDestinationStore({database,workerPool=null,encryptionKeyring} = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }
  if (!encryptionKeyring || typeof encryptionKeyring !== "object") {
    throw new TypeError("A valid destination encryption keyring is required.");
  }
  const keyring = snapshotKeyring(encryptionKeyring);

  return Object.freeze({
    async create(userId,organizationId,input) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new AlertDestinationError(400,"invalid_request","Alert destination details are required.");
      }
      if (!CHANNELS.has(input.channel)) throw new AlertDestinationError(400,"invalid_channel","The alert destination channel is not supported.");
      const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
      if (!displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) {
        throw new AlertDestinationError(400,"invalid_display_name","Destination display name must contain 1 to 80 safe characters.");
      }
      const id = randomUUID();
      const encrypted = encryptDestinationSecret({
        secret:input.secret,organizationId,destinationId:id,channel:input.channel,keyring
      });
      return withUserTransaction(database.pool,userId,async client => {
        await requireWriter(client,organizationId,userId);
        const result = await client.query(
          `INSERT INTO searqon.alert_destinations
            (id,organization_id,created_by,channel,display_name,secret_ciphertext,secret_nonce,secret_tag,key_version,secret_sha256,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'enabled')
           RETURNING id,organization_id,channel,display_name,status,created_at,updated_at,last_verified_at`,
          [id,organizationId,userId,input.channel,displayName,encrypted.ciphertext,encrypted.nonce,encrypted.tag,encrypted.keyVersion,encrypted.secretSha256]
        );
        await appendAudit(client,organizationId,userId,"alert_destination.created",id,{
          channel:input.channel,displayName,secretSha256:encrypted.secretSha256
        });
        return destinationRow(result.rows[0]);
      });
    },

    async list(userId,organizationId) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      return withUserTransaction(database.pool,userId,async client => {
        const result = await client.query(
          "SELECT id,organization_id,channel,display_name,status,created_at,updated_at,last_verified_at FROM searqon.alert_destinations WHERE organization_id=$1 ORDER BY created_at DESC,id DESC",
          [organizationId]
        );
        return result.rows.map(destinationRow);
      });
    },

    async disable(userId,organizationId,destinationId) {
      requireUuid(userId,"user_id");
      requireUuid(organizationId,"organization_id");
      requireUuid(destinationId,"destination_id");
      return withUserTransaction(database.pool,userId,async client => {
        await requireWriter(client,organizationId,userId);
        const result = await client.query(
          "UPDATE searqon.alert_destinations SET status='disabled',updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING id,organization_id,channel,display_name,status,created_at,updated_at,last_verified_at",
          [organizationId,destinationId]
        );
        if (!result.rows[0]) throw new AlertDestinationError(404,"destination_not_found","The alert destination was not found.");
        await appendAudit(client,organizationId,userId,"alert_destination.disabled",destinationId,{channel:result.rows[0].channel});
        return destinationRow(result.rows[0]);
      });
    },

    async getDelivery(workerId,deliveryId,jobId,leaseToken) {
      requireWorkerId(workerId);
      requireUuid(deliveryId,"delivery_id");
      requireUuid(jobId,"job_id");
      requireUuid(leaseToken,"lease_token");
      return withWorkerTransaction(workerPool,workerId,leaseToken,async client => {
        const result = await client.query(
          `SELECT o.id,o.organization_id,o.status,o.event_id,o.destination_id,o.job_id,
                  e.state AS event_state,e.payload AS event_payload,
                  d.channel,d.display_name,d.status AS destination_status,
                  d.secret_ciphertext,d.secret_nonce,d.secret_tag,d.key_version,d.secret_sha256
           FROM searqon.alert_delivery_outbox o
           JOIN searqon.jobs j ON j.id=o.job_id AND j.organization_id=o.organization_id
           JOIN searqon.geo_alert_events e ON e.id=o.event_id AND e.organization_id=o.organization_id
           JOIN searqon.alert_destinations d ON d.id=o.destination_id AND d.organization_id=o.organization_id
           WHERE o.id=$1 AND o.job_id=$2
             AND j.status='leased' AND j.lease_owner=$3 AND j.lease_token=$4 AND j.lease_expires_at > now()`,
          [deliveryId,jobId,workerId,leaseToken]
        );
        const row = result.rows[0];
        if (!row) return null;
        if (row.status !== "queued") {
          return {id:row.id,organizationId:row.organization_id,status:row.status,alreadyTerminal:true};
        }
        if (row.destination_status !== "enabled" || row.event_state !== "emitted") {
          return {
            id:row.id,organizationId:row.organization_id,status:"cancelled",
            destinationDisabled:row.destination_status !== "enabled"
          };
        }
        const secret = decryptDestinationSecret({
          ciphertext:row.secret_ciphertext,nonce:row.secret_nonce,tag:row.secret_tag,
          keyVersion:row.key_version,secretSha256:row.secret_sha256,
          organizationId:row.organization_id,destinationId:row.destination_id,channel:row.channel,keyring
        });
        return {
          id:row.id,organizationId:row.organization_id,status:row.status,
          eventId:row.event_id,jobId:row.job_id,eventPayload:row.event_payload,
          destination:{
            id:row.destination_id,channel:row.channel,displayName:row.display_name,secret
          }
        };
      });
    },

    async markDelivered(workerId,deliveryId,jobId,leaseToken,{providerReceiptId=null} = {}) {
      requireWorkerId(workerId);
      requireUuid(deliveryId,"delivery_id");
      requireUuid(jobId,"job_id");
      requireUuid(leaseToken,"lease_token");
      if (providerReceiptId !== null
        && (typeof providerReceiptId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(providerReceiptId))) {
        throw new AlertDestinationError(400,"invalid_provider_receipt","The provider receipt identifier is invalid.");
      }
      return withWorkerTransaction(workerPool,workerId,async client => {
        const updated = await client.query(
          `UPDATE searqon.alert_delivery_outbox o
           SET status='delivered',provider_receipt_id=$5,delivered_at=now(),updated_at=now()
           WHERE o.id=$1 AND o.job_id=$2 AND o.status='queued'
             AND EXISTS (
               SELECT 1 FROM searqon.jobs j
               WHERE j.id=o.job_id AND j.organization_id=o.organization_id
                 AND j.status='leased' AND j.lease_owner=$3 AND j.lease_token=$4 AND j.lease_expires_at > now()
             )
           RETURNING o.id,o.status,o.delivered_at,o.provider_receipt_id`,
          [deliveryId,jobId,workerId,leaseToken,providerReceiptId]
        );
        if (updated.rows[0]) return {accepted:true,idempotentReplay:false,...updated.rows[0]};
        const existing = await client.query(
          "SELECT id,status,delivered_at,provider_receipt_id FROM searqon.alert_delivery_outbox WHERE id=$1 AND job_id=$2",
          [deliveryId,jobId]
        );
        if (existing.rows[0]?.status === "delivered") {
          return {accepted:true,idempotentReplay:true,...existing.rows[0]};
        }
        return {accepted:false,reason:"lease_lost"};
      });
    },

    async markFailed(workerId,deliveryId,jobId,leaseToken,{errorCode} = {}) {
      requireWorkerId(workerId);
      requireUuid(deliveryId,"delivery_id");
      requireUuid(jobId,"job_id");
      requireUuid(leaseToken,"lease_token");
      if (typeof errorCode !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(errorCode)) {
        throw new AlertDestinationError(400,"invalid_error_code","A bounded machine-readable delivery error code is required.");
      }
      return withWorkerTransaction(workerPool,workerId,async client => {
        const updated = await client.query(
          `UPDATE searqon.alert_delivery_outbox o
           SET status='failed',last_error_code=$5,updated_at=now()
           WHERE o.id=$1 AND o.job_id=$2 AND o.status='queued'
             AND EXISTS (
               SELECT 1 FROM searqon.jobs j
               WHERE j.id=o.job_id AND j.organization_id=o.organization_id
                 AND j.status='leased' AND j.lease_owner=$3 AND j.lease_token=$4
                 AND j.lease_expires_at > now() AND j.attempts >= j.max_attempts
             )
           RETURNING o.id,o.status,o.last_error_code`,
          [deliveryId,jobId,workerId,leaseToken,errorCode]
        );
        if (updated.rows[0]) return {accepted:true,...updated.rows[0]};
        return {accepted:false,reason:"lease_lost_or_attempts_remaining"};
      });
    },

    async markCancelled(workerId,deliveryId,jobId,leaseToken) {
      requireWorkerId(workerId);
      requireUuid(deliveryId,"delivery_id");
      requireUuid(jobId,"job_id");
      requireUuid(leaseToken,"lease_token");
      return withWorkerTransaction(workerPool,workerId,async client => {
        const updated = await client.query(
          `UPDATE searqon.alert_delivery_outbox o
           SET status='cancelled',last_error_code='destination_disabled',updated_at=now()
           WHERE o.id=$1 AND o.job_id=$2 AND o.status='queued'
             AND EXISTS (
               SELECT 1 FROM searqon.jobs j
               WHERE j.id=o.job_id AND j.organization_id=o.organization_id
                 AND j.status='leased' AND j.lease_owner=$3 AND j.lease_token=$4 AND j.lease_expires_at > now()
             )
           RETURNING o.id,o.status,o.last_error_code`,
          [deliveryId,jobId,workerId,leaseToken]
        );
        if (updated.rows[0]) return {accepted:true,...updated.rows[0]};
        return {accepted:false,reason:"lease_lost"};
      });
    }
  });
}
