import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTITLEMENTS, resolveEntitlements, evaluateFeature, quoteOverage,
  authorizeUsage, trialTransition
} from '../src/platform/entitlements.js';

test('published plan prices and included limits are represented in machine configuration', () => {
  assert.equal(ENTITLEMENTS.plans.starter.monthlyPriceUsd, 79);
  assert.equal(ENTITLEMENTS.plans.growth.monthlyPriceUsd, 199);
  assert.equal(ENTITLEMENTS.plans.agency.monthlyPriceUsd, 499);
  assert.equal(ENTITLEMENTS.plans.business.monthlyPriceUsd, 999);
  assert.equal(ENTITLEMENTS.plans.enterprise.monthlyPriceUsd, 2500);
  assert.equal(ENTITLEMENTS.plans.growth.limits.aiAnswerChecksPerMonth, 6000);
});

test('missing or inactive subscription resolves to Free', () => {
  assert.equal(resolveEntitlements().plan, 'free');
  assert.equal(resolveEntitlements({ subscription: { status: 'canceled', plan: 'growth' } }).plan, 'free');
  assert.equal(resolveEntitlements({ subscription: { status: 'past_due', plan: 'growth' } }).plan, 'free');
});

test('active paid subscription resolves only to its configured plan', () => {
  const result = resolveEntitlements({ subscription: { status: 'active', plan: 'growth' } });
  assert.equal(result.plan, 'growth');
  assert.equal(result.limits.projects, 5);
  assert.equal(result.features.recurringGeoMonitoring, true);
});

test('expired trial downgrades to Free without paid conversion', () => {
  const result = resolveEntitlements({
    subscription: { status: 'trialing', trialEndsAt: '2026-11-01T00:00:00.000Z' },
    now: Date.parse('2026-11-02T00:00:00.000Z')
  });
  assert.equal(result.plan, 'free');
  assert.equal(result.status, 'expired');
  assert.deepEqual(trialTransition({ trialEndsAt: '2026-11-01T00:00:00.000Z', now: Date.parse('2026-11-02T00:00:00.000Z') }), {
    plan: 'free', status: 'expired', paidConversionRequired: false
  });
});

test('active trial is constrained to trial entitlements', () => {
  const result = resolveEntitlements({
    subscription: { status: 'trialing', trialEndsAt: '2026-11-20T00:00:00.000Z' },
    now: Date.parse('2026-11-17T00:00:00.000Z')
  });
  assert.equal(result.plan, 'trial');
  assert.equal(result.limits.projects, 1);
  assert.equal(result.limits.aiAnswerChecksPerMonth, 500);
  assert.equal(result.features.apiAccess, false);
});

test('Free does not receive live GEO monitoring', () => {
  const free = resolveEntitlements();
  assert.deepEqual(evaluateFeature({ entitlements: free, feature: 'recurringGeoMonitoring' }), {
    allowed: false, reason: 'not_entitled'
  });
});

test('included usage is allowed and exhausted allowance fails closed by default', () => {
  const growth = resolveEntitlements({ subscription: { status: 'active', plan: 'growth' } });
  assert.equal(authorizeUsage({ entitlements: growth, meter: 'ai_answer_checks', used: 5000, requested: 1000 }).allowed, true);
  assert.deepEqual(authorizeUsage({ entitlements: growth, meter: 'ai_answer_checks', used: 6000, requested: 1 }), {
    allowed: false, billableOverage: 0, amountMicroUsd: 0, reason: 'included_allowance_exhausted'
  });
});

test('overage requires explicit opt-in and a positive spend cap', () => {
  const growth = resolveEntitlements({ subscription: { status: 'active', plan: 'growth' } });
  assert.equal(authorizeUsage({
    entitlements: growth, meter: 'ai_answer_checks', used: 6000, requested: 100,
    overage: { enabled: false, spendCapMicroUsd: 10000000, spentMicroUsd: 0 }
  }).allowed, false);
  const allowed = authorizeUsage({
    entitlements: growth, meter: 'ai_answer_checks', used: 6000, requested: 100,
    overage: { enabled: true, spendCapMicroUsd: 10000000, spentMicroUsd: 0 }
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.amountMicroUsd, 2000000);
});

test('overage charges only newly consumed units, never the full cumulative excess twice', () => {
  const growth = resolveEntitlements({ subscription: { status: 'active', plan: 'growth' } });
  const result = authorizeUsage({
    entitlements: growth, meter: 'ai_answer_checks', used: 6100, requested: 100,
    overage: { enabled: true, spendCapMicroUsd: 10000000, spentMicroUsd: 2000000 }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.billableOverage, 100);
  assert.equal(result.amountMicroUsd, 2000000);
});

test('trial answer-check allowance is a lifetime cap and never resets monthly', () => {
  const trial = resolveEntitlements({
    subscription: { status: 'trialing', trialEndsAt: '2026-11-20T00:00:00.000Z' },
    now: Date.parse('2026-11-17T00:00:00.000Z')
  });
  const result = authorizeUsage({ entitlements: trial, meter: 'ai_answer_checks', used: 500, requested: 1 });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'included_allowance_exhausted');
});

test('platform hard ceiling bounds customer-authorized overage spend', () => {
  const growth = resolveEntitlements({ subscription: { status: 'active', plan: 'growth' } });
  assert.throws(() => authorizeUsage({
    entitlements: growth, meter: 'ai_answer_checks', used: 6000, requested: 1,
    overage: { enabled: true, spendCapMicroUsd: ENTITLEMENTS.hardSafetyCeilings.maxOverageSpendMicroUsd + 1, spentMicroUsd: 0 }
  }), /platform hard safety ceiling/);
});

test('enterprise overrides cannot bypass any configured quota ceiling', () => {
  const subscription = { status: 'active', plan: 'enterprise' };
  const now = Date.parse('2026-11-17T00:00:00.000Z');
  assert.throws(() => resolveEntitlements({
    subscription, now,
    approvedOverrides: {
      contractStatus: 'active', approvedBy: 'billing-admin',
      validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
      limits: { scheduledReportsPerMonth: 10001 }
    }
  }), /hard safety ceiling/);
});

test('overage cannot exceed customer spend cap', () => {
  const growth = resolveEntitlements({ subscription: { status: 'active', plan: 'growth' } });
  const result = authorizeUsage({
    entitlements: growth, meter: 'ai_answer_checks', used: 6000, requested: 100,
    overage: { enabled: true, spendCapMicroUsd: 1000000, spentMicroUsd: 0 }
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'overage_spend_cap_exhausted');
});

test('overage quotes use integer micro-USD and block pricing', () => {
  assert.equal(quoteOverage({ plan: 'starter', meter: 'ai_answer_checks', quantity: 100 }).amountMicroUsd, 2500000);
  assert.equal(quoteOverage({ plan: 'agency', meter: 'crawl_pages', quantity: 1000 }).amountMicroUsd, 4000000);
  assert.equal(quoteOverage({ plan: 'agency', meter: 'api_requests', quantity: 10000 }).amountMicroUsd, 1000000);
});

test('enterprise overrides require an active approved contract and respect hard ceilings', () => {
  const subscription = { status: 'active', plan: 'enterprise' };
  const now = Date.parse('2026-11-17T00:00:00.000Z');
  assert.throws(() => resolveEntitlements({ subscription, approvedOverrides: { limits: { projects: 200 } }, now }), /active contract/);
  assert.throws(() => resolveEntitlements({
    subscription, now,
    approvedOverrides: {
      contractStatus: 'active', approvedBy: 'billing-admin',
      validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
      limits: { projects: 501 }
    }
  }), /hard safety ceiling/);
  const approved = resolveEntitlements({
    subscription, now,
    approvedOverrides: {
      contractStatus: 'active', approvedBy: 'billing-admin',
      validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z',
      limits: { projects: 120 }, features: { dataResidency: false }
    }
  });
  assert.equal(approved.limits.projects, 120);
  assert.equal(approved.features.dataResidency, false);
});

test('rejects unknown plans and invalid usage counters', () => {
  assert.throws(() => resolveEntitlements({ subscription: { status: 'active', plan: 'unlimited' } }), /Unknown Searqon plan/);
  const growth = resolveEntitlements({ subscription: { status: 'active', plan: 'growth' } });
  assert.throws(() => authorizeUsage({ entitlements: growth, meter: 'ai_answer_checks', used: -1, requested: 1 }), /non-negative/);
});
