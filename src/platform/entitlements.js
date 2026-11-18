import { readFile } from 'node:fs/promises';

const CONFIG_URL = new URL('../../config/entitlements.v1.json', import.meta.url);
const VALID_PLANS = new Set(['free', 'starter', 'growth', 'agency', 'business', 'enterprise', 'trial']);
const BILLABLE_METERS = new Set(['ai_answer_checks', 'crawl_pages', 'keyword_months', 'api_requests']);

export const ENTITLEMENTS = JSON.parse(await readFile(CONFIG_URL, 'utf8'));

const clone = (value) => structuredClone(value);

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
}

function assertPlan(plan) {
  if (!VALID_PLANS.has(plan)) throw new TypeError('Unknown Searqon plan');
}

function activePlan(subscription, now) {
  if (!subscription || typeof subscription !== 'object') return { plan: 'free', status: 'free' };
  if (subscription.status === 'trialing') {
    const end = Date.parse(subscription.trialEndsAt);
    if (!Number.isFinite(end)) throw new TypeError('trialEndsAt must be a valid ISO timestamp');
    if (now >= end) return { plan: 'free', status: 'expired' };
    return { plan: 'trial', status: 'trialing' };
  }
  if (subscription.status === 'active') {
    assertPlan(subscription.plan);
    if (subscription.plan === 'trial') throw new TypeError('Trial must use trialing status');
    return { plan: subscription.plan, status: 'active' };
  }
  if (['past_due', 'paused', 'canceled', 'expired', 'free'].includes(subscription.status)) {
    return { plan: 'free', status: subscription.status };
  }
  throw new TypeError('Unknown subscription status');
}

function limitsFor(plan, approvedOverrides, now) {
  const limits = clone(ENTITLEMENTS.plans[plan].limits);
  if (!approvedOverrides) return { limits, features: clone(ENTITLEMENTS.plans[plan].features) };
  if (plan !== 'enterprise') throw new Error('Contract overrides are only valid for Enterprise subscriptions');
  if (approvedOverrides.contractStatus !== 'active' || typeof approvedOverrides.approvedBy !== 'string' || !approvedOverrides.approvedBy.trim()) {
    throw new Error('Enterprise overrides require an active contract and an approving principal');
  }
  const from = Date.parse(approvedOverrides.validFrom);
  const until = Date.parse(approvedOverrides.validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until) || now < from || now >= until) {
    throw new Error('Enterprise override is outside its approved validity window');
  }
  const requested = approvedOverrides.limits ?? {};
  for (const [key, value] of Object.entries(requested)) {
    if (!(key in limits)) throw new Error(`Unknown entitlement limit: ${key}`);
    assertNonNegativeInteger(value, key);
    const ceilingKey = ({
      projects: 'projects', teamMembers: 'teamMembers', trackedPrompts: 'trackedPrompts',
      aiEngines: 'aiEngines', localesPerProject: 'localesPerProject',
      aiAnswerChecksPerMonth: 'aiAnswerChecksPerMonth', crawlPagesPerMonth: 'crawlPagesPerMonth',
      trackedKeywords: 'trackedKeywords', apiRequestsPerMonth: 'apiRequestsPerMonth',
      evidenceHistoryDays: 'evidenceHistoryDays', scheduledReportsPerMonth: 'scheduledReportsPerMonth',
      manualAssessmentsPerMonth: 'manualAssessmentsPerMonth', suppliedGeoObservationsPerMonth: 'suppliedGeoObservationsPerMonth'
    })[key];
    if (ceilingKey && value > ENTITLEMENTS.hardSafetyCeilings[ceilingKey]) {
      throw new Error(`Override exceeds hard safety ceiling for ${key}`);
    }
    limits[key] = value;
  }
  const features = clone(ENTITLEMENTS.plans[plan].features);
  for (const [key, value] of Object.entries(approvedOverrides.features ?? {})) {
    if (!(key in features) || typeof value !== 'boolean') throw new Error(`Invalid enterprise feature override: ${key}`);
    features[key] = value;
  }
  return { limits, features };
}

export function resolveEntitlements({ subscription, approvedOverrides, now = Date.now() } = {}) {
  const resolved = activePlan(subscription, now);
  const plan = ENTITLEMENTS.plans[resolved.plan];
  const configured = limitsFor(resolved.plan, approvedOverrides, now);
  return {
    plan: resolved.plan,
    status: resolved.status,
    limits: configured.limits,
    features: configured.features,
    monthlyPriceUsd: plan.monthlyPriceUsd,
    overageRatesMicroUsd: clone(plan.overageRatesMicroUsd),
    overageDefaultEnabled: false,
    requiresExplicitOverageOptIn: true,
    trialEndsAt: resolved.status === 'trialing' ? subscription.trialEndsAt : null
  };
}

export function evaluateFeature({ entitlements, feature }) {
  if (!entitlements || typeof feature !== 'string') throw new TypeError('entitlements and feature are required');
  return { allowed: entitlements.features[feature] === true, reason: entitlements.features[feature] === true ? 'included' : 'not_entitled' };
}

export function quoteOverage({ plan, meter, quantity }) {
  assertPlan(plan);
  assertNonNegativeInteger(quantity, 'quantity');
  if (!BILLABLE_METERS.has(meter)) throw new TypeError('Unknown billable meter');
  const rate = ENTITLEMENTS.plans[plan].overageRatesMicroUsd[meter];
  if (!rate) return { allowed: false, amountMicroUsd: 0, reason: 'overage_not_available' };
  const block = ENTITLEMENTS.meters[meter].overageBlock;
  const amountMicroUsd = Math.ceil((quantity * rate) / block);
  if (!Number.isSafeInteger(amountMicroUsd)) throw new RangeError('Overage quote exceeds safe integer precision');
  return { allowed: true, amountMicroUsd, currency: 'USD', meter, quantity, rateMicroUsdPerBlock: rate, block };
}

export function authorizeUsage({
  entitlements, meter, used, requested, overage = { enabled: false, spendCapMicroUsd: 0, spentMicroUsd: 0 }
}) {
  assertNonNegativeInteger(used, 'used');
  assertNonNegativeInteger(requested, 'requested');
  assertNonNegativeInteger(overage.spendCapMicroUsd ?? 0, 'spendCapMicroUsd');
  assertNonNegativeInteger(overage.spentMicroUsd ?? 0, 'spentMicroUsd');
  if ((overage.spendCapMicroUsd ?? 0) > ENTITLEMENTS.hardSafetyCeilings.maxOverageSpendMicroUsd) {
    throw new RangeError('Spend cap exceeds the platform hard safety ceiling');
  }
  const limitKey = ({
    ai_answer_checks: 'aiAnswerChecksPerMonth',
    crawl_pages: 'crawlPagesPerMonth',
    keyword_months: 'trackedKeywords',
    api_requests: 'apiRequestsPerMonth'
  })[meter];
  if (!limitKey || !BILLABLE_METERS.has(meter)) throw new TypeError('Unknown usage meter');
  if (!entitlements || !Number.isSafeInteger(entitlements.limits[limitKey])) throw new TypeError('Meter is not configured for this plan');
  const limit = entitlements.plan === 'trial' && meter === 'ai_answer_checks'
    ? ENTITLEMENTS.billing.trial.totalAiAnswerChecks
    : entitlements.limits[limitKey];
  if (!Number.isSafeInteger(used + requested)) throw new RangeError('Requested usage exceeds safe integer precision');
  const priorOverage = Math.max(0, used - limit);
  const newOverage = Math.max(0, used + requested - limit);
  const billableOverage = newOverage - priorOverage;
  if (billableOverage === 0) return { allowed: true, billableOverage: 0, amountMicroUsd: 0, reason: 'within_included_allowance' };
  if (!overage.enabled || overage.spendCapMicroUsd <= 0) {
    return { allowed: false, billableOverage: 0, amountMicroUsd: 0, reason: 'included_allowance_exhausted' };
  }
  const quote = quoteOverage({ plan: entitlements.plan, meter, quantity: billableOverage });
  if (!quote.allowed) return { allowed: false, billableOverage: 0, amountMicroUsd: 0, reason: quote.reason };
  const remaining = Math.max(0, overage.spendCapMicroUsd - overage.spentMicroUsd);
  if (quote.amountMicroUsd > remaining) {
    return { allowed: false, billableOverage, amountMicroUsd: 0, reason: 'overage_spend_cap_exhausted' };
  }
  return { allowed: true, billableOverage, amountMicroUsd: quote.amountMicroUsd, reason: 'authorized_overage' };
}

export function trialTransition({ trialEndsAt, now = Date.now() }) {
  const end = Date.parse(trialEndsAt);
  if (!Number.isFinite(end)) throw new TypeError('trialEndsAt must be a valid ISO timestamp');
  return now >= end
    ? { plan: 'free', status: 'expired', paidConversionRequired: false }
    : { plan: 'trial', status: 'trialing', paidConversionRequired: false };
}
