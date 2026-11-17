import test from "node:test";
import assert from "node:assert/strict";
import { createUsageLedger, UsageLedgerError } from "../src/platform/usage-ledger.js";

const userId = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000001";

function fixture() {
  let connects = 0;
  const database = { pool: { async connect() { connects += 1; throw new Error("database should not be reached"); } } };
  const ledger = createUsageLedger({
    database,
    getEntitlements: async () => ({ plan: "free", limits: {}, billingPeriod: { start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z" }, overage: { enabled: false, spendCapMicroUsd: 0 } })
  });
  return { ledger, connects: () => connects };
}

test("usage ledger requires a PostgreSQL pool and trusted entitlement resolver", () => {
  assert.throws(() => createUsageLedger(), /PostgreSQL database pool/);
  assert.throws(() => createUsageLedger({ database: { pool: { connect() {} } } }), /trusted server-side entitlement resolver/);
  assert.throws(() => createUsageLedger({
    database: { pool: { connect() {} } },
    getEntitlements: async () => ({}),
    reservationTtlSeconds: 29
  }), /reservationTtlSeconds/);
});

test("usage reservation validates meter, quantity, idempotency key and billing period before database access", async () => {
  const { ledger, connects } = fixture();
  const base = {
    meter: "ai_answer_checks",
    quantity: 1,
    periodStart: "2026-11-01T00:00:00.000Z",
    periodEnd: "2026-12-01T00:00:00.000Z",
    idempotencyKey: "usage-key-0001"
  };
  await assert.rejects(ledger.reserve(userId, organizationId, { ...base, meter: "unknown" }),
    error => error instanceof UsageLedgerError && error.code === "invalid_meter");
  await assert.rejects(ledger.reserve(userId, organizationId, { ...base, quantity: 0 }),
    error => error instanceof UsageLedgerError && error.code === "invalid_quantity");
  await assert.rejects(ledger.reserve(userId, organizationId, { ...base, idempotencyKey: "short" }),
    error => error instanceof UsageLedgerError && error.code === "invalid_idempotency_key");
  await assert.rejects(ledger.getPeriod(userId, organizationId, "ai_answer_checks", "not-a-date"),
    error => error instanceof UsageLedgerError && error.code === "invalid_period_start");
  assert.equal(connects(), 0);
});

test("usage settlement and release reject malformed identifiers before database access", async () => {
  const { ledger, connects } = fixture();
  await assert.rejects(ledger.settle("bad-user", organizationId, "bad-reservation", { actualUnits: 1 }),
    error => error instanceof UsageLedgerError && error.code === "invalid_user_id");
  await assert.rejects(ledger.release(userId, organizationId, "bad-reservation"),
    error => error instanceof UsageLedgerError && error.code === "invalid_reservation_id");
  assert.equal(connects(), 0);
});
