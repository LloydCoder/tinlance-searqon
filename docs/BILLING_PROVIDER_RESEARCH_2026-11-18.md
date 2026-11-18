# Searqon billing provider decision research

**Research date:** 18 November 2026  
**Decision status:** Recommendation only. No provider is activated or selected by this document.  
**Scope:** Hosted B2B SaaS subscriptions sold globally by a software business operating from Nigeria.

## Executive recommendation

**Paddle Billing is the preferred primary provider for a global Searqon SaaS launch, subject to seller onboarding, commercial terms and payout verification.** Keep Paystack as a possible secondary rail only if Searqon needs direct NGN collection or local payment methods. Do not build two live billing systems before there is demonstrated demand.

The deciding factor is not just transaction fee. Paddle acts as Merchant of Record for supported software sales and handles sales tax/VAT collection and remittance, checkout, subscription billing, fraud/chargeback handling and buyer support. This reduces cross-border tax and billing operations that Searqon would otherwise need to own.

## Comparison

| Dimension | Paddle Billing | Paystack |
|---|---|---|
| Merchant eligibility | Software businesses in most countries; Nigeria is not on Paddle's published unsupported-country list | Businesses registered in Nigeria, Ghana, South Africa or Kenya |
| Global customer reach | Sells in 200+ supported countries/territories | International cards can be enabled for eligible businesses; supported merchant countries remain limited |
| Merchant of Record | Yes; Paddle resells the software and handles sales tax/VAT compliance | No; merchant remains responsible for its tax/compliance obligations |
| Subscriptions | Native recurring subscriptions, lifecycle events, customer portal and billing APIs | Native plans/subscriptions; cards and Nigeria direct debit |
| Checkout | Hosted checkout and transaction APIs | Hosted redirect/inline checkout and transaction APIs |
| Webhook verification | `Paddle-Signature`: HMAC-SHA256 over `ts:rawBody`, timestamp tolerance; destination-specific secret | Current `Paystack-Signature`: HMAC-SHA512 over `t.rawBody`, timestamp tolerance and one or more key-ID signatures; legacy `x-paystack-signature` is also documented |
| Public pricing | 5% + $0.50 per checkout transaction; custom pricing possible | Nigeria international card pricing currently 3.9% + NGN100 (or 3.9% for USD); local NGN card fees currently 1.5% + NGN100, capped at NGN2,000 |
| Payouts | Monthly payout cycle; threshold minimum $100; bank wire or Payoneer. Payout currencies do not include NGN, so a Nigerian seller should verify USD wire/Payoneer onboarding and any intermediary/bank FX fees | Local and international settlement options; Nigeria can be paid in NGN or USD subject to eligibility and a qualifying USD domiciliary account |
| Main trade-off | Higher headline checkout fee and monthly payout timing, but lower tax/billing compliance burden | Lower headline processing fee, local currency rails, but merchant owns tax, cross-border compliance and more billing operations |

## Why Paddle is the primary recommendation

1. **Cross-border compliance:** Searqon is intended to sell software subscriptions internationally. Paddle's Merchant-of-Record model can remove a substantial amount of VAT/sales-tax registration, collection and remittance engineering.
2. **Founder jurisdiction:** Paddle's current supplier exclusion list does not list Nigeria. That is a positive eligibility signal, not a guarantee of account approval. The business must complete onboarding and verify payout details before relying on it.
3. **Subscription lifecycle:** Paddle exposes subscription-created/updated/activated/trialing/past-due/paused/canceled events and a canonical subscription API. Its guidance recommends event-ID deduplication, `occurred_at` ordering and periodic API reconciliation; the Searqon webhook inbox/reconciler now has those corresponding primitives.
4. **Operational simplification:** Paddle bundles checkout, billing, tax compliance, fraud/chargebacks and buyer support. This is valuable when the team does not have a dedicated finance/compliance function.
5. **No fixed platform fee:** The published pay-as-you-go price has no monthly fee, but the 5% + $0.50 transaction cost should be modelled against Searqon's price points and gross margin.

## Where Paystack fits

Paystack is a viable secondary candidate for Nigeria-first collection, particularly where NGN settlement, local payment methods or domestic recurring payments are important. It supports international cards for eligible merchants after compliance approval, and Nigeria-based businesses can accept NGN and USD under its stated settlement requirements.

Paystack is not the preferred sole provider for a global SaaS product because its merchant footprint is limited to four live countries and it does not provide the same Merchant-of-Record tax handling. Its lower headline fee must be compared with the engineering and tax-compliance burden that remains with Searqon.

## Stripe

Stripe should not be assumed to be directly available to a Nigerian-incorporated seller. Stripe's published guidance for opening an account in another country requires a legal entity, tax ID, physical location, phone, government ID, working website and physical bank account in that country. A foreign Stripe account would require a genuine eligible foreign entity and operating footprint, not a workaround.

## Implementation mapping

The Phase 13 code includes a Paddle adapter that:

- verifies the current `Paddle-Signature` header over original raw bytes using HMAC-SHA256 and a five-second timestamp tolerance;
- maps supported subscription lifecycle events to the canonical Searqon billing event contract;
- ignores verified non-subscription events without triggering provider retry storms;
- fetches the canonical subscription from Paddle's API before applying plan/status changes;
- validates workspace metadata, customer/subscription binding, configured price-to-plan mapping and monthly/annual billing periods;
- supports paused subscriptions and fails them closed to Free entitlements.

The adapter and hosted checkout service are not activated. Checkout uses a tenant-scoped local request ID, configured plan/interval price IDs, a validated approved HTTPS return URL and a signed subscription-created event bound to the originating transaction. Activation still requires a Paddle seller account, sandbox API key, notification destination secret, approved price catalogue, a server-side `pricePlanMap`, payout verification and sandbox end-to-end verification. No API key or notification secret is committed.

## Required product-owner decision before activation

1. Confirm Paddle as the primary provider, or choose another provider.
2. Complete seller onboarding and confirm payout method/currency, payout threshold and any bank/Payoneer charges.
3. Approve the Merchant-of-Record terms and current 5% + $0.50 pricing.
4. Approve Searqon's price catalogue and mapping from Paddle price IDs to Searqon plans.
5. Create sandbox products/prices and a notification destination; supply secrets only through the approved secret manager.
6. Run checkout, trial, activation, upgrade/downgrade, payment failure, pause/resume, cancellation, refund and dispute sandbox scenarios.
7. Complete staging verification and explicitly authorize production enablement.

Until these decisions and tests are complete, Searqon's Paddle adapter remains disabled and no customer can be charged.

## Official sources

- Paddle supported supplier countries: https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle
- Paddle Merchant of Record pricing: https://www.paddle.com/pricing
- Paddle payout timing and methods: https://www.paddle.com/help/manage/get-paid/when-and-how-do-i-get-paid
- Paddle signature verification: https://developer.paddle.com/webhooks/about/signature-verification/
- Paddle subscription API: https://developer.paddle.com/api-reference/subscriptions/get-subscription/
- Paddle webhook lifecycle and ordering: https://developer.paddle.com/build/subscriptions/provision-access-webhooks/
- Paystack supported merchant countries: https://support.paystack.com/en/articles/2130562
- Paystack international payment eligibility and settlement: https://support.paystack.com/en/articles/2130690
- Paystack current webhook signature format: https://paystack.com/docs/payments/webhooks/
- Paystack subscriptions: https://paystack.com/docs/payments/subscriptions/
- Paystack pricing: https://support.paystack.com/en/articles/2130306
- Stripe foreign-country account requirements: https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-another-country
