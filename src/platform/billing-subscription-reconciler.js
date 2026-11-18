const PROVIDER = /^[a-z][a-z0-9_-]{1,31}$/;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["active","trialing","past_due","paused","canceled","expired","free"]);
const PLANS = new Set(["free","starter","growth","agency","business","enterprise","trial"]);
const INTERVALS = new Set(["none","month","year"]);

export class BillingReconciliationError extends Error {
  constructor(code,message) {
    super(message);
    this.name = "BillingReconciliationError";
    this.code = code;
  }
}

function utc(value,field,{nullable=false}={}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new BillingReconciliationError("provider_snapshot_invalid",field+" is invalid.");
  }
  return new Date(value).toISOString();
}

function validateSnapshot(event,snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.organizationId !== event.organizationId
    || snapshot.providerCustomerId !== event.payload?.providerCustomerId
    || snapshot.providerSubscriptionId !== event.payload?.providerSubscriptionId
    || !STATUSES.has(snapshot.status) || !PLANS.has(snapshot.plan)
    || !INTERVALS.has(snapshot.billingInterval)
    || typeof snapshot.cancelAtPeriodEnd !== "boolean") {
    throw new BillingReconciliationError("provider_snapshot_invalid","The provider API returned an invalid canonical subscription snapshot.");
  }
  if ((snapshot.status === "trialing") !== (snapshot.plan === "trial")
    || (snapshot.status === "free") !== (snapshot.plan === "free")
    || (snapshot.status === "trialing" && snapshot.billingInterval !== "none")
    || (snapshot.status === "free" && snapshot.billingInterval !== "none")
    || (snapshot.status !== "trialing" && snapshot.plan === "trial")) {
    throw new BillingReconciliationError("provider_snapshot_invalid","The canonical plan, status and billing interval are inconsistent.");
  }
  if (!PROVIDER_ID.test(snapshot.providerCustomerId) || !PROVIDER_ID.test(snapshot.providerSubscriptionId)) {
    throw new BillingReconciliationError("provider_snapshot_invalid","Provider customer and subscription identifiers are invalid.");
  }
  const periodStart = utc(snapshot.currentPeriodStart,"currentPeriodStart");
  const periodEnd = utc(snapshot.currentPeriodEnd,"currentPeriodEnd");
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) {
    throw new BillingReconciliationError("provider_snapshot_invalid","The provider billing period is invalid.");
  }
  const trialEndsAt = snapshot.status === "trialing" ? utc(snapshot.trialEndsAt,"trialEndsAt") : null;
  if (trialEndsAt && Date.parse(trialEndsAt) <= Date.parse(periodStart)) {
    throw new BillingReconciliationError("provider_snapshot_invalid","The provider trial expiry is invalid.");
  }
  const canceledAt = snapshot.canceledAt === null || snapshot.canceledAt === undefined
    ? null : utc(snapshot.canceledAt,"canceledAt");
  return Object.freeze({
    organizationId:event.organizationId,
    provider:event.provider,
    providerCustomerId:snapshot.providerCustomerId,
    providerSubscriptionId:snapshot.providerSubscriptionId,
    status:snapshot.status,
    plan:snapshot.plan,
    billingInterval:snapshot.billingInterval,
    currentPeriodStart:periodStart,
    currentPeriodEnd:periodEnd,
    trialEndsAt,
    cancelAtPeriodEnd:snapshot.cancelAtPeriodEnd,
    canceledAt
  });
}

async function withBillingWorkerTransaction(pool,work) {
  const client=await pool.connect();
  let started=false;
  let discard;
  try {
    await client.query("BEGIN");
    started=true;
    await client.query("SET LOCAL ROLE searqon_billing_worker");
    const result=await work(client);
    await client.query("COMMIT");
    started=false;
    return result;
  } catch(error) {
    if(started) {
      try { await client.query("ROLLBACK"); } catch(rollbackError) { discard=rollbackError; }
    } else discard=error;
    throw error;
  } finally {
    client.release(discard);
  }
}

function snapshotFromRow(row) {
  if (!row) return null;
  return {
    provider:row.provider,
    providerCustomerId:row.provider_customer_id,
    providerSubscriptionId:row.provider_subscription_id,
    status:row.status,
    plan:row.plan,
    billingInterval:row.billing_interval,
    currentPeriodStart:new Date(row.current_period_start).toISOString(),
    currentPeriodEnd:new Date(row.current_period_end).toISOString(),
    trialEndsAt:row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
    cancelAtPeriodEnd:row.cancel_at_period_end,
    canceledAt:row.canceled_at ? new Date(row.canceled_at).toISOString() : null
  };
}

/**
 * Provider-neutral reconciliation engine. Provider adapters must fetch the
 * current canonical subscription from the provider API; signed webhook fields
 * are used only to identify the event and bind the expected tenant/customer.
 */
export function createBillingSubscriptionReconciler({workerPool,adapters}={}) {
  if(!workerPool || typeof workerPool.connect!=="function") throw new TypeError("A dedicated billing-worker PostgreSQL pool is required.");
  if(!adapters || typeof adapters!=="object" || Array.isArray(adapters)
    || (Object.getPrototypeOf(adapters)!==Object.prototype && Object.getPrototypeOf(adapters)!==null)) {
    throw new TypeError("A provider adapter registry is required.");
  }
  for(const [provider,adapter] of Object.entries(adapters)) {
    if(!PROVIDER.test(provider) || !adapter || typeof adapter.fetchCanonicalSubscription!=="function") {
      throw new TypeError("Each billing provider must expose fetchCanonicalSubscription.");
    }
  }

  return Object.freeze({
    async reconcile(event,{workerId}={}) {
      if(!event || typeof event!=="object" || !UUID.test(event.id??"")
        || !UUID.test(event.leaseToken??"")
        || typeof workerId!=="string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/.test(workerId)
        || !PROVIDER.test(event.provider??"")
        || !UUID.test(event.organizationId??"") || !PROVIDER_ID.test(event.providerEventId??"")
        || !Number.isFinite(Date.parse(event.providerCreatedAt))
        || !Object.hasOwn(adapters,event.provider)) {
        throw new BillingReconciliationError("invalid_billing_event","A canonical billing event is required.");
      }
      const adapter=adapters[event.provider];
      let rawSnapshot;
      try {
        rawSnapshot=await adapter.fetchCanonicalSubscription(event);
      } catch {
        throw new BillingReconciliationError("provider_api_unavailable","Canonical provider subscription lookup failed.");
      }
      const snapshot=validateSnapshot(event,rawSnapshot);
      return withBillingWorkerTransaction(workerPool,async client=>{
        const lease=await client.query(
          `SELECT id FROM searqon.billing_webhook_inbox
           WHERE id=$1 AND processing_status='processing' AND lease_owner=$2
             AND lease_token=$3 AND locked_until>now()
           FOR UPDATE`,
          [event.id,workerId,event.leaseToken]
        );
        if(lease.rowCount!==1) {
          throw new BillingReconciliationError("lease_lost","The billing event lease is no longer owned by this worker.");
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[event.organizationId+":billing-subscription"]);
        const current=await client.query(
          "SELECT * FROM searqon.subscriptions WHERE organization_id=$1 FOR UPDATE",
          [event.organizationId]
        );
        const previousRow=current.rows?.[0]??null;
        if(previousRow && (previousRow.provider!==event.provider
          || (previousRow.provider_customer_id && previousRow.provider_customer_id!==snapshot.providerCustomerId)
          || (previousRow.provider_subscription_id && previousRow.provider_subscription_id!==snapshot.providerSubscriptionId))) {
          throw new BillingReconciliationError("provider_subscription_binding_conflict","The workspace is already bound to a different billing customer or subscription.");
        }

        const stale=Boolean(previousRow && previousRow.provider_event_created_at
          && Date.parse(new Date(previousRow.provider_event_created_at).toISOString())>=Date.parse(event.providerCreatedAt));
        let resulting=snapshot;
        if(!stale) {
          const saved=await client.query(
            `INSERT INTO searqon.subscriptions
              (organization_id,provider,provider_customer_id,provider_subscription_id,status,plan,billing_interval,
               current_period_start,current_period_end,trial_ends_at,cancel_at_period_end,canceled_at,provider_event_created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (organization_id) DO UPDATE SET
               provider_customer_id=EXCLUDED.provider_customer_id,
               provider_subscription_id=EXCLUDED.provider_subscription_id,
               status=EXCLUDED.status,plan=EXCLUDED.plan,billing_interval=EXCLUDED.billing_interval,
               current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,
               trial_ends_at=EXCLUDED.trial_ends_at,cancel_at_period_end=EXCLUDED.cancel_at_period_end,
               canceled_at=EXCLUDED.canceled_at,provider_event_created_at=EXCLUDED.provider_event_created_at,
               version=searqon.subscriptions.version+1,updated_at=now()
             WHERE searqon.subscriptions.provider=EXCLUDED.provider
               AND (searqon.subscriptions.provider_event_created_at IS NULL
                 OR searqon.subscriptions.provider_event_created_at<EXCLUDED.provider_event_created_at)
             RETURNING *`,
            [snapshot.organizationId,snapshot.provider,snapshot.providerCustomerId,snapshot.providerSubscriptionId,
              snapshot.status,snapshot.plan,snapshot.billingInterval,snapshot.currentPeriodStart,snapshot.currentPeriodEnd,
              snapshot.trialEndsAt,snapshot.cancelAtPeriodEnd,snapshot.canceledAt,event.providerCreatedAt]
          );
          if(saved.rows?.[0]) resulting=snapshotFromRow(saved.rows[0]);
          else {
            const latest=await client.query("SELECT * FROM searqon.subscriptions WHERE organization_id=$1",[event.organizationId]);
            resulting=snapshotFromRow(latest.rows?.[0]);
          }
        } else {
          resulting=snapshotFromRow(previousRow);
        }

        await client.query(
          `INSERT INTO searqon.subscription_events
            (organization_id,provider,provider_event_id,event_type,previous_snapshot,resulting_snapshot,occurred_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
           ON CONFLICT (provider,provider_event_id) DO NOTHING`,
          [event.organizationId,event.provider,event.providerEventId,event.eventType,
            previousRow?JSON.stringify(snapshotFromRow(previousRow)):null,JSON.stringify(resulting),event.providerCreatedAt]
        );
        return Object.freeze({reconciled:true,stale,subscription:resulting});
      });
    }
  });
}
