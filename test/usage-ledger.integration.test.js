import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createUsageLedger } from "../src/platform/usage-ledger.js";
import { resolveEntitlements } from "../src/platform/entitlements.js";

const databaseUrl = process.env.DATABASE_URL;
let disposable = false;
if (databaseUrl && process.env.SEARQON_TEST_DATABASE === "1") {
  try {
    const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    disposable = /(?:^|[_-])(test|ci)(?:$|[_-])/i.test(name);
  } catch {}
}

test("PostgreSQL usage ledger reserves atomically, settles idempotently and isolates tenants", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const runtime = new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl, max: 4 });
  const database = { pool: runtime };
  const userA = randomUUID();
  const userB = randomUUID();
  const viewer = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const email = id => id + "@usage.example.test";
  const periodStart = "2026-11-01T00:00:00.000Z";
  const periodEnd = "2026-12-01T00:00:00.000Z";
  const getEntitlements = async (_client, organizationId) => ({
    ...resolveEntitlements({ subscription: { status: "active", plan: "growth" } }),
    limits: { ...resolveEntitlements({ subscription: { status: "active", plan: "growth" } }).limits, aiAnswerChecksPerMonth: 1500 },
    billingPeriod: { start: periodStart, end: periodEnd },
    overage: { enabled: false, spendCapMicroUsd: 0 }
  });
  const ledger = createUsageLedger({ database, getEntitlements });

  try {
    await owner.query(
      "INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Usage A'),($3,$4,'Usage B'),($5,$6,'Usage Viewer')",
      [userA,email(userA),userB,email(userB),viewer,email(viewer)]
    );
    await owner.query(
      "INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Usage A',$2),($3,'Usage B',$4)",
      [orgA,"usage-"+userA.replaceAll("-",""),orgB,"usage-"+userB.replaceAll("-","")]
    );
    await owner.query(
      "INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'viewer')",
      [orgA,userA,orgB,userB,viewer]
    );

    const request = {
      meter: "ai_answer_checks", quantity: 5, periodStart: "2026-01-01T00:00:00.000Z", periodEnd: "2026-02-01T00:00:00.000Z",
      idempotencyKey: "usage-reservation-0001"
    };
    const first = await ledger.reserve(userA, orgA, request);
    const retry = await ledger.reserve(userA, orgA, request);
    assert.equal(retry.id, first.id);
    assert.equal(retry.idempotentReplay, true);
    const [raceA, raceB] = await Promise.all([
      ledger.reserve(userA, orgA, request),
      ledger.reserve(userA, orgA, request)
    ]);
    assert.equal(raceA.id, first.id);
    assert.equal(raceB.id, first.id);
    assert.equal(raceA.idempotentReplay, true);
    await assert.rejects(
      ledger.reserve(userA, orgA, { ...request, quantity: 6 }),
      error => error.code === "idempotency_key_conflict"
    );
    assert.equal(new Date(first.periodStart).toISOString(), periodStart);
    assert.equal(new Date(first.periodEnd).toISOString(), periodEnd);
    assert.equal(first.createdBy, userA);
    assert.equal(first.includedReservedUnits, 5);
    await assert.rejects(
      ledger.reserve(viewer, orgA, { ...request, idempotencyKey: "viewer-usage-denied-01" }),
      error => error.code === "insufficient_role"
    );
    const changedPolicy = createUsageLedger({
      database,
      getEntitlements: async () => ({
        ...resolveEntitlements({ subscription: { status: "active", plan: "growth" } }),
        limits: {
          ...resolveEntitlements({ subscription: { status: "active", plan: "growth" } }).limits,
          aiAnswerChecksPerMonth: 1500,
          trackedKeywords: 999
        },
        billingPeriod: { start: periodStart, end: periodEnd },
        overage: { enabled: false, spendCapMicroUsd: 0 }
      })
    });
    await assert.rejects(
      changedPolicy.reserve(userA, orgA, {
        meter: "crawl_pages", quantity: 1, idempotencyKey: "usage-policy-change-01"
      }),
      error => error.code === "usage_policy_changed"
    );
    assert.equal(first.overageReservedUnits, 0);

    const [second, third] = await Promise.all([
      ledger.reserve(userA, orgA, { ...request, quantity: 1494, idempotencyKey: "usage-reservation-0002" }),
      ledger.reserve(userA, orgA, { ...request, quantity: 1, idempotencyKey: "usage-reservation-0003" })
    ]);
    assert.ok(second && third);

    await assert.rejects(
      ledger.reserve(userA, orgA, { ...request, quantity: 1, idempotencyKey: "usage-over-limit" }),
      error => error.code === "included_allowance_exhausted"
    );

    const settled = await ledger.settle(userA, orgA, first.id, { actualUnits: 3 });
    assert.equal(settled.status, "settled");
    assert.equal(settled.actualUnits, 3);
    const settleRetry = await ledger.settle(userA, orgA, first.id, { actualUnits: 3 });
    assert.equal(settleRetry.idempotentReplay, true);

    const release = await ledger.release(userA, orgA, second.id, { reason: "cancelled_before_dispatch" });
    assert.equal(release.status, "released");
    await owner.query("UPDATE searqon.usage_reservations SET expires_at = now() - interval '1 second' WHERE id = $1", [third.id]);
    const expired = await ledger.releaseExpired(userA, orgA);
    assert.equal(expired.releasedCount, 1);
    assert.equal(expired.reservations[0].id, third.id);
    const usageAfterRelease = await ledger.getPeriod(userA, orgA, "ai_answer_checks", periodStart);
    assert.equal(usageAfterRelease.consumedUnits, 3);
    assert.equal(usageAfterRelease.reservedUnits, 0);

    await assert.rejects(
      ledger.getPeriod(userB, orgB, "ai_answer_checks", periodStart),
      error => error.code === "usage_period_not_found"
    );
    await assert.rejects(
      ledger.getPeriod(userB, orgA, "ai_answer_checks", periodStart),
      error => error.code === "usage_period_not_found"
    );

    const ledgerEntries = await owner.query(
      "SELECT event_type, quantity_delta, actor_user_id FROM searqon.usage_ledger_entries WHERE organization_id = $1 ORDER BY id",
      [orgA]
    );
    assert.deepEqual(ledgerEntries.rows.map(row => row.event_type), ["reserved","reserved","reserved","settled","released","released"]);
    assert.ok(ledgerEntries.rows.every(row => row.actor_user_id === userA), "every immutable usage event must identify its authenticated actor");
    await assert.rejects(
      owner.query("UPDATE searqon.usage_ledger_entries SET event_type = 'tampered' WHERE organization_id = $1", [orgA]),
      error => error.code === "55000"
    );
  } finally {
    await runtime.end();
    await owner.end();
  }
});

test("PostgreSQL usage ledger prices only reserved overage and releases unused reserved cost", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const runtime = new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl, max: 2 });
  const user = randomUUID();
  const organization = randomUUID();
  const periodStart = "2026-11-01T00:00:00.000Z";
  const periodEnd = "2026-12-01T00:00:00.000Z";
  const ledger = createUsageLedger({
    database: { pool: runtime },
    getEntitlements: async () => ({
      ...resolveEntitlements({ subscription: { status: "active", plan: "growth" } }),
      limits: { ...resolveEntitlements({ subscription: { status: "active", plan: "growth" } }).limits, aiAnswerChecksPerMonth: 3 },
      billingPeriod: { start: periodStart, end: periodEnd },
      overage: { enabled: true, spendCapMicroUsd: 45_000 }
    })
  });
  try {
    await owner.query("INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Overage')", [user,user+"@usage.example.test"]);
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Overage',$2)", [organization,"usage-"+user.replaceAll("-","")]);
    await owner.query("INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner')", [organization,user]);

    const reservation = await ledger.reserve(user, organization, {
      meter: "ai_answer_checks", quantity: 5, periodStart, periodEnd, idempotencyKey: "overage-reservation-01"
    });
    assert.equal(reservation.includedReservedUnits, 3);
    assert.equal(reservation.overageReservedUnits, 2);
    assert.equal(reservation.reservedAmountMicroUsd, 40_000);
    await assert.rejects(
      ledger.reserve(user, organization, {
        meter: "keyword_months", quantity: 1001, periodStart, periodEnd,
        idempotencyKey: "overage-cross-meter-01"
      }),
      error => error.code === "overage_spend_cap_exhausted"
    );

    const settled = await ledger.settle(user, organization, reservation.id, { actualUnits: 4 });
    assert.equal(settled.chargedAmountMicroUsd, 20_000);
    const period = await ledger.getPeriod(user, organization, "ai_answer_checks", periodStart);
    assert.equal(period.consumedUnits, 4);
    assert.equal(period.reservedUnits, 0);
    assert.equal(period.overageSpentMicroUsd, 20_000);
    assert.equal(period.overageReservedMicroUsd, 0);
  } finally {
    await runtime.end();
    await owner.end();
  }
});


test("PostgreSQL atomic consumption enforces fixed quotas and commits operation state with usage", { skip: !disposable }, async () => {
  const owner = new Pool({ connectionString: databaseUrl });
  const runtime = new Pool({ connectionString: process.env.SEARQON_RUNTIME_DATABASE_URL ?? databaseUrl, max: 4 });
  const user = randomUUID();
  const organization = randomUUID();
  const periodStart = "2026-11-01T00:00:00.000Z";
  const periodEnd = "2026-12-01T00:00:00.000Z";
  const ledger = createUsageLedger({
    database: { pool: runtime },
    getEntitlements: async () => ({
      ...resolveEntitlements({ subscription: { status: "active", plan: "growth" } }),
      limits: { ...resolveEntitlements({ subscription: { status: "active", plan: "growth" } }).limits, manualAssessmentsPerMonth: 2 },
      billingPeriod: { start: periodStart, end: periodEnd },
      overage: { enabled: true, spendCapMicroUsd: 1000 }
    })
  });
  try {
    await owner.query("INSERT INTO searqon.app_users (id,email,display_name) VALUES ($1,$2,'Atomic Consume')", [user,user+"@consume.example.test"]);
    await owner.query("INSERT INTO searqon.organizations (id,name,slug) VALUES ($1,'Atomic Consume',$2)", [organization,"consume-"+user.replaceAll("-","")]);
    await owner.query("INSERT INTO searqon.memberships (organization_id,user_id,role) VALUES ($1,$2,'owner')", [organization,user]);

    const failedKey = "atomic-rollback-0001";
    await assert.rejects(
      ledger.consume(user, organization, { meter: "manual_assessments", quantity: 1, idempotencyKey: failedKey }, async () => {
        await owner.query("SELECT 1");
        throw new Error("operation failed");
      }),
      /operation failed/
    );
    const afterRollback = await owner.query("SELECT count(*)::int AS count FROM searqon.usage_reservations WHERE organization_id = $1", [organization]);
    assert.equal(afterRollback.rows[0].count, 0, "a failed operation must roll back its quota reservation");

    let callbacks = 0;
    const requests = [1,2,3].map(index => ledger.consume(user, organization, {
      meter: "manual_assessments", quantity: 1, idempotencyKey: "atomic-consume-000" + index
    }, async client => {
      callbacks += 1;
      const identity = await client.query("SELECT current_setting('searqon.user_id', true) AS user_id");
      assert.equal(identity.rows[0].user_id, user);
      return "assessment-" + index;
    }));
    const outcomes = await Promise.allSettled(requests);
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 2);
    assert.equal(outcomes.filter(item => item.status === "rejected" && item.reason.code === "included_allowance_exhausted").length, 1);
    assert.equal(callbacks, 2);

    const first = outcomes.find(item => item.status === "fulfilled").value;
    assert.equal(first.result.startsWith("assessment-"), true);
    const replay = await ledger.consume(user, organization, {
      meter: "manual_assessments", quantity: 1, idempotencyKey: "atomic-consume-0001"
    }, async () => {
      throw new Error("idempotent replay must not execute the operation again");
    });
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.result, null);

    const counter = await owner.query(
      "SELECT consumed_units, reserved_units FROM searqon.usage_period_counters WHERE organization_id = $1 AND meter = 'manual_assessments'",
      [organization]
    );
    assert.equal(Number(counter.rows[0].consumed_units), 2);
    assert.equal(Number(counter.rows[0].reserved_units), 0);
    const entries = await owner.query(
      "SELECT event_type, quantity_delta FROM searqon.usage_ledger_entries WHERE organization_id = $1 ORDER BY id",
      [organization]
    );
    assert.deepEqual(entries.rows.map(row => [row.event_type, Number(row.quantity_delta)]), [["settled",1],["settled",1]]);
  } finally {
    await runtime.end();
    await owner.end();
  }
});
