import { createHash } from "node:crypto";
import { withUserTransaction } from "./database.js";
import { ENTITLEMENTS, quoteOverage } from "./entitlements.js";

const METERS = Object.freeze({
  ai_answer_checks: "aiAnswerChecksPerMonth",
  crawl_pages: "crawlPagesPerMonth",
  keyword_months: "trackedKeywords",
  api_requests: "apiRequestsPerMonth"
});
const METER_CEILINGS = Object.freeze({
  ai_answer_checks: "aiAnswerChecksPerMonth",
  crawl_pages: "crawlPagesPerMonth",
  keyword_months: "trackedKeywords",
  api_requests: "apiRequestsPerMonth"
});
const WRITERS = new Set(["owner", "admin", "analyst"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const RELEASE_REASONS = new Set(["cancelled_before_dispatch", "provider_failed", "operator_cancelled", "reservation_expired"]);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export class UsageLedgerError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "UsageLedgerError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new UsageLedgerError(400, "invalid_" + field, field + " must be a valid identifier.");
  }
  return value;
}

function requireSafeInteger(value, field, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new UsageLedgerError(400, "invalid_" + field, field + " must be a safe integer of at least " + minimum + ".");
  }
  return value;
}

function timestamp(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new UsageLedgerError(400, "invalid_" + field, field + " must be an ISO timestamp.");
  }
  return new Date(value);
}

function numberValue(value, field) {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < 0n || parsed > MAX_SAFE_BIGINT) throw new RangeError(field + " exceeds supported integer precision.");
  return Number(parsed);
}

function reservationRow(row, idempotentReplay = false) {
  return {
    id: row.id,
    createdBy: row.created_by,
    meter: row.meter,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    requestedUnits: numberValue(row.requested_units, "requested_units"),
    includedReservedUnits: numberValue(row.included_reserved_units, "included_reserved_units"),
    overageReservedUnits: numberValue(row.overage_reserved_units, "overage_reserved_units"),
    reservedAmountMicroUsd: numberValue(row.reserved_amount_micro_usd, "reserved_amount_micro_usd"),
    status: row.status,
    actualUnits: row.actual_units === null ? null : numberValue(row.actual_units, "actual_units"),
    chargedAmountMicroUsd: row.charged_amount_micro_usd === null ? null : numberValue(row.charged_amount_micro_usd, "charged_amount_micro_usd"),
    createdAt: row.created_at,
    settledAt: row.settled_at,
    expiresAt: row.expires_at,
    idempotentReplay
  };
}

function counterRow(row) {
  return {
    organizationId: row.organization_id,
    meter: row.meter,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    includedLimit: numberValue(row.included_limit, "included_limit"),
    consumedUnits: numberValue(row.consumed_units, "consumed_units"),
    reservedUnits: numberValue(row.reserved_units, "reserved_units"),
    overageEnabled: row.overage_enabled,
    spendCapMicroUsd: numberValue(row.spend_cap_micro_usd, "spend_cap_micro_usd"),
    overageSpentMicroUsd: numberValue(row.overage_spent_micro_usd, "overage_spent_micro_usd"),
    overageReservedMicroUsd: numberValue(row.overage_reserved_micro_usd, "overage_reserved_micro_usd")
  };
}

function ensurePeriod(start, end) {
  const periodStart = timestamp(start, "period_start");
  const periodEnd = timestamp(end, "period_end");
  if (periodEnd <= periodStart) throw new UsageLedgerError(400, "invalid_period", "The usage period end must be after its start.");
  return { periodStart, periodEnd };
}

function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function quoteStoredRate(quantity, rate, block) {
  if (quantity === 0) return 0;
  if (!Number.isSafeInteger(rate) || rate <= 0 || !Number.isSafeInteger(block) || block <= 0) {
    throw new UsageLedgerError(409, "overage_rate_unavailable", "The reserved overage rate is no longer valid.");
  }
  const amount = Math.ceil((quantity * rate) / block);
  if (!Number.isSafeInteger(amount)) throw new RangeError("Overage settlement exceeds safe integer precision.");
  return amount;
}

async function requireUsageWriter(client, organizationId, userId) {
  const result = await client.query(
    "SELECT role FROM searqon.memberships WHERE organization_id = $1 AND user_id = $2",
    [organizationId, userId]
  );
  const role = result.rows?.[0]?.role;
  if (!role) throw new UsageLedgerError(404, "usage_period_not_found", "The requested workspace usage was not found.");
  if (!WRITERS.has(role)) throw new UsageLedgerError(403, "insufficient_role", "Your workspace role cannot reserve or settle billable usage.");
}

async function appendLedgerEntry(client, { organizationId, actorUserId, reservationId, meter, periodStart, eventType, quantityDelta, amountDeltaMicroUsd, metadata = {} }) {
  await client.query(
    `INSERT INTO searqon.usage_ledger_entries
      (organization_id, actor_user_id, reservation_id, meter, period_start, event_type, quantity_delta, amount_delta_micro_usd, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [organizationId, actorUserId, reservationId, meter, periodStart, eventType, quantityDelta, amountDeltaMicroUsd, JSON.stringify(metadata)]
  );
}

export function createUsageLedger({ database, getEntitlements, reservationTtlSeconds = 900 } = {}) {
  if (!database?.pool || typeof database.pool.connect !== "function") {
    throw new TypeError("A PostgreSQL database pool is required.");
  }
  if (typeof getEntitlements !== "function") {
    throw new TypeError("A trusted server-side entitlement resolver is required.");
  }
  if (!Number.isSafeInteger(reservationTtlSeconds) || reservationTtlSeconds < 30 || reservationTtlSeconds > 3600) {
    throw new RangeError("reservationTtlSeconds must be between 30 and 3600.");
  }

  return Object.freeze({
    async reserve(userId, organizationId, input) {
      requireUuid(userId, "user_id");
      requireUuid(organizationId, "organization_id");
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new UsageLedgerError(400, "invalid_request", "Usage reservation details are required.");
      const { meter } = input;
      const limitKey = METERS[meter];
      if (!limitKey) throw new UsageLedgerError(400, "invalid_meter", "The requested usage meter is not supported.");
      const quantity = requireSafeInteger(input.quantity, "quantity", { minimum: 1 });
      if (typeof input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        throw new UsageLedgerError(400, "invalid_idempotency_key", "A valid idempotency key between 8 and 128 safe characters is required.");
      }

      return withUserTransaction(database.pool, userId, async client => {
        await requireUsageWriter(client, organizationId, userId);
        // Serialize the idempotency namespace before checking or creating a reservation.
        // Hash collisions only serialize unrelated requests; they cannot weaken correctness.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [organizationId + ":" + input.idempotencyKey]);
        const entitlements = await getEntitlements(client, organizationId);
        if (!entitlements || !ENTITLEMENTS.plans[entitlements.plan]) {
          throw new UsageLedgerError(503, "entitlement_unavailable", "A valid server-side subscription plan could not be resolved.");
        }
        // Billing-period boundaries must come from canonical server-side subscription state,
        // never from request parameters that a customer could vary to reset quota.
        let period;
        try {
          period = ensurePeriod(entitlements.billingPeriod?.start, entitlements.billingPeriod?.end);
        } catch {
          throw new UsageLedgerError(503, "billing_period_unavailable", "The canonical subscription billing period could not be resolved.");
        }
        const { periodStart, periodEnd } = period;
        const existing = await client.query(
          "SELECT * FROM searqon.usage_reservations WHERE organization_id = $1 AND idempotency_key = $2",
          [organizationId, input.idempotencyKey]
        );
        if (existing.rows[0]) {
          const row = existing.rows[0];
          const matches = row.meter === meter
            && new Date(row.period_start).getTime() === periodStart.getTime()
            && new Date(row.period_end).getTime() === periodEnd.getTime()
            && numberValue(row.requested_units, "requested_units") === quantity;
          if (!matches) throw new UsageLedgerError(409, "idempotency_key_conflict", "The idempotency key was already used for a different usage request.");
          return reservationRow(row, true);
        }
        const includedLimit = entitlements?.limits?.[limitKey];
        const hardQuotaCeiling = ENTITLEMENTS.hardSafetyCeilings[METER_CEILINGS[meter]];
        if (!Number.isSafeInteger(includedLimit) || includedLimit < 0 || includedLimit > hardQuotaCeiling || quantity > hardQuotaCeiling) {
          throw new UsageLedgerError(503, "entitlement_unavailable", "A valid server-side usage entitlement could not be resolved.");
        }
        const overageEnabled = entitlements.overage?.enabled === true;
        const spendCapMicroUsd = requireSafeInteger(entitlements.overage?.spendCapMicroUsd ?? 0, "spend_cap_micro_usd");
        const policyFingerprint = createHash("sha256").update(stableJson({
          entitlementVersion: ENTITLEMENTS.version,
          plan: entitlements.plan,
          limits: entitlements.limits,
          features: entitlements.features,
          overageRatesMicroUsd: entitlements.overageRatesMicroUsd,
          overage: { enabled: overageEnabled, spendCapMicroUsd }
        })).digest("hex");
        if (spendCapMicroUsd > ENTITLEMENTS.hardSafetyCeilings.maxOverageSpendMicroUsd) {
          throw new UsageLedgerError(409, "platform_spend_ceiling", "The workspace spend cap exceeds the platform safety ceiling.");
        }
        if (!overageEnabled && spendCapMicroUsd !== 0) {
          throw new UsageLedgerError(409, "invalid_overage_policy", "A spend cap cannot be configured while overage is disabled.");
        }

        await client.query(
          `INSERT INTO searqon.usage_spend_periods
            (organization_id, period_start, period_end, plan, policy_fingerprint, overage_enabled, spend_cap_micro_usd)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (organization_id, period_start) DO NOTHING`,
          [organizationId, periodStart, periodEnd, entitlements.plan, policyFingerprint, overageEnabled, spendCapMicroUsd]
        );
        const spendLocked = await client.query(
          `SELECT * FROM searqon.usage_spend_periods
           WHERE organization_id = $1 AND period_start = $2 FOR UPDATE`,
          [organizationId, periodStart]
        );
        const spendPeriod = spendLocked.rows[0];
        if (!spendPeriod || new Date(spendPeriod.period_end).getTime() !== periodEnd.getTime()
          || spendPeriod.plan !== entitlements.plan
          || spendPeriod.policy_fingerprint !== policyFingerprint
          || spendPeriod.overage_enabled !== overageEnabled
          || numberValue(spendPeriod.spend_cap_micro_usd, "spend_cap_micro_usd") !== spendCapMicroUsd) {
          throw new UsageLedgerError(409, "usage_policy_changed", "The usage spend policy for this billing period is fixed; apply changes at a new period boundary.");
        }

        await client.query(
          `INSERT INTO searqon.usage_period_counters
            (organization_id, meter, period_start, period_end, included_limit)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (organization_id, meter, period_start) DO NOTHING`,
          [organizationId, meter, periodStart, periodEnd, includedLimit]
        );
        const locked = await client.query(
          `SELECT * FROM searqon.usage_period_counters
           WHERE organization_id = $1 AND meter = $2 AND period_start = $3
           FOR UPDATE`,
          [organizationId, meter, periodStart]
        );
        const counter = locked.rows[0];
        if (!counter || new Date(counter.period_end).getTime() !== periodEnd.getTime()
          || numberValue(counter.included_limit, "included_limit") !== includedLimit) {
          throw new UsageLedgerError(409, "usage_policy_changed", "The usage policy for this billing period is fixed; apply plan changes at a new period boundary.");
        }

        const consumed = numberValue(counter.consumed_units, "consumed_units");
        const reserved = numberValue(counter.reserved_units, "reserved_units");
        if (consumed + reserved + quantity > hardQuotaCeiling) {
          throw new UsageLedgerError(409, "platform_usage_ceiling", "The platform hard safety ceiling for this usage meter would be exceeded.");
        }
        const availableIncluded = Math.max(0, includedLimit - consumed - reserved);
        const includedReservedUnits = Math.min(quantity, availableIncluded);
        const overageReservedUnits = quantity - includedReservedUnits;
        let reservedAmountMicroUsd = 0;
        let overageRateMicroUsdPerBlock = 0;
        let overageBlock = 1;

        if (overageReservedUnits > 0) {
          if (!overageEnabled || spendCapMicroUsd <= 0) {
            throw new UsageLedgerError(409, "included_allowance_exhausted", "The included usage allowance is exhausted and overage is not enabled.");
          }
          const quote = quoteOverage({ plan: entitlements.plan, meter, quantity: overageReservedUnits });
          if (!quote.allowed) throw new UsageLedgerError(409, quote.reason, "Overage is not available for this meter and plan.");
          reservedAmountMicroUsd = quote.amountMicroUsd;
          overageRateMicroUsdPerBlock = quote.rateMicroUsdPerBlock;
          overageBlock = quote.block;
          const spent = numberValue(spendPeriod.overage_spent_micro_usd, "overage_spent_micro_usd");
          const alreadyReserved = numberValue(spendPeriod.overage_reserved_micro_usd, "overage_reserved_micro_usd");
          if (spent + alreadyReserved + reservedAmountMicroUsd > spendCapMicroUsd) {
            throw new UsageLedgerError(409, "overage_spend_cap_exhausted", "The workspace overage spend cap would be exceeded.");
          }
        }

        const inserted = await client.query(
          `INSERT INTO searqon.usage_reservations
            (organization_id, created_by, meter, period_start, period_end, idempotency_key, requested_units,
             included_reserved_units, overage_reserved_units, reserved_amount_micro_usd,
             overage_rate_micro_usd_per_block, overage_block, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + ($13 * interval '1 second'))
           ON CONFLICT (organization_id, idempotency_key) DO NOTHING
           RETURNING *`,
          [organizationId, userId, meter, periodStart, periodEnd, input.idempotencyKey, quantity,
            includedReservedUnits, overageReservedUnits, reservedAmountMicroUsd,
            overageRateMicroUsdPerBlock, overageBlock, reservationTtlSeconds]
        );
        if (!inserted.rows[0]) {
          const raced = await client.query(
            "SELECT * FROM searqon.usage_reservations WHERE organization_id = $1 AND idempotency_key = $2",
            [organizationId, input.idempotencyKey]
          );
          const row = raced.rows[0];
          if (!row || row.meter !== meter || new Date(row.period_start).getTime() !== periodStart.getTime()
            || new Date(row.period_end).getTime() !== periodEnd.getTime()
            || numberValue(row.requested_units, "requested_units") !== quantity) {
            throw new UsageLedgerError(409, "idempotency_key_conflict", "The idempotency key was concurrently used for a different usage request.");
          }
          return reservationRow(row, true);
        }

        await client.query(
          `UPDATE searqon.usage_period_counters
           SET reserved_units = reserved_units + $4, updated_at = now()
           WHERE organization_id = $1 AND meter = $2 AND period_start = $3`,
          [organizationId, meter, periodStart, quantity]
        );
        await client.query(
          `UPDATE searqon.usage_spend_periods
           SET overage_reserved_micro_usd = overage_reserved_micro_usd + $3, updated_at = now()
           WHERE organization_id = $1 AND period_start = $2`,
          [organizationId, periodStart, reservedAmountMicroUsd]
        );
        const row = inserted.rows[0];
        await appendLedgerEntry(client, {
          organizationId, actorUserId: userId, reservationId: row.id, meter, periodStart,
          eventType: "reserved", quantityDelta: quantity, amountDeltaMicroUsd: reservedAmountMicroUsd,
          metadata: { includedUnits: includedReservedUnits, overageUnits: overageReservedUnits }
        });
        return reservationRow(row);
      });
    },

    async settle(userId, organizationId, reservationId, { actualUnits } = {}) {
      requireUuid(userId, "user_id");
      requireUuid(organizationId, "organization_id");
      requireUuid(reservationId, "reservation_id");
      requireSafeInteger(actualUnits, "actual_units");
      return withUserTransaction(database.pool, userId, async client => {
        await requireUsageWriter(client, organizationId, userId);
        const selected = await client.query(
          "SELECT *, (expires_at > now()) AS not_expired FROM searqon.usage_reservations WHERE organization_id = $1 AND id = $2 FOR UPDATE",
          [organizationId, reservationId]
        );
        const reservation = selected.rows[0];
        if (!reservation) throw new UsageLedgerError(404, "reservation_not_found", "The usage reservation was not found.");
        if (reservation.status === "settled") {
          if (numberValue(reservation.actual_units, "actual_units") !== actualUnits) {
            throw new UsageLedgerError(409, "reservation_already_settled", "The reservation was already settled with a different usage amount.");
          }
          return reservationRow(reservation, true);
        }
        if (reservation.status !== "reserved") throw new UsageLedgerError(409, "reservation_not_active", "Only an active usage reservation can be settled.");
        if (!reservation.not_expired) {
          throw new UsageLedgerError(409, "reservation_expired", "The usage reservation expired; release it and create a new reservation before dispatch.");
        }
        const requested = numberValue(reservation.requested_units, "requested_units");
        if (actualUnits > requested) throw new UsageLedgerError(409, "reservation_underfunded", "Actual usage exceeds the reserved quantity; reserve the additional usage before settlement.");

        const spendLocked = await client.query(
          `SELECT * FROM searqon.usage_spend_periods
           WHERE organization_id = $1 AND period_start = $2 FOR UPDATE`,
          [organizationId, reservation.period_start]
        );
        const spendPeriod = spendLocked.rows[0];
        if (!spendPeriod) throw new UsageLedgerError(500, "usage_spend_period_missing", "The spend-control record for this reservation is missing.");
        const locked = await client.query(
          `SELECT * FROM searqon.usage_period_counters
           WHERE organization_id = $1 AND meter = $2 AND period_start = $3 FOR UPDATE`,
          [organizationId, reservation.meter, reservation.period_start]
        );
        const counter = locked.rows[0];
        if (!counter) throw new UsageLedgerError(500, "usage_counter_missing", "The usage counter for this reservation is missing.");

        const includedReserved = numberValue(reservation.included_reserved_units, "included_reserved_units");
        const actualOverageUnits = Math.max(0, actualUnits - includedReserved);
        const rate = numberValue(reservation.overage_rate_micro_usd_per_block, "overage_rate_micro_usd_per_block");
        const block = numberValue(reservation.overage_block, "overage_block");
        const chargedAmountMicroUsd = quoteStoredRate(actualOverageUnits, rate, block);
        const reservedAmount = numberValue(reservation.reserved_amount_micro_usd, "reserved_amount_micro_usd");
        if (chargedAmountMicroUsd > reservedAmount) {
          throw new UsageLedgerError(500, "settlement_exceeds_reservation", "The computed settlement exceeds its reserved overage amount.");
        }

        await client.query(
          `UPDATE searqon.usage_period_counters
           SET consumed_units = consumed_units + $4,
               reserved_units = reserved_units - $5,
               updated_at = now()
           WHERE organization_id = $1 AND meter = $2 AND period_start = $3`,
          [organizationId, reservation.meter, reservation.period_start, actualUnits, requested]
        );
        await client.query(
          `UPDATE searqon.usage_spend_periods
           SET overage_reserved_micro_usd = overage_reserved_micro_usd - $3,
               overage_spent_micro_usd = overage_spent_micro_usd + $4,
               updated_at = now()
           WHERE organization_id = $1 AND period_start = $2`,
          [organizationId, reservation.period_start, reservedAmount, chargedAmountMicroUsd]
        );
        const updated = await client.query(
          `UPDATE searqon.usage_reservations
           SET status = 'settled', actual_units = $3, charged_amount_micro_usd = $4, settled_at = now()
           WHERE organization_id = $1 AND id = $2 RETURNING *`,
          [organizationId, reservationId, actualUnits, chargedAmountMicroUsd]
        );
        await appendLedgerEntry(client, {
          organizationId, actorUserId: userId, reservationId, meter: reservation.meter, periodStart: reservation.period_start,
          eventType: "settled", quantityDelta: actualUnits, amountDeltaMicroUsd: chargedAmountMicroUsd,
          metadata: { releasedUnits: requested - actualUnits, releasedAmountMicroUsd: reservedAmount - chargedAmountMicroUsd }
        });
        return reservationRow(updated.rows[0]);
      });
    },

    async release(userId, organizationId, reservationId, { reason = "operator_cancelled" } = {}) {
      requireUuid(userId, "user_id");
      requireUuid(organizationId, "organization_id");
      requireUuid(reservationId, "reservation_id");
      if (!RELEASE_REASONS.has(reason)) throw new UsageLedgerError(400, "invalid_release_reason", "The reservation release reason is not supported.");
      return withUserTransaction(database.pool, userId, async client => {
        await requireUsageWriter(client, organizationId, userId);
        const selected = await client.query(
          "SELECT * FROM searqon.usage_reservations WHERE organization_id = $1 AND id = $2 FOR UPDATE",
          [organizationId, reservationId]
        );
        const reservation = selected.rows[0];
        if (!reservation) throw new UsageLedgerError(404, "reservation_not_found", "The usage reservation was not found.");
        if (reservation.status === "released") return reservationRow(reservation, true);
        if (reservation.status !== "reserved") throw new UsageLedgerError(409, "reservation_not_active", "Only an active usage reservation can be released.");

        const requested = numberValue(reservation.requested_units, "requested_units");
        const reservedAmount = numberValue(reservation.reserved_amount_micro_usd, "reserved_amount_micro_usd");
        const spendLocked = await client.query(
          `SELECT organization_id FROM searqon.usage_spend_periods
           WHERE organization_id = $1 AND period_start = $2 FOR UPDATE`,
          [organizationId, reservation.period_start]
        );
        if (!spendLocked.rows[0]) throw new UsageLedgerError(500, "usage_spend_period_missing", "The spend-control record for this reservation is missing.");
        await client.query(
          `UPDATE searqon.usage_period_counters
           SET reserved_units = reserved_units - $4, updated_at = now()
           WHERE organization_id = $1 AND meter = $2 AND period_start = $3`,
          [organizationId, reservation.meter, reservation.period_start, requested]
        );
        await client.query(
          `UPDATE searqon.usage_spend_periods
           SET overage_reserved_micro_usd = overage_reserved_micro_usd - $3, updated_at = now()
           WHERE organization_id = $1 AND period_start = $2`,
          [organizationId, reservation.period_start, reservedAmount]
        );
        const updated = await client.query(
          `UPDATE searqon.usage_reservations
           SET status = 'released', release_reason = $3, settled_at = now()
           WHERE organization_id = $1 AND id = $2 RETURNING *`,
          [organizationId, reservationId, reason]
        );
        await appendLedgerEntry(client, {
          organizationId, actorUserId: userId, reservationId, meter: reservation.meter, periodStart: reservation.period_start,
          eventType: "released", quantityDelta: 0, amountDeltaMicroUsd: 0,
          metadata: { releasedUnits: requested, releasedAmountMicroUsd: reservedAmount, reason }
        });
        return reservationRow(updated.rows[0]);
      });
    },


    async releaseExpired(userId, organizationId, { limit = 100 } = {}) {
      requireUuid(userId, "user_id");
      requireUuid(organizationId, "organization_id");
      requireSafeInteger(limit, "limit", { minimum: 1 });
      if (limit > 500) throw new UsageLedgerError(400, "invalid_limit", "The expiry batch limit cannot exceed 500.");
      return withUserTransaction(database.pool, userId, async client => {
        await requireUsageWriter(client, organizationId, userId);
        const expired = await client.query(
          `SELECT * FROM searqon.usage_reservations
           WHERE organization_id = $1 AND status = 'reserved' AND expires_at <= now()
           ORDER BY expires_at, id
           LIMIT $2
           FOR UPDATE SKIP LOCKED`,
          [organizationId, limit]
        );
        const released = [];
        for (const reservation of expired.rows) {
          const spendLocked = await client.query(
            `SELECT organization_id FROM searqon.usage_spend_periods
             WHERE organization_id = $1 AND period_start = $2 FOR UPDATE`,
            [organizationId, reservation.period_start]
          );
          if (!spendLocked.rows[0]) throw new UsageLedgerError(500, "usage_spend_period_missing", "The spend-control record for an expired reservation is missing.");
          const locked = await client.query(
            `SELECT * FROM searqon.usage_period_counters
             WHERE organization_id = $1 AND meter = $2 AND period_start = $3 FOR UPDATE`,
            [organizationId, reservation.meter, reservation.period_start]
          );
          if (!locked.rows[0]) throw new UsageLedgerError(500, "usage_counter_missing", "The usage counter for an expired reservation is missing.");
          const requested = numberValue(reservation.requested_units, "requested_units");
          const reservedAmount = numberValue(reservation.reserved_amount_micro_usd, "reserved_amount_micro_usd");
          await client.query(
            `UPDATE searqon.usage_period_counters
             SET reserved_units = reserved_units - $4, updated_at = now()
             WHERE organization_id = $1 AND meter = $2 AND period_start = $3`,
            [organizationId, reservation.meter, reservation.period_start, requested]
          );
          await client.query(
            `UPDATE searqon.usage_spend_periods
             SET overage_reserved_micro_usd = overage_reserved_micro_usd - $3, updated_at = now()
             WHERE organization_id = $1 AND period_start = $2`,
            [organizationId, reservation.period_start, reservedAmount]
          );
          const updated = await client.query(
            `UPDATE searqon.usage_reservations
             SET status = 'released', release_reason = 'reservation_expired', settled_at = now()
             WHERE organization_id = $1 AND id = $2 AND status = 'reserved' RETURNING *`,
            [organizationId, reservation.id]
          );
          if (updated.rows[0]) {
            await appendLedgerEntry(client, {
              organizationId, actorUserId: userId, reservationId: reservation.id, meter: reservation.meter, periodStart: reservation.period_start,
              eventType: "released", quantityDelta: 0, amountDeltaMicroUsd: 0,
              metadata: { releasedUnits: requested, releasedAmountMicroUsd: reservedAmount, reason: "reservation_expired" }
            });
            released.push(reservationRow(updated.rows[0]));
          }
        }
        return { releasedCount: released.length, reservations: released };
      });
    },

    async getPeriod(userId, organizationId, meter, periodStart) {
      requireUuid(userId, "user_id");
      requireUuid(organizationId, "organization_id");
      if (!METERS[meter]) throw new UsageLedgerError(400, "invalid_meter", "The requested usage meter is not supported.");
      const start = timestamp(periodStart, "period_start");
      return withUserTransaction(database.pool, userId, async client => {
        await requireUsageWriter(client, organizationId, userId);
        const result = await client.query(
          `SELECT c.*, s.overage_enabled, s.spend_cap_micro_usd, s.overage_spent_micro_usd, s.overage_reserved_micro_usd
           FROM searqon.usage_period_counters c
           JOIN searqon.usage_spend_periods s
             ON s.organization_id = c.organization_id AND s.period_start = c.period_start
           WHERE c.organization_id = $1 AND c.meter = $2 AND c.period_start = $3`,
          [organizationId, meter, start]
        );
        if (!result.rows[0]) throw new UsageLedgerError(404, "usage_period_not_found", "The requested usage period was not found.");
        return counterRow(result.rows[0]);
      });
    }
  });
}
